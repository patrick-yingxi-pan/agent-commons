import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BUNDLED_GIT, bundledGitProbeEnvironment, verifyBundledGitDirectory } from './bundledGit.mjs'

/** Packaging evidence only. Mutations create a generated disposable repository;
 * the product exposes neither these commands nor the fixture to a user. */
export async function smokePackagedBundledGit({ executable }) {
  if (process.platform !== 'darwin') return
  const bundle = join(dirname(dirname(executable)), 'Resources', 'agent-commons-git')
  const git = await verifyBundledGitDirectory(bundle)
  const fixture = await mkdtemp(join(tmpdir(), 'agent-commons-bundled-git-'))
  function run(args) {
    const result = spawnSync(git, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: fixture, env: bundledGitProbeEnvironment(), encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 64 * 1024,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.signal, null)
    return result.stdout
  }
  try {
    run(['init', '--template=', '--initial-branch=main', '.'])
    await writeFile(join(fixture, 'tracked.txt'), 'tracked original\n')
    await writeFile(join(fixture, '.gitignore'), '*.secret\n')
    run(['add', '--', 'tracked.txt', '.gitignore'])
    await writeFile(join(fixture, 'tracked.txt'), 'uncommitted working text\n')
    await writeFile(join(fixture, 'untracked.txt'), 'not tracked\n')
    await writeFile(join(fixture, 'private.secret'), 'ignored fixture\n')
    const indexPath = join(fixture, '.git', 'index')
    const beforeIndex = await readFile(indexPath)
    const beforeEntries = await readdir(join(fixture, '.git'))
    assert.equal(run(['ls-files', '--cached', '-z', '--']), '.gitignore\0tracked.txt\0')
    assert.deepEqual(await readFile(indexPath), beforeIndex, 'the probe must not change the Git index')
    assert.deepEqual(await readdir(join(fixture, '.git')), beforeEntries, 'the probe must not create repository metadata')
    assert.equal(await readFile(join(fixture, 'tracked.txt'), 'utf8'), 'uncommitted working text\n')
    assert.deepEqual((await readdir(bundle)).sort(), [
      BUNDLED_GIT.sourceArchive, 'COPYING', 'LGPL-2.1', 'build-recipe.json', 'git',
    ].sort())
    console.log(`[desktop-smoke] bundled Git ${BUNDLED_GIT.version} · native architecture · system libraries only · exact source/licenses · isolated tracked-file enumeration without repository mutation`)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}
