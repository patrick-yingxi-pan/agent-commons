import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  MAX_GIT_SNAPSHOT_FILE_BYTES,
  MAX_GIT_SNAPSHOT_READABLE_FILES,
  MAX_GIT_SNAPSHOT_TOTAL_BYTES,
} from '../contract/localGitSnapshot.mjs'
import { bundledGitDirectory } from './bundledGit.mjs'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { readGitFile } from './gitFileRead.mjs'
import { createLocalGitReader, localGitCommandEnvironment, runLocalGit } from './localGitReader.mjs'
import { readLocalGitReview } from './localGitReview.mjs'

const GIT_EXECUTABLE = process.platform === 'darwin'
  ? join(bundledGitDirectory({ packaged: false }), 'git')
  : undefined
const FILE_EXECUTABLE = buildGitFileTestHelper()
const AVAILABLE = !!GIT_EXECUTABLE && !!FILE_EXECUTABLE && existsSync(GIT_EXECUTABLE) && existsSync(FILE_EXECUTABLE)

function git(root: string, args: string[], input?: Uint8Array, allowFailure = false): Buffer {
  const result = spawnSync(GIT_EXECUTABLE!, [
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null',
    '-c', 'user.name=Git review fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args,
  ], {
    cwd: root,
    env: localGitCommandEnvironment(),
    input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer: 16 * 1024 * 1024,
  })
  if (!allowFailure) assert.equal(result.status, 0, result.stderr.toString('utf8'))
  return result.stdout
}

