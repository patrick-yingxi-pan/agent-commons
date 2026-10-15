import { test } from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inspectNativeMacReleaseHost,
  nativeMacReleaseHostCommands,
  parseNativeMacReleaseHost,
  validateNativeMacReleaseHost,
} from './releaseHost.mjs'

const sourcePath = fileURLToPath(new URL('./native/release-host.c', import.meta.url))

test('native host parser accepts only matching native architecture evidence', () => {
  for (const architecture of ['arm64', 'x64']) {
    for (const translation of [0, ...(architecture === 'x64' ? ['absent'] : [])]) {
      assert.deepEqual(parseNativeMacReleaseHost(JSON.stringify({ architecture, translation }), architecture), {
        platform: 'darwin', architecture, translated: false,
      })
    }
  }
})

test('native host parser rejects translation, mismatch, malformed, and non-exact evidence', () => {
  for (const architecture of ['arm64', 'x64']) {
    for (const translation of [1, 2, -1, '0', null, ...(architecture === 'arm64' ? ['absent'] : [])]) {
      assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture, translation }), architecture))
    }
    assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture: architecture === 'arm64' ? 'x64' : 'arm64', translation: 0 }), architecture))
    assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture, translation: 0, extra: true }), architecture))
    assert.throws(() => parseNativeMacReleaseHost('{', architecture))
    assert.throws(() => parseNativeMacReleaseHost('', architecture))
    assert.throws(() => parseNativeMacReleaseHost(' '.repeat(257), architecture))
    for (const value of [null, [], true, 0, {}, { architecture }, { translation: 0 }]) {
      assert.throws(() => parseNativeMacReleaseHost(JSON.stringify(value), architecture))
    }
  }
  assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture: 'universal', translation: 0 }), 'universal'))
  assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture: 'x64', translation: 0 }), 'arm64'))
  assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture: 'arm64', translation: 0 }), 'x64'))
  assert.throws(() => parseNativeMacReleaseHost(JSON.stringify({ architecture: 'x64', translation: 0 }), undefined))
})

test('native host evidence validator requires exact untranslated macOS identity', () => {
  const valid = { platform: 'darwin', architecture: 'arm64', translated: false }
  const result = validateNativeMacReleaseHost(valid, 'arm64')
  assert.deepEqual(result, valid)
  assert.equal(Object.isFrozen(result), true)
  for (const invalid of [
    { ...valid, translated: true },
    { ...valid, architecture: 'x64' },
    { ...valid, platform: 'linux' },
    { ...valid, extra: true },
    { platform: 'darwin', architecture: 'arm64' },
    null,
  ]) assert.throws(() => validateNativeMacReleaseHost(invalid, 'arm64'))
  assert.throws(() => validateNativeMacReleaseHost(valid, 'x64'))
  assert.throws(() => validateNativeMacReleaseHost(valid, 'universal'))
})

test('native host command plan uses absolute tools, matching architecture, and bounded timeouts', () => {
  const outputPath = resolve('/tmp/release-host')
  for (const [architecture, machine] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
    const commands = nativeMacReleaseHostCommands({ platform: 'darwin', architecture, outputPath })
    assert.equal(commands.length, 2)
    assert.equal(commands[0].command, '/usr/bin/clang')
    assert.equal(commands[0].args.includes('-arch'), true)
    assert.equal(commands[0].args[commands[0].args.indexOf('-arch') + 1], machine)
    assert.equal(commands[0].args.includes(sourcePath), true)
    assert.equal(commands[0].args.at(-1), outputPath)
    assert.equal(commands[0].timeout, 30_000)
    assert.equal(commands[1].command, '/usr/bin/arch')
    assert.deepEqual(commands[1].args, [`-${machine}`, outputPath])
    assert.equal(commands[1].timeout, 5_000)
  }
  assert.throws(() => nativeMacReleaseHostCommands({ platform: 'linux', architecture: 'x64', outputPath }), /macOS/)
  assert.throws(() => nativeMacReleaseHostCommands({ platform: 'darwin', architecture: 'universal', outputPath }), /arm64 or x64/)
})

function childResult(overrides = {}) {
  return { status: 0, signal: null, stdout: '', stderr: '', error: undefined, ...overrides }
}

async function inspectWithMock(t, results) {
  const calls = []
  let index = 0
  t.mock.method(childProcess, 'spawnSync', (...args) => {
    assert.equal(existsSync(args[2].cwd), true, 'generated probe directory exists before execution')
    calls.push(args)
    return results[index++] ?? childResult()
  })
  return { evidence: await inspectNativeMacReleaseHost(), calls }
}

test('native host inspector runs forced-architecture probe and removes temporary helper', { skip: process.platform !== 'darwin' }, async (t) => {
  const translation = process.arch === 'x64' ? 'absent' : 0
  const result = await inspectWithMock(t, [
    childResult(),
    childResult({ stdout: `${JSON.stringify({ architecture: process.arch, translation })}\n` }),
  ])
  assert.deepEqual(result.evidence, { platform: 'darwin', architecture: process.arch, translated: false })
  assert.equal(result.calls.length, 2)
  const [compile, run] = result.calls
  assert.equal(compile[0], '/usr/bin/clang')
  assert.equal(run[0], '/usr/bin/arch')
  assert.equal(run[1][0], process.arch === 'x64' ? '-x86_64' : '-arm64')
  for (const [, , options] of result.calls) {
    assert.equal(options.encoding, 'utf8')
    assert.equal(options.stdio[0], 'ignore')
    assert.equal(options.stdio[1], 'pipe')
    assert.equal(options.stdio[2], 'pipe')
    assert.equal(options.killSignal, 'SIGKILL')
    assert.equal(options.maxBuffer <= 16 * 1024, true)
    assert.deepEqual(options.env, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: options.cwd })
    assert.equal(options.cwd.includes('agent-commons-release-host-'), true)
  }
  assert.equal(existsSync(compile[2].cwd), false, 'probe directory must be removed after completion')
})

