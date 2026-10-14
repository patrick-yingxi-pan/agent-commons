import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { parseLocalGitFileComparison } from '../contract/localGitFileComparison.mjs'
import { MAX_GIT_SNAPSHOT_FILE_BYTES } from '../contract/localGitSnapshot.mjs'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { readGitFile } from './gitFileRead.mjs'
import { createLocalGitReader, localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'
import { readLocalGitFileComparison } from './localGitFileComparison.mjs'

const GIT_EXECUTABLE = process.platform === 'darwin'
  ? join(bundledGitDirectory({ packaged: false }), 'git')
  : undefined
const FILE_EXECUTABLE = buildGitFileTestHelper()
const AVAILABLE = !!GIT_EXECUTABLE && !!FILE_EXECUTABLE && existsSync(GIT_EXECUTABLE) && existsSync(FILE_EXECUTABLE)

function git(root: string, args: string[], allowFailure = false): Buffer {
  const result = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git file comparison fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args,
  ], { cwd: root, env: localGitCommandEnvironment(), maxBuffer: 16 * 1024 * 1024 })
  if (!allowFailure) assert.equal(result.status, 0, result.stderr.toString('utf8'))
  return result.stdout
}

async function repository(t: any, files: Record<string, string | Uint8Array> = {
  'src/selected.txt': 'HEAD selected\n',
  'src/other.txt': 'unrelated body\n',
}) {
  assert.ok(AVAILABLE, 'pinned bundled Git and native descriptor helper are available')
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-file-comparison-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const path = join(parent, 'repository')
  await mkdir(path)
  git(path, ['init', '--template=', '--initial-branch=main', '.'])
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(path, name, '..'), { recursive: true })
    await writeFile(join(path, name), body)
  }
  git(path, ['add', '--all', '--'])
  git(path, ['commit', '-m', 'comparison baseline'])
  const reader = createLocalGitReader({ gitExecutable: GIT_EXECUTABLE, fileExecutable: FILE_EXECUTABLE })
  const root = await reader.inspectLocalGitRoot(path)
  return { parent, path, root }
}

function options(path: string, extra: Record<string, unknown> = {}, reads: string[] = []) {
  const absolute = path
  const suppliedReadFile = extra.readFile as ((base: any, name: string, settings: any) => Promise<any>) | undefined
  return {
    gitExecutable: GIT_EXECUTABLE,
    fileExecutable: FILE_EXECUTABLE,
    ...extra,
    readFile: async (base: any, name: string, settings: any) => {
      if (base.path === absolute) reads.push(name)
      return suppliedReadFile
        ? suppliedReadFile(base, name, settings)
        : readGitFile(base, name, { ...settings, executable: FILE_EXECUTABLE })
    },
    runGit: async (args: string[], settings: any) => {
      assert.equal(settings.cwd === absolute || settings.cwd.startsWith(`${absolute}/`), false,
        'Git reads only private staged metadata')
      assert.equal(args.some((argument: string) => argument.includes(absolute)), false, 'source paths never reach Git')
      return runLocalGit(GIT_EXECUTABLE, args, settings)
    },
  }
}

const sideText = (side: any, body: string, mode = '100644') => assert.deepEqual(side, { kind: 'text', text: body, mode })

