import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGitFileHelper, gitFileBuildPlan } from './gitFileBuild.mjs'
import { listGitSharedIndexes, readGitFile } from './gitFileRead.mjs'

test('invalid relative Git paths are rejected before invoking a helper', async () => {
  const root = { path: '/tmp', identity: { dev: '1', ino: '2' } }
  for (const relativePath of ['', '/etc/passwd', '../outside', 'a/../b', 'a//b', './a', 'a\\b', 'a/\nb']) {
    assert.deepEqual(await readGitFile(root, relativePath, { executable: '/does/not/exist' }), { status: 'unsupported' })
  }
})

test('the helper receives a closed environment without caller Git, loader, or home settings', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-file-env-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'fake-helper')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ -z "${HOME+x}" ] && [ -z "${GIT_CONFIG_COUNT+x}" ] && [ -z "${GIT_DIR+x}" ] && [ -z "${DYLD_INSERT_LIBRARIES+x}" ] && [ "$PATH" = "/usr/bin:/bin" ]; then',
    '  printf "M\\n"',
    'else',
    '  printf "U\\n"',
    'fi',
    '',
  ].join('\n'))
  await chmod(executable, 0o755)
  const rootStat = await lstat(temporary, { bigint: true })
  const root = { path: temporary, identity: { dev: String(rootStat.dev), ino: String(rootStat.ino) } }
  const names = ['GIT_CONFIG_COUNT', 'GIT_DIR', 'DYLD_INSERT_LIBRARIES']
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  try {
    process.env.GIT_CONFIG_COUNT = '17'
    process.env.GIT_DIR = '/caller/repository'
    process.env.DYLD_INSERT_LIBRARIES = '/caller/injected.dylib'
    assert.deepEqual(await readGitFile(root, 'fixture', { executable }), { status: 'missing' })
  } finally {
    for (const name of names) {
      if (previous.get(name) === undefined) delete process.env[name]
      else process.env[name] = previous.get(name)
    }
  }
})

test('an abort during listener registration cannot leave child spawn errors unhandled', async () => {
  let aborted = false
  let abortedChecks = 0
  const signal = {
    get aborted() {
      abortedChecks += 1
      return aborted
    },
    addEventListener(type, listener) {
      assert.equal(type, 'abort')
      aborted = true
      listener()
    },
    removeEventListener() {},
  }
  const root = { path: '/tmp', identity: { dev: '1', ino: '2' } }
  await assert.rejects(
    readGitFile(root, 'fixture', { executable: '/does/not/exist', signal }),
    /cancelled/,
  )
  assert.equal(abortedChecks, 2)
})

test('native Git file helper reads pinned files and refuses symlink traversal', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-file-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  const plan = gitFileBuildPlan({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable })
  const built = buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable })
  assert.equal(built, executable)
  assert.equal(plan.compiler, '/usr/bin/clang')

  const rootPath = join(temporary, 'repo')
  const nested = join(rootPath, 'nested')
  const git = join(rootPath, '.git')
  const outsidePath = join(temporary, 'outside')
  await mkdir(nested, { recursive: true })
  await mkdir(git)
  await writeFile(join(nested, 'tracked.bin'), Buffer.from([0, 10, 255, 65]))
  await writeFile(join(git, 'index'), 'metadata fixture')
  await writeFile(join(git, `sharedindex.${'a'.repeat(40)}`), 'shared index 1')
  await writeFile(join(git, `sharedindex.${'b'.repeat(64)}`), 'shared index 2')
  await writeFile(join(git, `sharedindex.${'C'.repeat(40)}`), 'not a valid shared index name')
  await writeFile(join(git, 'sharedindex.short'), 'not a valid shared index name')
  await writeFile(join(outsidePath), 'must not be returned')
  await symlink(temporary, join(rootPath, 'escape'))
  await symlink(outsidePath, join(rootPath, 'file-link'))
  const rootStat = await lstat(rootPath, { bigint: true })
  const root = { path: rootPath, identity: { dev: String(rootStat.dev), ino: String(rootStat.ino) } }
  const options = { executable }

  const metadata = await readGitFile(root, 'nested/tracked.bin', { ...options, maxBytes: null })
  assert.equal(metadata.status, 'file')
  assert.equal(metadata.sizeBytes, 4)
  assert.match(metadata.version, /^\d+:\d+:\d+:-?\d+:/)
  assert.equal('bytes' in metadata, false)

  const contents = await readGitFile(root, 'nested/tracked.bin', { ...options, maxBytes: 16 })
  assert.equal(contents.status, 'file')
  assert.deepEqual(Buffer.from(contents.bytes), Buffer.from([0, 10, 255, 65]))
  assert.equal(contents.version, metadata.version)

  const tooLarge = await readGitFile(root, 'nested/tracked.bin', { ...options, maxBytes: 3 })
  assert.equal(tooLarge.status, 'too-large')
  assert.equal(tooLarge.sizeBytes, 4)
  assert.equal('bytes' in tooLarge, false)
  assert.deepEqual(await readGitFile(root, 'not-here', options), { status: 'missing' })
  assert.deepEqual(await readGitFile(root, 'file-link', options), { status: 'unsupported' })
  assert.deepEqual(await readGitFile(root, 'escape/outside', options), { status: 'unsupported' })
  assert.equal((await readGitFile(root, '.git/index', options)).status, 'file')
  const gitStat = await lstat(git, { bigint: true })
  const gitRoot = { path: git, identity: { dev: String(gitStat.dev), ino: String(gitStat.ino) } }
  assert.deepEqual(await listGitSharedIndexes(gitRoot, options), [
    `sharedindex.${'a'.repeat(40)}`,
    `sharedindex.${'b'.repeat(64)}`,
  ])

  await assert.rejects(readGitFile({ ...root, identity: { dev: '0', ino: '0' } }, 'nested/tracked.bin', options), /changed during capture/)
  assert.equal(await readFile(outsidePath, 'utf8'), 'must not be returned')
})

