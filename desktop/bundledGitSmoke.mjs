import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_GIT, bundledGitProbeEnvironment, verifyBundledGitDirectory } from './bundledGit.mjs'
import { withLocalGitBaseline } from './gitBaselineReader.mjs'
import { gitFileExecutable } from './gitFilePaths.mjs'
import { createLocalGitReader, runLocalGit } from './localGitReader.mjs'
import { readLocalGitReview } from './localGitReview.mjs'

const require = createRequire(import.meta.url)
const { extractFile } = require('@electron/asar')
const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASELINE_MODULES = [
  'desktop/gitBaselineReader.mjs',
  'desktop/gitIndex.mjs',
  'desktop/gitHead.mjs',
  'desktop/gitObjectReader.mjs',
  'desktop/gitPackIndex.mjs',
  'desktop/gitFileRead.mjs',
  'desktop/gitFilePaths.mjs',
  'desktop/localGitReview.mjs',
  'desktop/gitIgnore.mjs',
  'desktop/gitReviewPlan.mjs',
  'desktop/gitWorkingMode.mjs',
  'desktop/localGitReader.mjs',
  'desktop/gitUntracked.mjs',
  'desktop/localFolderReader.mjs',
  'desktop/bundledGit.mjs',
  'contract/localGitSnapshot.mjs',
  'contract/localGitBrowse.mjs',
  'contract/localFolderBrowse.mjs',
  'contract/localFileBrowse.mjs',
  'contract/imageFile.mjs',
  'contract/pdfImport.mjs',
  'contract/docxImport.mjs',
  'contract/xlsxImport.mjs',
  'contract/pptxImport.mjs',
  'contract/localFolderSnapshot.mjs',
  'contract/localFolderTree.mjs',
  'contract/localFolderSnapshotBuilder.mjs',
  'contract/localTextFile.mjs',
]

async function assertBaselineSourcesMatchPackagedAsar(executable) {
  const resources = join(dirname(dirname(executable)), 'Resources')
  const archive = join(resources, 'app.asar')
  for (const name of BASELINE_MODULES) {
    const source = await readFile(join(SOURCE_ROOT, name))
    const packaged = extractFile(archive, name)
    assert.ok(packaged, `packaged ASAR contains ${name}`)
    assert.deepEqual(packaged, source, `packaged baseline dependency matches source: ${name}`)
  }
}

async function metadataSnapshot(root) {
  const snapshot = []
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const details = await lstat(path, { bigint: true })
      snapshot.push([
        relative(root, path),
        details.isDirectory() ? 'directory' : details.isSymbolicLink() ? 'symlink' : details.isFile() ? 'file' : 'other',
        String(details.dev), String(details.ino), String(details.mode), String(details.size),
        String(details.mtimeNs), String(details.ctimeNs),
      ])
      if (details.isDirectory() && !details.isSymbolicLink()) await visit(path)
    }
  }
  await visit(root)
  return snapshot
}

/** Packaging evidence only. Mutations create a generated disposable repository;
 * the product exposes neither these commands nor the fixture to a user. */