test('staged and unstaged comparisons return the exact selected two sides, including unchanged and empty content', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { 'src/selected.txt': 'HEAD\r\n', 'src/other.txt': 'unrelated body\n', 'empty.txt': '' })
  await writeFile(join(repo.path, 'src/selected.txt'), 'INDEX\n')
  git(repo.path, ['add', '--', 'src/selected.txt'])
  await writeFile(join(repo.path, 'src/selected.txt'), 'WORKING\n')
  const settings = options(repo.path)
  const staged = await readLocalGitFileComparison(repo.root, { path: 'src/selected.txt', comparison: 'staged' }, settings)
  assert.deepEqual(staged, {
    version: 1, scope: 'file-comparison', path: 'src/selected.txt', comparison: 'staged', head: staged.head,
    status: 'ready', change: 'modified', before: { kind: 'text', text: 'HEAD\r\n', mode: '100644' },
    after: { kind: 'text', text: 'INDEX\n', mode: '100644' },
  })
  const unstaged = await readLocalGitFileComparison(repo.root, { path: 'src/selected.txt', comparison: 'unstaged' }, settings)
  assert.equal(unstaged.status, 'ready')
  if (unstaged.status === 'ready') {
    assert.equal(unstaged.change, 'modified')
    sideText(unstaged.before, 'INDEX\n')
    sideText(unstaged.after, 'WORKING\n')
  }
  const unchanged = await readLocalGitFileComparison(repo.root, { path: 'src/other.txt', comparison: 'unstaged' }, settings)
  assert.equal(unchanged.status, 'ready', JSON.stringify(unchanged))
  if (unchanged.status === 'ready') {
    assert.equal(unchanged.change, 'unchanged')
    sideText(unchanged.before, 'unrelated body\n')
    sideText(unchanged.after, 'unrelated body\n')
  }
  const empty = await readLocalGitFileComparison(repo.root, { path: 'empty.txt', comparison: 'staged' }, settings)
  assert.equal(empty.status, 'ready')
  if (empty.status === 'ready') {
    sideText(empty.before, '')
    sideText(empty.after, '')
  }
  assert.deepEqual(parseLocalGitFileComparison(staged), staged)
})

test('staged addition/deletion and unstaged deletion preserve missing sides and never read an untracked replacement', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { 'gone.txt': 'tracked before\n', 'work-delete.txt': 'working deletion\n' })
  await writeFile(join(repo.path, 'added.txt'), 'staged addition\n')
  git(repo.path, ['add', '--', 'added.txt'])
  git(repo.path, ['rm', '--', 'gone.txt'])
  await writeFile(join(repo.path, 'gone.txt'), 'untracked replacement\n')
  const settings = options(repo.path)
  const added = await readLocalGitFileComparison(repo.root, { path: 'added.txt', comparison: 'staged' }, settings)
  assert.equal(added.status, 'ready')
  if (added.status === 'ready') {
    assert.equal(added.change, 'added')
    assert.deepEqual(added.before, { kind: 'missing' })
    sideText(added.after, 'staged addition\n')
  }
  const deleted = await readLocalGitFileComparison(repo.root, { path: 'gone.txt', comparison: 'staged' }, settings)
  assert.equal(deleted.status, 'ready')
  if (deleted.status === 'ready') {
    assert.equal(deleted.change, 'deleted')
    sideText(deleted.before, 'tracked before\n')
    assert.deepEqual(deleted.after, { kind: 'missing' })
  }
  assert.deepEqual(await readLocalGitFileComparison(repo.root,
    { path: 'gone.txt', comparison: 'unstaged' }, settings), {
    version: 1, scope: 'file-comparison', path: 'gone.txt', comparison: 'unstaged', head: deleted.head,
    status: 'unavailable', reason: 'not-in-index',
  })
  await rm(join(repo.path, 'work-delete.txt'))
  const workDeleted = await readLocalGitFileComparison(repo.root,
    { path: 'work-delete.txt', comparison: 'unstaged' }, settings)
  assert.equal(workDeleted.status, 'ready')
  if (workDeleted.status === 'ready') {
    assert.equal(workDeleted.change, 'deleted')
    sideText(workDeleted.before, 'working deletion\n')
    assert.deepEqual(workDeleted.after, { kind: 'missing' })
  }
  assert.deepEqual(await readLocalGitFileComparison(repo.root,
    { path: 'untracked.txt', comparison: 'staged' }, settings), {
    version: 1, scope: 'file-comparison', path: 'untracked.txt', comparison: 'staged', head: deleted.head,
    status: 'unavailable', reason: 'not-tracked',
  })
})