async function repository(t: any, options: { files?: Record<string, string | Uint8Array>; ignores?: Record<string, string> } = {}) {
  assert.ok(AVAILABLE, 'the pinned bundled Git and native descriptor helper are available')
  const parent = await mkdtemp(join(tmpdir(), 'agent-commons-git-review-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'repository')
  await mkdir(root)
  git(root, ['init', '--template=', '--initial-branch=main', '.'])
  for (const [name, body] of Object.entries(options.files ?? { 'note.txt': 'HEAD\n' })) {
    await mkdir(join(root, name, '..'), { recursive: true })
    await writeFile(join(root, name), body)
  }
  for (const [name, body] of Object.entries(options.ignores ?? {})) {
    await mkdir(join(root, name, '..'), { recursive: true })
    await writeFile(join(root, name), body)
  }
  git(root, ['add', '--all', '--'])
  git(root, ['commit', '-m', 'review baseline'])
  const reader = createLocalGitReader({ gitExecutable: GIT_EXECUTABLE, fileExecutable: FILE_EXECUTABLE })
  const pinned = await reader.inspectLocalGitRoot(root)
  return { parent, root, pinned, reader, firstCommit: git(root, ['rev-parse', 'HEAD']).toString('ascii').trim() }
}

function reviewOptions(root: string, { reads = [], gitCwds = [], afterRead }: {
  reads?: Array<{ path: string; maxBytes: number | null; status: string; sizeBytes?: number }>
  gitCwds?: string[]
  afterRead?: (name: string, value: any, options: any) => Promise<void> | void
} = {}) {
  const absoluteRoot = resolve(root)
  return {
    gitExecutable: GIT_EXECUTABLE,
    fileExecutable: FILE_EXECUTABLE,
    readFile: async (base: any, name: string, readOptions: any) => {
      const value = await readGitFile(base, name, { ...readOptions, executable: FILE_EXECUTABLE })
      if (base.path === absoluteRoot || base.path.startsWith(`${absoluteRoot}/`)) {
        reads.push({ path: name, maxBytes: readOptions.maxBytes, status: value.status, sizeBytes: value.sizeBytes })
        await afterRead?.(name, value, readOptions)
      }
      return value
    },
    runGit: async (args: string[], commandOptions: { cwd: string; signal?: AbortSignal; input?: Uint8Array }) => {
      assert.equal(commandOptions.cwd === absoluteRoot || commandOptions.cwd.startsWith(`${absoluteRoot}/`), false,
        'Git reads only isolated private metadata')
      assert.equal(args.some((argument) => argument.includes(absoluteRoot)), false, 'source paths never reach Git')
      gitCwds.push(commandOptions.cwd)
      return runLocalGit(GIT_EXECUTABLE, args, commandOptions)
    },
  }
}

function byPath(review: any, path: string) {
  const entry = review.files.find((file: any) => file.path === path)
  assert.ok(entry, `review contains ${path}`)
  return entry
}

function kindText(side: any, text: string, mode?: string) {
  assert.equal(side.kind, 'text')
  assert.equal(side.text, text)
  if (mode) assert.equal(side.mode, mode)
}

function objectPath(oid: string) {
  return `objects/${oid.slice(0, 2)}/${oid.slice(2)}`
}

test('review separates exact HEAD, staged index and working bytes without reading untracked recreations', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, {
    files: {
      'tracked.txt': 'HEAD version\n',
      'recreated.txt': 'original HEAD version\n',
      'work-delete.txt': 'delete only from working tree\n',
      'mode.sh': 'printf ok\n',
      'same.txt': 'unchanged\n',
      'root.secret': 'HEAD secret fixture\n',
      'formerly-visible.txt': 'HEAD body newly excluded after deletion\n',
      'nested/.gitignore': 'blocked.txt\n',
      'nested/blocked.txt': 'HEAD nested secret\n',
    },
    ignores: { '.gitignore': '*.secret\n' },
  })
  const { root, pinned } = repo
  await writeFile(join(root, 'tracked.txt'), 'staged version\n')
  git(root, ['add', '--', 'tracked.txt'])
  await writeFile(join(root, 'staged-add.txt'), 'staged addition\n')
  git(root, ['add', '--', 'staged-add.txt'])
  git(root, ['rm', '--cached', '--', 'recreated.txt'])
  await writeFile(join(root, 'recreated.txt'), 'untracked recreation must not be read\n')
  git(root, ['rm', '--cached', '--', 'formerly-visible.txt'])
  await rm(join(root, 'formerly-visible.txt'))
  await writeFile(join(root, '.gitignore'), '*.secret\nformerly-visible.txt\n')
  await rm(join(root, 'work-delete.txt'))
  await chmod(join(root, 'mode.sh'), 0o755)
  git(root, ['add', '--', 'mode.sh'])
  await writeFile(join(root, 'tracked.txt'), 'working version\n')
  await writeFile(join(root, 'root.secret'), 'force-added ignored content\n')
  git(root, ['add', '-f', '--', 'root.secret'])
  await writeFile(join(root, 'nested/blocked.txt'), 'nested ignored content\n')
  git(root, ['add', '-f', '--', 'nested/blocked.txt'])
  await writeFile(join(root, 'untracked.txt'), 'never read or listed\n')

  const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
  const gitCwds: string[] = []
  const sourceIndexPath = join(pinned.repository.path, 'index')
  const sourceIndexBytes = await readFile(sourceIndexPath)
  const sourceIndexStat = await stat(sourceIndexPath, { bigint: true })
  const result = await readLocalGitReview(pinned, reviewOptions(pinned.path, { reads, gitCwds }))
  assert.deepEqual(await readFile(sourceIndexPath), sourceIndexBytes, 'review does not rewrite the source index')
  const sourceIndexStatAfter = await stat(sourceIndexPath, { bigint: true })
  assert.equal(sourceIndexStatAfter.mtimeNs, sourceIndexStat.mtimeNs, 'review preserves source index modification time')
  assert.deepEqual(Object.keys(result).sort(), ['comparison', 'excludedCount', 'files', 'head', 'unchangedCount', 'version'])
  assert.equal(result.version, 1)
  assert.equal(result.comparison, 'raw')
  assert.equal(result.excludedCount, 3)
  assert.ok(result.unchangedCount >= 2)
  assert.deepEqual(result.files.map((file: any) => file.path), [...result.files.map((file: any) => file.path)].sort())

  const tracked = byPath(result, 'tracked.txt')
  assert.equal(tracked.staged, 'modified')
  assert.equal(tracked.unstaged, 'modified')
  kindText(tracked.head, 'HEAD version\n', '100644')
  kindText(tracked.index, 'staged version\n', '100644')
  kindText(tracked.working, 'working version\n', '100644')
  const addition = byPath(result, 'staged-add.txt')
  assert.equal(addition.staged, 'added')
  assert.equal(addition.unstaged, 'unchanged')
  assert.deepEqual(addition.head, { kind: 'missing' })
  kindText(addition.index, 'staged addition\n')
  assert.deepEqual(addition.working, { kind: 'omitted', reason: 'not-needed' })
  const recreated = byPath(result, 'recreated.txt')
  assert.equal(recreated.staged, 'deleted')
  assert.deepEqual(recreated.working, { kind: 'missing' }, 'recreated HEAD-only path is treated as untracked')
  const deleted = byPath(result, 'work-delete.txt')
  assert.equal(deleted.staged, 'unchanged')
  assert.equal(deleted.unstaged, 'deleted')
  assert.deepEqual(deleted.working, { kind: 'missing' })
  const mode = byPath(result, 'mode.sh')
  assert.equal(mode.staged, 'mode-changed')
  assert.equal(mode.unstaged, 'unchanged')
  kindText(mode.head, 'printf ok\n', '100644')
  kindText(mode.index, 'printf ok\n', '100755')
  assert.deepEqual(mode.working, { kind: 'omitted', reason: 'not-needed' })
  assert.equal(result.files.some((file: any) => ['root.secret', 'nested/blocked.txt', 'formerly-visible.txt', 'untracked.txt'].includes(file.path)), false)
  assert.equal(reads.some((read) => ['root.secret', 'nested/blocked.txt', 'formerly-visible.txt', 'untracked.txt', 'recreated.txt'].includes(read.path)), false,
    'ignored, untracked and recreated paths do not receive working-file reads')
  const ignoredOids = [
    git(root, ['rev-parse', ':root.secret']).toString('ascii').trim(),
    git(root, ['rev-parse', ':nested/blocked.txt']).toString('ascii').trim(),
    git(root, ['rev-parse', 'HEAD:formerly-visible.txt']).toString('ascii').trim(),
  ]
  assert.equal(reads.some((read) => ignoredOids.some((oid) => read.path === objectPath(oid))), false,
    'ignored force-added object bodies are not read')
  await assert.rejects(access(gitCwds[0]!))
})