test('native helper reports a changed leaf instead of an omission when open races a symlink swap', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-file-race-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file-test')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable, testHooks: true }), executable)

  const rootPath = join(temporary, 'repo')
  const filePath = join(rootPath, 'tracked.txt')
  const backupPath = join(rootPath, 'tracked.original')
  const outsidePath = join(temporary, 'outside')
  const readyPath = join(temporary, 'ready')
  const releasePath = join(temporary, 'release')
  await mkdir(rootPath)
  await writeFile(filePath, 'tracked bytes')
  await writeFile(outsidePath, 'outside bytes')
  const rootStat = await lstat(rootPath, { bigint: true })

  const child = spawn(executable, [rootPath, String(rootStat.dev), String(rootStat.ino), 'tracked.txt', '128'], {
    cwd: '/',
    env: {
      PATH: '/usr/bin:/bin',
      LC_ALL: 'C',
      AGENT_COMMONS_GIT_FILE_TEST_READY: readyPath,
      AGENT_COMMONS_GIT_FILE_TEST_RELEASE: releasePath,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const outputPromise = new Promise((resolve, reject) => {
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(Buffer.concat(chunks).toString('ascii')) : reject(new Error(`helper exited ${code}`)))
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { await lstat(readyPath); break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await lstat(readyPath)
  await rename(filePath, backupPath)
  await symlink(outsidePath, filePath)
  await writeFile(releasePath, 'continue')
  assert.equal(await outputPromise, 'C\n')
})

test('native shared-index enumeration refuses more than 64 matching entries or 512 visited entries', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-git-file-list-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const executable = join(temporary, 'agent-commons-git-file')
  assert.equal(buildGitFileHelper({ targetPlatform: 'darwin', targetArch: process.arch, outputPath: executable }), executable)

  const tooManyMatches = join(temporary, 'many-matches')
  await mkdir(tooManyMatches)
  for (let index = 0; index < 65; index += 1) {
    await writeFile(join(tooManyMatches, `sharedindex.${String(index + 1).padStart(40, '0')}`), '')
  }
  const matchStat = await lstat(tooManyMatches, { bigint: true })
  const matchRoot = { path: tooManyMatches, identity: { dev: String(matchStat.dev), ino: String(matchStat.ino) } }
  await assert.rejects(listGitSharedIndexes(matchRoot, { executable }), /changed during capture/)

  const tooManyEntries = join(temporary, 'many-entries')
  await mkdir(tooManyEntries)
  for (let index = 0; index < 513; index += 1) await writeFile(join(tooManyEntries, `entry-${index}`), '')
  const entryStat = await lstat(tooManyEntries, { bigint: true })
  const entryRoot = { path: tooManyEntries, identity: { dev: String(entryStat.dev), ino: String(entryStat.ino) } }
  await assert.rejects(listGitSharedIndexes(entryRoot, { executable }), /changed during capture/)
})
