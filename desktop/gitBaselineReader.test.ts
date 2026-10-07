import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { MAX_GIT_SNAPSHOT_FILE_BYTES } from '../contract/localGitSnapshot.mjs'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { withLocalGitBaseline, parseGitTree } from './gitBaselineReader.mjs'
import { createLocalGitReader, localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'

const GIT_EXECUTABLE = process.platform === 'darwin'
  ? join(bundledGitDirectory({ packaged: false }), 'git')
  : undefined
const FILE_EXECUTABLE = buildGitFileTestHelper()
const AVAILABLE = !!GIT_EXECUTABLE && !!FILE_EXECUTABLE && existsSync(GIT_EXECUTABLE) && existsSync(FILE_EXECUTABLE)

function git(root: string, args: string[], input?: Uint8Array): Buffer {
  const result = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git baseline fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args,
  ], {
    cwd: root,
    env: localGitCommandEnvironment(),
    input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr.toString('utf8'))
  return result.stdout
}

async function fixture(t: any, objectFormat: 'sha1' | 'sha256' = 'sha1') {
  assert.ok(AVAILABLE, 'the pinned bundled Git and native descriptor helper are available')
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-baseline-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const path = join(parent, 'repository')
  await mkdir(join(path, 'src', 'nested'), { recursive: true })
  git(path, ['init', '--template=', '--initial-branch=main', `--object-format=${objectFormat}`, '.'])
  await mkdir(join(path, 'src', 'nested'), { recursive: true })
  await writeFile(join(path, 'src', 'nested', 'tracked.txt'), 'HEAD bytes\n')
  await writeFile(join(path, 'removed.txt'), 'deleted from index\n')
  await writeFile(join(path, 'target.txt'), 'target body\n')
  await writeFile(join(path, 'large.txt'), 'L'.repeat(70 * 1024))
  await symlink('target.txt', join(path, 'link.txt'))
  git(path, ['add', '--', 'src/nested/tracked.txt', 'removed.txt', 'target.txt', 'large.txt', 'link.txt'])
  git(path, ['commit', '-m', 'initial'])
  const firstCommit = git(path, ['rev-parse', 'HEAD']).toString('ascii').trim()
  return { parent, path, firstCommit, objectFormat }
}

function baselineOptions(path: string, capture: string[] = []) {
  const reader = createLocalGitReader({ gitExecutable: GIT_EXECUTABLE, fileExecutable: FILE_EXECUTABLE })
  return {
    reader,
    options: {
      gitExecutable: GIT_EXECUTABLE,
      fileExecutable: FILE_EXECUTABLE,
      runGit: async (args: string[], options: { cwd: string; signal?: AbortSignal; input?: Uint8Array }) => {
        const absolute = resolve(path)
        assert.notEqual(options.cwd, absolute)
        assert.equal(options.cwd.startsWith(`${absolute}/`), false, 'Git works only in private staging')
        assert.equal(args.some((argument) => argument.includes(absolute)), false, 'source paths never reach Git')
        capture.push(options.cwd)
        return runLocalGit(GIT_EXECUTABLE, args, options)
      },
    },
  }
}

async function withPinned(path: string, options: any, callback: (value: any) => unknown) {
  const { reader } = options
  const pinned = await reader.inspectLocalGitRoot(path)
  return withLocalGitBaseline(pinned, options.options, callback)
}

async function assertStagingRemoved(paths: string[]) {
  for (const path of new Set(paths)) await assert.rejects(access(path))
}

async function indexMetadataSnapshot(gitDirectory: string) {
  const names = (await readdir(gitDirectory)).filter((name) => name === 'index' || /^sharedindex\.[a-f0-9]+$/.test(name)).sort()
  return Promise.all(names.map(async (name) => {
    const details = await stat(join(gitDirectory, name), { bigint: true })
    return [name, String(details.ino), String(details.size), String(details.mtimeNs), String(details.ctimeNs)]
  }))
}