test('invalid UTF-8, over-limit text and symlinks are honest omissions', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, {
    files: {
      'bad-utf8.txt': 'valid baseline\n',
      'large.txt': 'small baseline\n',
      'link.txt': 'target-one',
    },
  })
  const { root, pinned } = repo
  await writeFile(join(root, 'bad-utf8.txt'), Buffer.from([0xff, 0xfe, 0x00]))
  git(root, ['add', '--', 'bad-utf8.txt'])
  await writeFile(join(root, 'bad-utf8.txt'), Buffer.from([0xff, 0xfd, 0x00]))
  const largeStaged = Buffer.alloc(MAX_GIT_SNAPSHOT_FILE_BYTES + 1024, 0x61)
  await writeFile(join(root, 'large.txt'), largeStaged)
  git(root, ['add', '--', 'large.txt'])
  await writeFile(join(root, 'large.txt'), Buffer.concat([largeStaged, Buffer.from('working')]))
  await rm(join(root, 'link.txt'))
  await symlink('target-two', join(root, 'link.txt'))

  const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
  const review = await readLocalGitReview(pinned, reviewOptions(pinned.path, { reads }))
  const binary = byPath(review, 'bad-utf8.txt')
  assert.deepEqual(binary.index, { kind: 'omitted', reason: 'unreadable' })
  assert.deepEqual(binary.working, { kind: 'omitted', reason: 'unreadable' })
  const large = byPath(review, 'large.txt')
  assert.deepEqual(large.index, { kind: 'omitted', reason: 'too-large' })
  assert.deepEqual(large.working, { kind: 'omitted', reason: 'too-large' })
  const link = byPath(review, 'link.txt')
  assert.equal(link.unstaged, 'unavailable')
  assert.deepEqual(link.working, { kind: 'omitted', reason: 'unsupported' })
})

test('conflicts are explicitly unmerged and do not read conflicted contents', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { files: { 'conflict.txt': 'base conflict\n' } })
  git(repo.root, ['checkout', '-b', 'conflict-branch'])
  await writeFile(join(repo.root, 'conflict.txt'), 'branch side\n')
  git(repo.root, ['add', '--', 'conflict.txt'])
  git(repo.root, ['commit', '-m', 'branch conflict side'])
  git(repo.root, ['checkout', 'main'])
  await writeFile(join(repo.root, 'conflict.txt'), 'main side\n')
  git(repo.root, ['add', '--', 'conflict.txt'])
  git(repo.root, ['commit', '-m', 'main conflict side'])
  git(repo.root, ['merge', 'conflict-branch'], undefined, true)
  const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
  const review = await readLocalGitReview(repo.pinned, reviewOptions(repo.pinned.path, { reads }))
  const conflict = byPath(review, 'conflict.txt')
  assert.equal(conflict.staged, 'unmerged')
  assert.deepEqual(conflict.head, { kind: 'omitted', reason: 'unmerged' })
  assert.deepEqual(conflict.index, { kind: 'omitted', reason: 'unmerged' })
  assert.deepEqual(conflict.working, { kind: 'omitted', reason: 'unmerged' })
  assert.equal(reads.some((read) => read.path === 'conflict.txt'), false)
})