test('native host inspector fails closed and cleans temporary helper on compiler and probe failures', { skip: process.platform !== 'darwin' }, async (t) => {
  const cases = [
    { label: 'compiler spawn error', results: [childResult({ error: new Error('spawn failed') })], count: 1 },
    { label: 'compiler nonzero status', results: [childResult({ status: 1 })], count: 1 },
    { label: 'compiler signal', results: [childResult({ status: null, signal: 'SIGKILL' })], count: 1 },
    { label: 'compiler stderr', results: [childResult({ stderr: 'warning' })], count: 1 },
    { label: 'probe spawn error', results: [childResult(), childResult({ error: new Error('spawn failed') })], count: 2 },
    { label: 'probe nonzero status', results: [childResult(), childResult({ status: 1 })], count: 2 },
    { label: 'probe signal', results: [childResult(), childResult({ status: null, signal: 'SIGTERM' })], count: 2 },
    { label: 'probe stderr', results: [childResult(), childResult({ stdout: '{"architecture":"arm64","translation":0}\n', stderr: 'diagnostic' })], count: 2 },
    { label: 'malformed probe output', results: [childResult(), childResult({ stdout: '{bad json}\n' })], count: 2 },
    { label: 'translated probe output', results: [childResult(), childResult({ stdout: `${JSON.stringify({ architecture: process.arch, translation: 1 })}\n` })], count: 2 },
  ]
  for (const scenario of cases) {
    await t.test(scenario.label, async (st) => {
      const calls = []
      let index = 0
      st.mock.method(childProcess, 'spawnSync', (...args) => {
        assert.equal(existsSync(args[2].cwd), true, 'generated probe directory exists before failure')
        calls.push(args)
        return scenario.results[index++] ?? childResult()
      })
      await assert.rejects(inspectNativeMacReleaseHost())
      assert.equal(calls.length, scenario.count)
      assert.equal(existsSync(calls[0][2].cwd), false, 'probe directory must be removed after failure')
    })
  }
})

test('release-host C helper classifies syscall results through a stubbed harness on macOS', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-host-c-test-'))
  const harnessPath = join(directory, 'harness.c')
  const executablePath = join(directory, 'harness')
  const harness = `
#include <errno.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
static const char *fixture_mode;
static int fixture_sysctlbyname(const char *name, void *oldp, size_t *oldlenp, void *newp, size_t newlen) {
  int value = 0;
  if (strcmp(name, "sysctl.proc_translated") || newp || newlen) { errno = EINVAL; return -1; }
  if (!strcmp(fixture_mode, "enoent")) { errno = ENOENT; return -1; }
  if (!strcmp(fixture_mode, "eperm")) { errno = EPERM; return -1; }
  if (!strcmp(fixture_mode, "einval")) { errno = EINVAL; return -1; }
  if (!strcmp(fixture_mode, "badvalue")) value = 2;
  if (!strcmp(fixture_mode, "translated")) value = 1;
  if (!strcmp(fixture_mode, "badsize")) *oldlenp = sizeof(value) + 1;
  else *oldlenp = sizeof(value);
  if (strcmp(fixture_mode, "badsize")) memcpy(oldp, &value, sizeof(value));
  return 0;
}
#define sysctlbyname fixture_sysctlbyname
#define main release_host_main
#include "${sourcePath.replaceAll('\\', '\\\\')}"
#undef main
#undef sysctlbyname
int main(int argc, char **argv) {
  if (argc != 2) return 99;
  fixture_mode = argv[1];
  return release_host_main();
}
`
  try {
    await writeFile(harnessPath, harness)
    const architecture = process.arch === 'x64' ? 'x86_64' : 'arm64'
    const compile = childProcess.spawnSync('/usr/bin/clang', [
      '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', '-arch', architecture, harnessPath, '-o', executablePath,
    ], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 })
    assert.equal(compile.error, undefined, compile.stderr)
    assert.equal(compile.status, 0, compile.stderr)
    const run = (mode) => childProcess.spawnSync('/usr/bin/arch', [`-${architecture}`, executablePath, mode], {
      encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024,
    })
    for (const mode of ['native', 'translated']) {
      const output = run(mode)
      assert.equal(output.status, 0, output.stderr)
      assert.deepEqual(JSON.parse(output.stdout), { architecture: process.arch, translation: mode === 'translated' ? 1 : 0 })
    }
    const absent = run('enoent')
    assert.equal(absent.status, 0, absent.stderr)
    assert.deepEqual(JSON.parse(absent.stdout), { architecture: process.arch, translation: 'absent' })
    for (const mode of ['eperm', 'einval', 'badsize', 'badvalue']) {
      const output = run(mode)
      assert.notEqual(output.status, 0, `${mode} must refuse`)
      assert.equal(output.stdout, '')
    }
  } finally {
    await rm(directory, { recursive: true, force: false })
  }
})