test('selected comparisons distinguish executable-mode changes and file-type changes', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { 'script.sh': 'printf ok\n', 'type.txt': 'regular\n' })
  await chmod(join(repo.path, 'script.sh'), 0o755)
  git(repo.path, ['add', '--', 'script.sh'])
  const stagedMode = await readLocalGitFileComparison(repo.root, { path: 'script.sh', comparison: 'staged' }, options(repo.path))
  assert.equal(stagedMode.status, 'ready')
  if (stagedMode.status === 'ready') {
    assert.equal(stagedMode.change, 'mode-changed')
    sideText(stagedMode.before, 'printf ok\n', '100644')
    sideText(stagedMode.after, 'printf ok\n', '100755')
  }
  await chmod(join(repo.path, 'script.sh'), 0o644)
  const unstagedMode = await readLocalGitFileComparison(repo.root, { path: 'script.sh', comparison: 'unstaged' }, options(repo.path))
  assert.equal(unstagedMode.status, 'ready')
  if (unstagedMode.status === 'ready') {
    assert.equal(unstagedMode.change, 'mode-changed')
    sideText(unstagedMode.before, 'printf ok\n', '100755')
    sideText(unstagedMode.after, 'printf ok\n', '100644')
  }
  await rm(join(repo.path, 'type.txt'))
  await symlink('target.txt', join(repo.path, 'type.txt'))
  git(repo.path, ['add', '--', 'type.txt'])
  const typeChange = await readLocalGitFileComparison(repo.root, { path: 'type.txt', comparison: 'staged' }, options(repo.path))
  assert.equal(typeChange.status, 'ready')
  if (typeChange.status === 'ready') {
    assert.equal(typeChange.change, 'type-changed')
    sideText(typeChange.before, 'regular\n')
    assert.deepEqual(typeChange.after, { kind: 'omitted', reason: 'unsupported' })
  }
})

test('selected comparison works above the 500-path whole-review cap without reading unrelated bodies', {
  skip: !AVAILABLE,
}, async (t) => {
  const files: Record<string, string> = { 'selected.txt': 'selected\n' }
  for (let index = 0; index < 505; index += 1) files[`bulk/${String(index).padStart(4, '0')}.txt`] = `body ${index}\n`
  const repo = await repository(t, files)
  const reads: string[] = []
  const result = await readLocalGitFileComparison(repo.root, { path: 'selected.txt', comparison: 'staged' },
    options(repo.path, {}, reads))
  assert.equal(result.status, 'ready')
  if (result.status === 'ready') {
    assert.equal(result.change, 'unchanged')
    sideText(result.before, 'selected\n')
    sideText(result.after, 'selected\n')
  }
  assert.equal(reads.some(name => name.startsWith('bulk/')), false, 'unrelated working files were never read')
  assert.equal(reads.includes('selected.txt'), false, 'staged comparison never reads the selected working path')
})

test('ignored selected paths return only an unavailable reason; unsupported and unreadable sides remain honest', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { '.gitignore': 'ignored.txt\n', 'ignored.txt': 'secret\n', 'binary.txt': 'seed\n', 'asset.png': 'not an image\n' })
  git(repo.path, ['add', '--force', '--', 'ignored.txt'])
  git(repo.path, ['commit', '-m', 'force ignored fixture'])
  await writeFile(join(repo.path, 'binary.txt'), Buffer.from([0, 1, 2, 0]))
  git(repo.path, ['add', '--', 'binary.txt'])
  const settings = options(repo.path)
  const ignored = await readLocalGitFileComparison(repo.root, { path: 'ignored.txt', comparison: 'staged' }, settings)
  assert.equal(ignored.status, 'unavailable')
  if (ignored.status === 'unavailable') assert.equal(ignored.reason, 'ignored')
  await writeFile(join(repo.path, 'ignored.txt'), 'new ignored index\n')
  git(repo.path, ['add', '--force', '--', 'ignored.txt'])
  const ignoredUnstaged = await readLocalGitFileComparison(repo.root,
    { path: 'ignored.txt', comparison: 'unstaged' }, settings)
  assert.equal(ignoredUnstaged.status, 'unavailable')
  if (ignoredUnstaged.status === 'unavailable') assert.equal(ignoredUnstaged.reason, 'ignored')
  const binary = await readLocalGitFileComparison(repo.root, { path: 'binary.txt', comparison: 'staged' }, settings)
  assert.equal(binary.status, 'ready')
  if (binary.status === 'ready') {
    assert.equal(binary.change, 'modified')
    assert.deepEqual(binary.before, { kind: 'text', text: 'seed\n', mode: '100644' })
    assert.deepEqual(binary.after, { kind: 'omitted', reason: 'unreadable' })
  }
  const unsupported = await readLocalGitFileComparison(repo.root, { path: 'asset.png', comparison: 'staged' }, settings)
  assert.equal(unsupported.status, 'ready')
  if (unsupported.status === 'ready') {
    assert.deepEqual(unsupported.before, { kind: 'omitted', reason: 'unsupported' })
    assert.deepEqual(unsupported.after, { kind: 'omitted', reason: 'unsupported' })
  }
})