export async function smokePackagedBundledGit({ executable }) {
  if (process.platform !== 'darwin') return
  const bundle = join(dirname(dirname(executable)), 'Resources', 'agent-commons-git')
  const git = await verifyBundledGitDirectory(bundle)
  const fixture = await mkdtemp(join(tmpdir(), 'agent-commons-bundled-git-'))
  function run(args) {
    const result = spawnSync(git, [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'user.name=Packaged Git smoke', '-c', 'user.email=smoke@example.invalid',
      '-c', 'commit.gpgSign=false', ...args,
    ], {
      cwd: fixture, env: bundledGitProbeEnvironment(), encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 64 * 1024,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.signal, null)
    return result.stdout
  }
  try {
    await assertBaselineSourcesMatchPackagedAsar(executable)
    run(['init', '--template=', '--initial-branch=main', '.'])
    await writeFile(join(fixture, 'tracked.txt'), 'HEAD baseline bytes\n')
    await writeFile(join(fixture, '.gitignore'), '*.secret\n')
    await writeFile(join(fixture, 'removed.txt'), 'HEAD-only deleted path\n')
    run(['add', '--', 'tracked.txt', '.gitignore', 'removed.txt'])
    run(['commit', '-m', 'packaged baseline fixture'])
    run(['update-index', '--split-index'])
    run(['gc', '--aggressive', '--prune=now'])
    run(['pack-refs', '--all', '--prune'])
    assert.ok((await readFile(join(fixture, '.git', 'packed-refs'), 'utf8')).includes('refs/heads/main'),
      'the fixture exercises packed refs')
    const packedFiles = await readdir(join(fixture, '.git', 'objects', 'pack'))
    assert.ok(packedFiles.some((name) => name.endsWith('.pack')) && packedFiles.some((name) => name.endsWith('.idx')),
      'the fixture exercises packed objects')
    await writeFile(join(fixture, 'tracked.txt'), 'staged index bytes\n')
    run(['add', '--', 'tracked.txt'])
    await writeFile(join(fixture, 'staged-only.txt'), 'staged addition bytes\n')
    run(['add', '--', 'staged-only.txt'])
    run(['rm', '--', 'removed.txt'])
    await writeFile(join(fixture, 'tracked.txt'), 'uncommitted working text\n')
    await writeFile(join(fixture, 'untracked.txt'), 'not tracked\n')
    await writeFile(join(fixture, 'private.secret'), 'ignored fixture\n')
    assert.equal(run(['ls-files', '--cached', '-z', '--']), '.gitignore\0staged-only.txt\0tracked.txt\0')
    const indexPath = join(fixture, '.git', 'index')
    const beforeIndex = await readFile(indexPath)
    const beforeMetadata = await metadataSnapshot(join(fixture, '.git'))

    const fileHelper = gitFileExecutable({ packaged: true, resourcesPath: join(dirname(dirname(executable)), 'Resources') })
    const localReader = createLocalGitReader({ gitExecutable: git, fileExecutable: fileHelper })
    const pinned = await localReader.inspectLocalGitRoot(fixture)
    const privateGitCwds = []
    const baseline = await withLocalGitBaseline(pinned, {
      gitExecutable: git,
      fileExecutable: fileHelper,
      runGit: async (args, options) => {
        assert.equal(options.cwd.startsWith(fixture), false, 'baseline Git commands run in private staging')
        assert.equal(args.some((argument) => argument.includes(fixture)), false, 'source paths never reach Git')
        privateGitCwds.push(options.cwd)
        return runLocalGit(git, args, options)
      },
    }, async ({ head, headEntries, indexEntries, readBlob }) => {
      const headEntry = headEntries.find((entry) => entry.name === 'tracked.txt')
      const indexEntry = indexEntries.find((entry) => entry.name === 'tracked.txt' && entry.stage === 0)
      assert.ok(headEntry && indexEntry)
      assert.notEqual(headEntry.oid, indexEntry.oid)
      const headBytes = Buffer.from(await readBlob(headEntry.oid))
      const indexBytes = Buffer.from(await readBlob(indexEntry.oid))
      assert.equal(headBytes.toString('utf8'), 'HEAD baseline bytes\n')
      assert.equal(indexBytes.toString('utf8'), 'staged index bytes\n')
      assert.notEqual(indexBytes.toString('utf8'), 'uncommitted working text\n')
      assert.equal(head.ref, 'refs/heads/main')
      assert.equal(headEntries.some((entry) => entry.name === 'removed.txt'), true)
      assert.equal(indexEntries.some((entry) => entry.name === 'removed.txt'), false)
      assert.equal(headEntries.some((entry) => entry.name === 'staged-only.txt'), false)
      assert.equal(indexEntries.some((entry) => entry.name === 'staged-only.txt' && entry.stage === 0), true)
      return 'head/index verified'
    })
    assert.equal(baseline, 'head/index verified')
    for (const cwd of new Set(privateGitCwds)) await assert.rejects(access(cwd))
    assert.deepEqual(await readFile(indexPath), beforeIndex, 'the probe does not change split index bytes')
    assert.equal(await readFile(join(fixture, 'tracked.txt'), 'utf8'), 'uncommitted working text\n')

    const review = await readLocalGitReview(pinned, { gitExecutable: git, fileExecutable: fileHelper })
    const trackedReview = review.files.find((entry) => entry.path === 'tracked.txt')
    assert.ok(trackedReview, 'the review includes the changed tracked path')
    assert.equal(trackedReview.staged, 'modified')
    assert.equal(trackedReview.unstaged, 'modified')
    assert.deepEqual(trackedReview.head, { kind: 'text', text: 'HEAD baseline bytes\n', mode: '100644' })
    assert.deepEqual(trackedReview.index, { kind: 'text', text: 'staged index bytes\n', mode: '100644' })
    assert.deepEqual(trackedReview.working, { kind: 'text', text: 'uncommitted working text\n', mode: '100644' })
    const removedReview = review.files.find((entry) => entry.path === 'removed.txt')
    assert.ok(removedReview, 'the review includes the staged deletion')
    assert.equal(removedReview.staged, 'deleted')
    assert.equal(removedReview.unstaged, 'unchanged')
    assert.deepEqual(removedReview.head, { kind: 'text', text: 'HEAD-only deleted path\n', mode: '100644' })
    assert.deepEqual(removedReview.index, { kind: 'missing' })
    assert.deepEqual(removedReview.working, { kind: 'missing' })
    assert.equal(review.files.some((entry) => ['untracked.txt', 'private.secret'].includes(entry.path)), false,
      'untracked and ignored private files are not review rows')
    const untracked = await localReader.listLocalGitUntrackedFiles(pinned)
    assert.deepEqual(untracked, { version: 1, files: [{ path: 'untracked.txt', kind: 'file' }], excludedCount: 1 },
      'the packaged directory helper admits untracked metadata separately from tracked review')
    const selected = await localReader.readLocalGitUntrackedFile(pinned, { selection: { path: 'untracked.txt' } })
    assert.deepEqual(selected, { version: 1, path: 'untracked.txt', sizeBytes: 12, snapshot: { text: 'not tracked\n' } })
    await assert.rejects(localReader.readLocalGitFile(pinned, { selection: { path: 'untracked.txt' } }),
      'untracked admission does not widen the existing tracked reader')
    const bulk = await localReader.readLocalGitSnapshot(pinned)
    assert.equal(bulk.files.some(file => ['untracked.txt', 'private.secret'].includes(file.path)), false,
      'whole-repository capture still excludes untracked and ignored files')
    assert.deepEqual(await metadataSnapshot(join(fixture, '.git')), beforeMetadata,
      'baseline and review do not change source refs, packs, index, or other repository metadata')
    assert.deepEqual((await readdir(bundle)).sort(), [
      BUNDLED_GIT.sourceArchive, 'COPYING', 'LGPL-2.1', 'build-recipe.json', 'git',
    ].sort())
    console.log(`[desktop-smoke] bundled Git ${BUNDLED_GIT.version} · native architecture · system libraries only · exact source/licenses · packaged internal HEAD/index/review/untracked reads verified without source mutation or new product IPC/UI`)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}