test('HEAD and staged index blobs stay distinct across SHA-1/SHA-256, split indexes and packed objects', {
  skip: !AVAILABLE,
}, async (t) => {
  for (const objectFormat of ['sha1', 'sha256'] as const) {
    const repository = await fixture(t, objectFormat)
    const path = repository.path
    git(path, ['update-index', '--split-index'])
    git(path, ['gc', '--aggressive', '--prune=now'])
    git(path, ['pack-refs', '--all', '--prune'])
    const packedRefs = await readFile(join(path, '.git', 'packed-refs'), 'utf8')
    assert.match(packedRefs, /refs\/heads\/main/)

    await writeFile(join(path, 'src/nested/tracked.txt'), 'staged index bytes\n')
    git(path, ['add', '--', 'src/nested/tracked.txt'])
    await writeFile(join(path, 'staged-only.txt'), 'new index bytes\n')
    git(path, ['add', '--', 'staged-only.txt'])
    git(path, ['rm', '--', 'removed.txt'])
    await writeFile(join(path, 'src/nested/tracked.txt'), 'unstaged working-tree bytes\n')

    const gitCalls: string[] = []
    const options = baselineOptions(path, gitCalls)
    const pinned = await options.reader.inspectLocalGitRoot(path)
    const sourceIndexBefore = await indexMetadataSnapshot(pinned.repository.path)
    assert.ok(sourceIndexBefore.some(([name]) => name === 'index'))
    assert.ok(sourceIndexBefore.some(([name]) => String(name).startsWith('sharedindex.')),
      'the fixture uses a split index and shared index')
    let seen = false
    const result = await withLocalGitBaseline(pinned, options.options, async ({ objectFormat: actualFormat, head, headEntries, indexEntries, readBlob, probeBlob }) => {
      seen = true
      assert.equal(actualFormat, objectFormat)
      assert.equal(head.oid, repository.firstCommit)
      assert.equal(head.ref, 'refs/heads/main')
      const headByPath = new Map(headEntries.map((entry: any) => [entry.name, entry]))
      const indexByPath = new Map(indexEntries.filter((entry: any) => entry.stage === 0).map((entry: any) => [entry.name, entry]))
      const headFile = headByPath.get('src/nested/tracked.txt') as any
      const indexFile = indexByPath.get('src/nested/tracked.txt') as any
      assert.ok(headFile)
      assert.ok(indexFile)
      assert.notEqual(headFile.oid, indexFile.oid)
      assert.equal(Buffer.from(await readBlob(headFile.oid)).toString('utf8'), 'HEAD bytes\n')
      assert.equal(Buffer.from(await readBlob(indexFile.oid)).toString('utf8'), 'staged index bytes\n')
      assert.equal(Buffer.from(await readBlob(indexByPath.get('staged-only.txt').oid)).toString('utf8'), 'new index bytes\n')
      assert.ok(headByPath.has('removed.txt'))
      assert.equal(indexByPath.has('removed.txt'), false)
      assert.equal(headByPath.has('staged-only.txt'), false)
      assert.equal(headByPath.has('link.txt'), true)
      assert.equal(Buffer.from(await readBlob(headByPath.get('target.txt').oid)).toString('utf8'), 'target body\n')
      assert.deepEqual(await probeBlob(headByPath.get('large.txt').oid), { sizeHintBytes: 70 * 1024, contentVerified: false },
        'large admitted blobs expose only explicitly unverified size hints without reading content')
      return 'captured'
    })
    assert.equal(seen, true)
    assert.equal(result, 'captured')
    assert.deepEqual(await indexMetadataSnapshot(pinned.repository.path), sourceIndexBefore,
      'reading the source index and shared index leaves identity and timestamps untouched')
    await assertStagingRemoved(gitCalls)
    const largeOid = git(path, ['rev-parse', 'HEAD:large.txt']).toString('ascii').trim()
    await assert.rejects(withLocalGitBaseline(pinned, options.options, async ({ readBlob }) => {
      try { await readBlob(largeOid) } catch {}
      return 'oversized default blob read cannot be swallowed'
    }), /Git baseline/i)
  }
})