test('oversized, unsupported-mode, conflicted and sparse selections do not invent readable content', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { 'large.txt': 'small\n', 'link.txt': 'target\n', 'src/selected.txt': 'base\n' })
  await writeFile(join(repo.path, 'large.txt'), 'x'.repeat(MAX_GIT_SNAPSHOT_FILE_BYTES + 1))
  git(repo.path, ['add', '--', 'large.txt'])
  await rm(join(repo.path, 'link.txt'))
  await symlink('target.txt', join(repo.path, 'link.txt'))
  git(repo.path, ['add', '--', 'link.txt'])
  const settings = options(repo.path)
  const large = await readLocalGitFileComparison(repo.root, { path: 'large.txt', comparison: 'staged' }, settings)
  assert.equal(large.status, 'ready')
  if (large.status === 'ready') {
    assert.deepEqual(large.before, { kind: 'text', text: 'small\n', mode: '100644' })
    assert.deepEqual(large.after, { kind: 'omitted', reason: 'too-large' })
  }
  const link = await readLocalGitFileComparison(repo.root, { path: 'link.txt', comparison: 'staged' }, settings)
  assert.equal(link.status, 'ready')
  if (link.status === 'ready') assert.deepEqual(link.after, { kind: 'omitted', reason: 'unsupported' })

  git(repo.path, ['checkout', '-b', 'side'])
  await writeFile(join(repo.path, 'src/selected.txt'), 'side\n')
  git(repo.path, ['add', '--', 'src/selected.txt'])
  git(repo.path, ['commit', '-m', 'side'])
  git(repo.path, ['checkout', 'main'])
  await writeFile(join(repo.path, 'src/selected.txt'), 'main\n')
  git(repo.path, ['add', '--', 'src/selected.txt'])
  git(repo.path, ['commit', '-m', 'main'])
  git(repo.path, ['merge', 'side'], true)
  const conflicted = await readLocalGitFileComparison(repo.root,
    { path: 'src/selected.txt', comparison: 'staged' }, settings)
  assert.equal(conflicted.status, 'unavailable')
  if (conflicted.status === 'unavailable') assert.equal(conflicted.reason, 'unmerged')

  const sparseRepo = await repository(t, { 'inside/selected.txt': 'sparse body\n', 'outside.txt': 'outside\n' })
  git(sparseRepo.path, ['sparse-checkout', 'init', '--cone', '--sparse-index'])
  git(sparseRepo.path, ['sparse-checkout', 'set', 'outside'])
  const sparse = await readLocalGitFileComparison(sparseRepo.root,
    { path: 'inside/selected.txt', comparison: 'staged' }, options(sparseRepo.path))
  assert.equal(sparse.status, 'unavailable')
  if (sparse.status === 'unavailable') assert.equal(sparse.reason, 'sparse')
})

test('invalid selection starts no Git work; cancellation and selected source changes cannot publish', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t)
  const reads: string[] = []
  for (const selection of [null, { path: '../escape', comparison: 'staged' },
    { path: 'src/selected.txt', comparison: 'raw' }, { path: 'src/selected.txt', comparison: 'staged', extra: true }]) {
    await assert.rejects(readLocalGitFileComparison(repo.root, selection as any, options(repo.path, {}, reads)))
  }
  assert.deepEqual(reads, [], 'invalid selection is refused before source reads')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readLocalGitFileComparison(repo.root, { path: 'src/selected.txt', comparison: 'staged' },
    options(repo.path, { signal: controller.signal })))

  let changed = false
  const mutation = options(repo.path, {
    readFile: async (base: any, name: string, settings: any) => {
      const value = await readGitFile(base, name, { ...settings, executable: FILE_EXECUTABLE })
      if (!changed && name === 'src/selected.txt' && value.status === 'file') {
        changed = true
        await writeFile(join(repo.path, 'src/selected.txt'), 'mutated during comparison\n')
      }
      return value
    },
  }, [])
  await assert.rejects(readLocalGitFileComparison(repo.root,
    { path: 'src/selected.txt', comparison: 'unstaged' }, mutation), /Git baseline/i)
  assert.equal(changed, true, 'the source mutation happened after the selected working read')
})