test('sparse-index entries are explicit unavailable omissions and their working paths are not read', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { files: { 'src/visible.txt': 'visible\n', 'outside/hidden.txt': 'hidden\n' } })
  git(repo.root, ['sparse-checkout', 'init', '--cone', '--sparse-index'])
  git(repo.root, ['sparse-checkout', 'set', 'src'])
  const reader = createLocalGitReader({ gitExecutable: GIT_EXECUTABLE, fileExecutable: FILE_EXECUTABLE })
  const pinned = await reader.inspectLocalGitRoot(repo.root)
  const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
  const review = await readLocalGitReview(pinned, reviewOptions(pinned.path, { reads }))
  const sparse = byPath(review, 'outside/hidden.txt')
  assert.equal(sparse.staged, 'unavailable')
  assert.deepEqual(sparse.working, { kind: 'omitted', reason: 'sparse' })
  assert.equal(reads.some((read) => read.path === 'outside/hidden.txt'), false)
})

test('full-index skip-worktree paths removed from disk remain sparse, not deleted', {
  skip: !AVAILABLE,
}, async (t) => {
  const repo = await repository(t, { files: { 'visible.txt': 'visible\n', 'skipped.txt': 'not materialized\n' } })
  git(repo.root, ['update-index', '--skip-worktree', '--', 'skipped.txt'])
  await rm(join(repo.root, 'skipped.txt'))
  const listed = git(repo.root, ['ls-files', '-t', '--', 'skipped.txt']).toString('utf8').trim()
  assert.match(listed, /^S skipped\.txt$/, 'fixture is an ordinary index entry tagged skip-worktree')
  const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
  const review = await readLocalGitReview(repo.pinned, reviewOptions(repo.pinned.path, { reads }))
  const skipped = byPath(review, 'skipped.txt')
  assert.equal(skipped.staged, 'unavailable')
  assert.deepEqual(skipped.head, { kind: 'omitted', reason: 'sparse' })
  assert.deepEqual(skipped.index, { kind: 'omitted', reason: 'sparse' })
  assert.deepEqual(skipped.working, { kind: 'omitted', reason: 'sparse' })
  assert.equal(skipped.unstaged, 'unavailable')
  assert.equal(reads.some((read) => read.path === 'skipped.txt'), false)
})

test('staged changes receive scarce working reads before unstaged-only candidates', {
  skip: !AVAILABLE,
}, async (t) => {
  const files: Record<string, string> = { 'z-staged.txt': 'HEAD z\n' }
  for (let index = 0; index < MAX_GIT_SNAPSHOT_READABLE_FILES; index += 1) {
    files[`a-${String(index).padStart(2, '0')}.txt`] = `HEAD ${index}\n`
  }
  const repo = await repository(t, { files })
  for (let index = 0; index < MAX_GIT_SNAPSHOT_READABLE_FILES; index += 1) {
    await writeFile(join(repo.root, `a-${String(index).padStart(2, '0')}.txt`), `working ${index}\n`)
  }
  await writeFile(join(repo.root, 'z-staged.txt'), 'staged z\n')
  git(repo.root, ['add', '--', 'z-staged.txt'])
  await writeFile(join(repo.root, 'z-staged.txt'), 'working z\n')
  const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
  const result = await readLocalGitReview(repo.pinned, reviewOptions(repo.pinned.path, { reads }))
  const staged = byPath(result, 'z-staged.txt')
  assert.equal(staged.staged, 'modified')
  kindText(staged.working, 'working z\n')
  const lastUnstaged = byPath(result, `a-${String(MAX_GIT_SNAPSHOT_READABLE_FILES - 1).padStart(2, '0')}.txt`)
  assert.equal(lastUnstaged.staged, 'unchanged')
  assert.equal(lastUnstaged.unstaged, 'unavailable')
  assert.deepEqual(lastUnstaged.working, { kind: 'omitted', reason: 'budget' })
  const contentReads = reads.filter((read) => read.maxBytes === MAX_GIT_SNAPSHOT_FILE_BYTES && read.path.endsWith('.txt'))
  assert.equal(contentReads.length, MAX_GIT_SNAPSHOT_READABLE_FILES)
  assert.equal(contentReads[0]?.path, 'z-staged.txt', 'staged content wins the first bounded read')
})