test('HEAD tree resolution does not require a UTF-8 commit message', { skip: !AVAILABLE }, async (t) => {
  const repository = await fixture(t)
  const tree = git(repository.path, ['rev-parse', 'HEAD^{tree}']).toString('ascii').trim()
  const commit = Buffer.concat([
    Buffer.from(`tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\nencoding ISO-8859-1\n\n`),
    Buffer.from([0xe9, 0xff, 0x0a]),
  ])
  const oid = git(repository.path, ['hash-object', '-t', 'commit', '-w', '--stdin'], commit).toString('ascii').trim()
  git(repository.path, ['update-ref', 'refs/heads/main', oid])
  const value = await withPinned(repository.path, baselineOptions(repository.path), async ({ head, headEntries, readBlob }) => ({
    oid: head.oid,
    body: Buffer.from(await readBlob(headEntries.find((entry: any) => entry.name === 'src/nested/tracked.txt').oid)).toString('utf8'),
  }))
  assert.deepEqual(value, { oid, body: 'HEAD bytes\n' })
})

test('unborn SHA-256 repositories with no index return an empty baseline and detect format from config', {
  skip: !AVAILABLE,
}, async (t) => {
  assert.ok(AVAILABLE)
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-baseline-unborn-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const path = join(parent, 'repository')
  await mkdir(path)
  git(path, ['init', '--template=', '--initial-branch=main', '--object-format=sha256', '.'])
  await assert.rejects(access(join(path, '.git', 'index')))
  const options = baselineOptions(path)
  const value = await withPinned(path, options, async ({ objectFormat, head, headEntries, indexEntries }) => ({
    objectFormat, head, headEntries, indexEntries,
  }))
  assert.equal(value.objectFormat, 'sha256')
  assert.deepEqual(value.head, { oid: null, ref: 'refs/heads/main' })
  assert.deepEqual(value.headEntries, [])
  assert.deepEqual(value.indexEntries, [])
})

test('linked worktrees use their pinned HEAD while resolving shared refs and objects from common metadata', {
  skip: !AVAILABLE,
}, async (t) => {
  const main = await fixture(t)
  const linkedPath = join(main.parent, 'linked-worktree')
  git(main.path, ['worktree', 'add', '-b', 'review-branch', linkedPath])
  await writeFile(join(linkedPath, 'worktree-only.txt'), 'linked head\n')
  git(linkedPath, ['add', '--', 'worktree-only.txt'])
  git(linkedPath, ['commit', '-m', 'linked worktree commit'])
  const options = baselineOptions(linkedPath)
  const pinned = await options.reader.inspectLocalGitRoot(linkedPath)
  assert.notEqual(pinned.repository.path, pinned.repository.commonPath)
  const value = await withLocalGitBaseline(pinned, options.options, async ({ head, headEntries, readBlob }) => ({
    head,
    linked: Buffer.from(await readBlob(headEntries.find((entry: any) => entry.name === 'worktree-only.txt').oid)).toString('utf8'),
  }))
  assert.equal(value.head.ref, 'refs/heads/review-branch')
  assert.notEqual(value.head.oid, main.firstCommit)
  assert.equal(value.linked, 'linked head\n')
})

