import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { bundledGitDirectory, bundledGitProbeEnvironment } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { readGitIgnoredPaths } from './gitIgnore.mjs'
import { readGitFile } from './gitFileRead.mjs'
import { runLocalGit } from './localGitReader.mjs'

const GIT = process.platform === 'darwin' ? join(bundledGitDirectory({ packaged: false }), 'git') : undefined
const FILE = buildGitFileTestHelper()
const AVAILABLE = !!GIT && !!FILE && existsSync(GIT) && existsSync(FILE)

function git(root: string, args: string[], input?: Uint8Array): Buffer {
  const result = spawnSync(GIT!, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null', '-c', 'user.name=Ignore fixture',
    '-c', 'user.email=fixture@example.invalid', ...args], {
    cwd: root, env: bundledGitProbeEnvironment(), input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr.toString('utf8'))
  return result.stdout
}

function privatePaths(parent: string) {
  return { staging: parent, metadata: join(parent, 'metadata'), worktree: join(parent, 'worktree') }
}

async function fakeContext(t: any, overrides: any = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-ignore-unit-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const paths = privatePaths(parent)
  await mkdir(join(paths.metadata, 'objects'), { recursive: true })
  await mkdir(join(paths.metadata, 'refs'), { recursive: true })
  await mkdir(paths.worktree, { recursive: true })
  await writeFile(join(paths.metadata, 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(join(paths.metadata, 'config'), '[core]\nrepositoryformatversion=0\nbare=false\n')
  const calls: any[] = []
  const reservations: number[] = []
  const source = new Map<string, Uint8Array>()
  const load = async (_base: any, name: string, maxBytes: number) => {
    const bytes = source.get(name)
    if (!bytes) return { status: 'missing' }
    if (bytes.length > maxBytes) return { status: 'too-large', sizeBytes: bytes.length, version: 'v1' }
    return { status: 'file', sizeBytes: bytes.length, version: 'v1', bytes }
  }
  const runGit = async (args: string[], options: any) => {
    calls.push({ args, options })
    const candidates = Buffer.from(options.input).toString('utf8').split('\0').filter(Boolean)
    const matched = candidates.filter((path: string) => path.includes('ignored'))
    return { status: matched.length ? 0 : 1, stdout: matched.length ? Buffer.from(`${matched.join('\0')}\0`) : Buffer.alloc(0) }
  }
  return {
    input: { root: { path: '/source/root' }, common: { path: '/source/common' }, ...paths,
      entries: [{ name: 'ignored.txt', mode: '100644' }], load, runGit,
      reserveMetadata: (size: number) => reservations.push(size), ...overrides },
    source, calls, reservations,
  }
}

test('ignore evaluation copies only bounded ignore metadata and sends candidates only to private Git stdin', async (t) => {
  const context = await fakeContext(t)
  context.source.set('.gitignore', Buffer.from('ignored.txt\n'))
  context.source.set('info/exclude', Buffer.from('local-only\n'))
  const result = await readGitIgnoredPaths(context.input)
  assert.deepEqual([...result], ['ignored.txt'])
  assert.deepEqual(context.reservations, [Buffer.byteLength('ignored.txt\n'), Buffer.byteLength('local-only\n')])
  assert.equal(context.calls.length, 1)
  const [{ args, options }] = context.calls
  assert.deepEqual(args.slice(2), ['check-ignore', '--no-index', '-z', '--stdin', '--'])
  assert.equal(options.cwd, context.input.staging)
  assert.deepEqual(Buffer.from(options.input).toString('utf8'), 'ignored.txt\0')
  assert.equal(options.input.byteLength <= 32 * 1024, true)
  assert.equal(args.some((arg: string) => arg.includes('/source/')), false)
})

test('ignore metadata skips only missing/unsupported per-directory files and refuses unsafe statuses', async (t) => {
  const skipped = await fakeContext(t, { entries: [{ name: 'candidate', mode: '100644' }] })
  skipped.input.load = async (_base: any, name: string) => name === '.gitignore'
    ? { status: 'unsupported' } : name === 'info/exclude' ? { status: 'missing' } : { status: 'missing' }
  assert.deepEqual([...await readGitIgnoredPaths(skipped.input)], [])

  for (const badStatus of ['unreadable', 'too-large', 'changed']) {
    const context = await fakeContext(t)
    context.input.load = async (_base: any, name: string) => name === '.gitignore'
      ? { status: badStatus, sizeBytes: 99 } : { status: 'missing' }
    await assert.rejects(readGitIgnoredPaths(context.input), /ignore evaluation/i)
  }
  const badExclude = await fakeContext(t)
  badExclude.input.load = async (_base: any, name: string) => name === 'info/exclude'
    ? { status: 'unsupported' } : { status: 'missing' }
  await assert.rejects(readGitIgnoredPaths(badExclude.input), /ignore evaluation/i)

  const exhausted = await fakeContext(t)
  exhausted.input.load = async (_base: any, name: string) => name === '.gitignore'
    ? { status: 'file', sizeBytes: 1, bytes: Buffer.from('x') } : { status: 'missing' }
  exhausted.input.reserveMetadata = () => false
  await assert.rejects(readGitIgnoredPaths(exhausted.input), /ignore evaluation/i)
})

test('candidate batches stay at or below 32 KiB and directory/depth bounds fail before Git', async (t) => {
  const names = Array.from({ length: 500 }, (_, i) => `shared/${String(i).padStart(3, '0')}-${'x'.repeat(70)}`)
  const context = await fakeContext(t, { entries: names.map(name => ({ name, mode: '100644' })) })
  context.input.runGit = async (args: string[], options: any) => {
    context.calls.push({ args, options })
    assert.ok(options.input.byteLength <= 32 * 1024)
    return { status: 1, stdout: Buffer.alloc(0) }
  }
  assert.deepEqual([...await readGitIgnoredPaths(context.input)], [])
  assert.ok(context.calls.length > 1)
  assert.ok(context.calls.every(call => call.options.input.byteLength <= 32 * 1024))

  const tooDeep = await fakeContext(t, { entries: [{ name: `${Array.from({ length: 65 }, (_, i) => `d${i}`).join('/')}/file`, mode: '100644' }] })
  await assert.rejects(readGitIgnoredPaths(tooDeep.input), /ignore evaluation/i)
  assert.equal(tooDeep.calls.length, 0)
  const tooManyDirs = await fakeContext(t, { entries: Array.from({ length: 300 }, (_, i) => ({
    name: `d${i}/x${i}/y${i}/z${i}/file`, mode: '100644',
  })) })
  await assert.rejects(readGitIgnoredPaths(tooManyDirs.input), /ignore evaluation/i)
  assert.equal(tooManyDirs.calls.length, 0)
})

test('invalid input and malformed check-ignore responses fail closed', async (t) => {
  for (const entries of [
    [{ name: '../escape', mode: '100644' }],
    [{ name: '.git/config', mode: '100644' }],
    [{ name: 'candidate', mode: '100644', oid: 'unexpected' }],
    Array.from({ length: 501 }, (_, i) => ({ name: `f${i}`, mode: '100644' })),
  ]) {
    const context = await fakeContext(t, { entries })
    await assert.rejects(readGitIgnoredPaths(context.input), /ignore evaluation/i)
    assert.equal(context.calls.length, 0)
  }
  const responses = [
    { status: 2, stdout: Buffer.alloc(0) },
    { status: 0, stdout: Buffer.alloc(0) },
    { status: 1, stdout: Buffer.from('ignored.txt') },
    { status: 0, stdout: Buffer.alloc(32 * 1024 + 1) },
    { status: 0, stdout: Buffer.from('foreign.txt\0') },
    { status: 0, stdout: Buffer.from([0xff, 0]) },
    { status: 0, stdout: Buffer.from('ignored.txt\0ignored.txt\0') },
  ]
  for (const response of responses) {
    const context = await fakeContext(t)
    context.input.runGit = async () => response
    await assert.rejects(readGitIgnoredPaths(context.input), /ignore evaluation/i)
  }
})

test('real bundled Git honors nested ignore rules, negations, and HEAD-only deletion candidates', {
  skip: !AVAILABLE,
}, async (t) => {
  assert.ok(AVAILABLE)
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-ignore-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const rootPath = join(parent, 'source')
  const gitDir = join(rootPath, '.git')
  await mkdir(join(rootPath, 'nested', 'deep'), { recursive: true })
  git(rootPath, ['init', '--template=', '--initial-branch=main', '.'])
  await writeFile(join(rootPath, '.gitignore'), 'head-only.txt\n*.tmp\n!keep.tmp\nnested/deep/\n')
  await writeFile(join(rootPath, 'nested', '.gitignore'), 'local.secret\n!keep.secret\n')
  for (const name of ['head-only.txt', 'nested/hidden.tmp', 'keep.tmp', 'nested/keep.secret',
    'nested/local.secret', 'nested/deep/inside.txt', 'visible.txt']) {
    await mkdir(join(rootPath, name, '..'), { recursive: true })
    await writeFile(join(rootPath, name), 'source bytes must never enter the private worktree')
  }
  git(rootPath, ['add', '--', '.gitignore', 'nested/.gitignore', 'visible.txt'])
  git(rootPath, ['add', '-f', '--', 'head-only.txt'])
  git(rootPath, ['commit', '-m', 'ignore fixtures'])
  git(rootPath, ['rm', '--cached', '--', 'head-only.txt'])

  const fileExecutable = FILE!
  const helper = await import('./gitFileRead.mjs')
  const rootStat = await import('node:fs/promises').then(fs => fs.lstat(rootPath, { bigint: true }))
  const gitStat = await import('node:fs/promises').then(fs => fs.lstat(gitDir, { bigint: true }))
  const root = { path: rootPath, identity: { dev: String(rootStat.dev), ino: String(rootStat.ino) } }
  const common = { path: gitDir, identity: { dev: String(gitStat.dev), ino: String(gitStat.ino) } }
  const staging = join(parent, 'private')
  const metadata = join(staging, 'metadata')
  const worktree = join(staging, 'worktree')
  await mkdir(join(metadata, 'objects'), { recursive: true })
  await mkdir(join(metadata, 'refs'), { recursive: true })
  await mkdir(worktree, { recursive: true })
  await writeFile(join(metadata, 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(join(metadata, 'config'), '[core]\nrepositoryformatversion=0\nbare=false\n')
  const sourceReads: string[] = []
  const reservations: number[] = []
  const names = ['head-only.txt', 'nested/hidden.tmp', 'keep.tmp', 'nested/keep.secret',
    'nested/local.secret', 'nested/deep/inside.txt', 'visible.txt']
  const ignored = await readGitIgnoredPaths({
    root, common, metadata, worktree, staging,
    entries: names.map(name => ({ name, mode: '100644' })),
    load: async (base: any, name: string, maxBytes: number) => {
      sourceReads.push(`${base.path}:${name}`)
      return helper.readGitFile(base, name, { maxBytes, executable: fileExecutable })
    },
    runGit: (args: string[], options: any) => runLocalGit(GIT, args, options),
    reserveMetadata: (size: number) => reservations.push(size),
  })
  assert.deepEqual([...ignored].sort(), ['head-only.txt', 'nested/deep/inside.txt', 'nested/hidden.tmp', 'nested/local.secret'])
  assert.ok(sourceReads.every(name => name.includes('.gitignore') || name.endsWith(':info/exclude')))
  assert.ok(reservations.reduce((sum, size) => sum + size, 0) < 64 * 1024)
  assert.equal(await import('node:fs/promises').then(fs => fs.readFile(join(worktree, 'visible.txt'), 'utf8')), '')
})