test('working input bytes stop at the shared 128 KiB cap', {
  skip: !AVAILABLE,
}, async (t) => {
  const files: Record<string, string> = {}
  const count = 20
  const workingBody = 'x'.repeat(8 * 1024)
  for (let index = 0; index < count; index += 1) files[`input-${String(index).padStart(2, '0')}.txt`] = 'HEAD\n'
  const repo = await repository(t, { files })
  for (let index = 0; index < count; index += 1) {
    await writeFile(join(repo.root, `input-${String(index).padStart(2, '0')}.txt`), workingBody)
  }
  const reads: Array<{ path: string; maxBytes: number | null; status: string; sizeBytes?: number }> = []
  const result = await readLocalGitReview(repo.pinned, reviewOptions(repo.pinned.path, { reads }))
  const contentReads = reads.filter((read) => read.maxBytes === MAX_GIT_SNAPSHOT_FILE_BYTES && read.path.startsWith('input-'))
  assert.equal(contentReads.length, 16)
  assert.ok(contentReads.reduce((sum, read) => sum + (read.sizeBytes ?? 0), 0) <= MAX_GIT_SNAPSHOT_TOTAL_BYTES)
  const last = byPath(result, 'input-19.txt')
  assert.equal(last.unstaged, 'unavailable')
  assert.deepEqual(last.working, { kind: 'omitted', reason: 'budget' })
})

test('display text across all sides stays within the shared byte budget', {
  skip: !AVAILABLE,
}, async (t) => {
  const headBody = 'A'.repeat(50 * 1024)
  const stagedBody = 'B'.repeat(50 * 1024)
  const workingBody = 'C'.repeat(50 * 1024)
  const repo = await repository(t, { files: { 'first.txt': headBody, 'second.txt': headBody } })
  for (const name of ['first.txt', 'second.txt']) {
    await writeFile(join(repo.root, name), stagedBody)
    git(repo.root, ['add', '--', name])
    await writeFile(join(repo.root, name), workingBody)
  }
  const result = await readLocalGitReview(repo.pinned, reviewOptions(repo.pinned.path))
  let total = 0
  let budgetOmissions = 0
  for (const file of result.files) for (const side of [file.head, file.index, file.working]) {
    if (side.kind === 'text') total += Buffer.byteLength(side.text)
    if (side.kind === 'omitted' && side.reason === 'budget') budgetOmissions += 1
  }
  assert.ok(total <= MAX_GIT_SNAPSHOT_TOTAL_BYTES)
  assert.ok(budgetOmissions > 0, 'text omitted once the combined display budget is exhausted')
})

test('ignore, index, ref and working-tree changes invalidate the whole review', {
  skip: !AVAILABLE,
}, async (t) => {
  for (const target of ['.gitignore', '.git/index', 'refs/heads/main', 'working']) {
    const repo = await repository(t, { files: { 'tracked.txt': 'HEAD\n' }, ignores: { '.gitignore': '*.secret\n' } })
    if (target === 'refs/heads/main') {
      await writeFile(join(repo.root, 'ref-step.txt'), 'second commit\n')
      git(repo.root, ['add', '--', 'ref-step.txt'])
      git(repo.root, ['commit', '-m', 'second ref version'])
    }
    await writeFile(join(repo.root, 'tracked.txt'), 'staged\n')
    git(repo.root, ['add', '--', 'tracked.txt'])
    await writeFile(join(repo.root, 'tracked.txt'), 'working\n')
    let fired = false
    const mutateAfterContent = async (name: string, value: any, readOptions: any) => {
      if (fired || name !== 'tracked.txt' || readOptions.maxBytes === null || value.status !== 'file' || !value.bytes) return
      fired = true
      if (target === '.gitignore') await writeFile(join(repo.root, '.gitignore'), '*.private\n')
      if (target === '.git/index') await writeFile(join(repo.pinned.repository.path, 'index'), 'changed index')
      if (target === 'refs/heads/main') {
        await writeFile(join(repo.pinned.repository.path, 'refs/heads/main'), `${repo.firstCommit}\n`)
      }
      if (target === 'working') await writeFile(join(repo.root, 'tracked.txt'), 'changed while reviewing\n')
    }
    const reads: Array<{ path: string; maxBytes: number | null; status: string }> = []
    await assert.rejects(readLocalGitReview(repo.pinned, reviewOptions(repo.pinned.path, { reads, afterRead: mutateAfterContent })), /Git baseline|repository/i, target)
    assert.equal(fired, true, `${target} mutation occurred after the source was initially observed`)
  }
})