test('readBlob refuses arbitrary, symlink and gitlink object ids even when callback catches the error', {
  skip: !AVAILABLE,
}, async (t) => {
  const repository = await fixture(t)
  const outsideOid = git(repository.path, ['hash-object', '-w', '--stdin'], Buffer.from('not in HEAD or index')).toString('ascii').trim()
  const submodule = await fixture(t)
  const gitlinkOid = git(submodule.path, ['rev-parse', 'HEAD']).toString('ascii').trim()
  git(repository.path, ['update-index', '--add', '--cacheinfo', `160000,${gitlinkOid},submodule`])
  const options = baselineOptions(repository.path)
  const pinned = await options.reader.inspectLocalGitRoot(repository.path)
  const requests = await withLocalGitBaseline(pinned, options.options, async ({ headEntries, indexEntries }) => {
    const symlinkOid = headEntries.find((entry: any) => entry.name === 'link.txt').oid
    const gitlink = indexEntries.find((entry: any) => entry.mode === '160000')
    return [outsideOid, symlinkOid, gitlink.oid]
  })
  for (const oid of requests) {
    await assert.rejects(withLocalGitBaseline(pinned, options.options, async ({ readBlob }) => {
      try { await readBlob(oid) } catch {}
      return 'a refused oid cannot be hidden by a callback'
    }), /Git baseline/i)
  }
  await assert.rejects(withLocalGitBaseline(pinned, options.options, async ({ indexEntries, readBlob }) => {
    const regular = indexEntries.find((entry: any) => entry.mode === '100644')
    await readBlob(regular.oid, MAX_GIT_SNAPSHOT_FILE_BYTES + 1)
  }), /Git baseline/i)
})

test('index and ref changes during the callback invalidate otherwise valid baseline output', {
  skip: !AVAILABLE,
}, async (t) => {
  const repository = await fixture(t)
  const path = repository.path
  const options = baselineOptions(path)
  const pinned = await options.reader.inspectLocalGitRoot(path)
  const stagedFile = join(path, 'src/nested/tracked.txt')
  await writeFile(stagedFile, 'staged\n')
  git(path, ['add', '--', 'src/nested/tracked.txt'])
  await assert.rejects(withLocalGitBaseline(pinned, options.options, async ({ indexEntries }) => {
    assert.ok(indexEntries.length)
    await writeFile(join(pinned.repository.path, 'index'), 'changed before final fence')
    return 'changed index must not publish'
  }), /Git baseline/i)

  const second = await fixture(t)
  const nextFile = join(second.path, 'next.txt')
  await writeFile(nextFile, 'next commit\n')
  git(second.path, ['add', '--', 'next.txt'])
  git(second.path, ['commit', '-m', 'next commit'])
  const nextOid = git(second.path, ['rev-parse', 'HEAD']).toString('ascii').trim()
  const secondOptions = baselineOptions(second.path)
  const secondPinned = await secondOptions.reader.inspectLocalGitRoot(second.path)
  await assert.rejects(withLocalGitBaseline(secondPinned, secondOptions.options, async ({ head }) => {
    assert.equal(head.oid, nextOid)
    await writeFile(join(secondPinned.repository.commonPath, 'refs', 'heads', 'main'), `${second.firstCommit}\n`)
    return 'changed ref must not publish'
  }), /Git baseline/i)
})

test('tree parser admits canonical entries and rejects malformed structure', () => {
  const oid = Buffer.from('a'.repeat(40), 'hex')
  const treeEntry = (mode: string, name: string, objectId = oid) => Buffer.concat([
    Buffer.from(`${mode} ${name}\0`, 'utf8'), objectId,
  ])
  const valid = Buffer.concat([treeEntry('40000', 'dir'), treeEntry('100644', 'file.txt')])
  assert.deepEqual(parseGitTree(valid, 'sha1'), [
    { name: 'dir', mode: '040000', oid: 'a'.repeat(40) },
    { name: 'file.txt', mode: '100644', oid: 'a'.repeat(40) },
  ])
  for (const invalid of [
    Buffer.from('100644 name'),
    treeEntry('100644', 'bad/name'),
    treeEntry('100644', '../escape'),
    treeEntry('100600', 'bad-mode'),
    Buffer.concat([treeEntry('100644', 'same'), treeEntry('100644', 'same')]),
    treeEntry('100644', 'zero', Buffer.alloc(20)),
    Buffer.concat([Buffer.from('100644 '), Buffer.from([0xff]), Buffer.from([0]), oid]),
  ]) assert.throws(() => parseGitTree(invalid, 'sha1'))
  assert.throws(() => parseGitTree(valid, 'sha256'))
})
