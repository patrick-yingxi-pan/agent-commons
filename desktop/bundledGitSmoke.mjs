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
  'desktop/localGitReader.mjs',
  'desktop/localFolderReader.mjs',
  'desktop/bundledGit.mjs',
  'contract/localGitSnapshot.mjs',
  'contract/localFolderSnapshot.mjs',
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
    assert.deepEqual(await metadataSnapshot(join(fixture, '.git')), beforeMetadata,
      'the probe does not change source refs, packs, index, or other repository metadata')
    assert.equal(await readFile(join(fixture, 'tracked.txt'), 'utf8'), 'uncommitted working text\n')
    assert.deepEqual((await readdir(bundle)).sort(), [
      BUNDLED_GIT.sourceArchive, 'COPYING', 'LGPL-2.1', 'build-recipe.json', 'git',
    ].sort())
    console.log(`[desktop-smoke] bundled Git ${BUNDLED_GIT.version} · native architecture · system libraries only · exact source/licenses · packaged internal HEAD/index baseline verified without source mutation or product IPC/UI`)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}
