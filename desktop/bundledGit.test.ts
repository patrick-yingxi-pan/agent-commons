import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertBundledGitProbes,
  BUNDLED_GIT,
  bundledGitDirectory,
  bundledGitProbeEnvironment,
} from './bundledGit.mjs'
import { assertGitSourceArchive, bundledGitBuildPlan } from './bundledGitBuild.mjs'
import { ignoreFromPackage } from './packager.config.mjs'
import { ROOT, read } from '../tests/helpers/source.ts'

const DESKTOP = fileURLToPath(new URL('.', import.meta.url))

test('bundled Git source identity and platform-specific locations are pinned', () => {
  assert.equal(Object.isFrozen(BUNDLED_GIT), true)
  assert.deepEqual(BUNDLED_GIT, {
    version: '2.56.0',
    sourceUrl: 'https://www.kernel.org/pub/software/scm/git/git-2.56.0.tar.gz',
    sourceSha256: '826817fd3671b8565586d6d49f688298de8354ab11db829c02720e5c74b9b39f',
    sourceArchive: 'git-2.56.0.tar.gz',
  })

  assert.equal(bundledGitDirectory({ packaged: false, targetPlatform: 'linux', targetArch: 'arm64' }), null)
  assert.equal(bundledGitDirectory({ packaged: true, resourcesPath: '/app/Resources', targetPlatform: 'win32' }), null)
  assert.equal(
    bundledGitDirectory({ packaged: false, targetPlatform: 'darwin', targetArch: 'arm64' }),
    join(DESKTOP, 'bin', 'git-arm64', 'agent-commons-git'),
  )
  assert.equal(
    bundledGitDirectory({ packaged: false, targetPlatform: 'darwin', targetArch: 'x64' }),
    join(DESKTOP, 'bin', 'git-x64', 'agent-commons-git'),
  )
  assert.equal(
    bundledGitDirectory({ packaged: true, resourcesPath: '/app/Resources', targetPlatform: 'darwin', targetArch: 'x64' }),
    '/app/Resources/agent-commons-git',
  )
  assert.throws(
    () => bundledGitDirectory({ packaged: true, resourcesPath: '/app/Resources', targetPlatform: 'darwin', targetArch: 'universal' }),
    /arm64 or x64/,
  )
  assert.throws(() => { BUNDLED_GIT.version = 'system-git' }, /read only|assign/i)
})

test('Git build plans are macOS-only and pin the target architecture and minimum OS', () => {
  assert.equal(bundledGitBuildPlan({ targetPlatform: 'linux', targetArch: 'x64' }), null)
  assert.equal(bundledGitBuildPlan({ targetPlatform: 'win32', targetArch: 'x64' }), null)

  for (const [targetArch, architecture] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
    const plan = bundledGitBuildPlan({ targetPlatform: 'darwin', targetArch })
    assert.equal(plan.command, '/usr/bin/make')
    assert.equal(plan.architecture, architecture)
    assert.ok(Array.isArray(plan.args) && plan.args.length > 0)
    assert.ok(plan.args.join(' ').includes(architecture), `make arguments must identify ${architecture}`)
    assert.ok(plan.args.join(' ').includes('13.0'), 'the build must target the Electron minimum macOS version')
    for (const option of [
      'NO_RUST=YesPlease',
      'NO_CURL=YesPlease',
      'NO_HOMEBREW=YesPlease',
      'NO_FINK=YesPlease',
      'NO_DARWIN_PORTS=YesPlease',
      'NO_GETTEXT=YesPlease',
      'NO_PERL=YesPlease',
      'NO_PYTHON=YesPlease',
      'NO_TCLTK=YesPlease',
    ]) {
      assert.ok(plan.args.includes(option), `the standalone build must pass ${option}`)
    }
  }

  assert.throws(() => bundledGitBuildPlan({ targetPlatform: 'darwin', targetArch: 'universal' }), /arm64 or x64/)
})

test('Git source archive validation rejects wrong content and archives above the fixed bound', () => {
  assert.throws(() => assertGitSourceArchive(Buffer.from('not the pinned Git archive')), /SHA-256|checksum|hash/i)
  assert.throws(() => assertGitSourceArchive(Buffer.alloc(16 * 1024 * 1024 + 1)), /16 MiB|size|large/i)
})

test('bundled Git probes require the exact version, target architecture, and system-only load paths', () => {
  const validLibraries = [
    'agent-commons-git:',
    '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)',
    '\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 1.0.0, current version 1.0.0)',
  ].join('\n')

  assert.doesNotThrow(() => assertBundledGitProbes({
    architectures: 'arm64', libraries: validLibraries, version: 'git version 2.56.0',
  }, 'arm64'))
  assert.doesNotThrow(() => assertBundledGitProbes({
    architectures: 'x86_64', libraries: validLibraries, version: 'git version 2.56.0',
  }, 'x64'))

  for (const [probes, targetArch] of [
    [{ architectures: 'x86_64', libraries: validLibraries, version: 'git version 2.56.0' }, 'arm64'],
    [{ architectures: 'arm64 x86_64', libraries: validLibraries, version: 'git version 2.56.0' }, 'arm64'],
    [{ architectures: 'arm64', libraries: validLibraries, version: 'git version 2.55.0' }, 'arm64'],
    [{ architectures: 'arm64', libraries: 'git:\n\t/opt/homebrew/opt/gettext/lib/libintl.8.dylib (compatibility version 1.0.0, current version 1.0.0)', version: 'git version 2.56.0' }, 'arm64'],
    [{ architectures: 'arm64', libraries: 'git:\n\t@rpath/libcrypto.dylib (compatibility version 1.0.0, current version 1.0.0)', version: 'git version 2.56.0' }, 'arm64'],
    [{ architectures: 'arm64', libraries: 'git:\n\t/usr/lib/../../opt/foreign.dylib (compatibility version 1.0.0, current version 1.0.0)', version: 'git version 2.56.0' }, 'arm64'],
    [{ architectures: 'arm64', libraries: 'not an otool library listing', version: 'git version 2.56.0' }, 'arm64'],
    [{ architectures: 'arm64', libraries: 'agent-commons-git:\n', version: 'git version 2.56.0' }, 'arm64'],
  ]) {
    assert.throws(() => assertBundledGitProbes(probes, targetArch))
  }
})

test('bundled Git probe environment excludes inherited Git, loader, home, and PATH state', () => {
  const keys = ['GIT_CONFIG_COUNT', 'GIT_DIR', 'DYLD_INSERT_LIBRARIES', 'PATH']
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  process.env.GIT_CONFIG_COUNT = '71'
  process.env.GIT_DIR = '/tmp/not-the-test-repository'
  process.env.DYLD_INSERT_LIBRARIES = '/tmp/injected.dylib'
  process.env.PATH = '/tmp/untrusted-bin'

  try {
    const environment = bundledGitProbeEnvironment()
    assert.equal(environment.PATH, '/usr/bin:/bin')
    assert.equal(environment.LC_ALL, 'C')
    for (const key of ['GIT_CONFIG_COUNT', 'GIT_DIR', 'DYLD_INSERT_LIBRARIES', 'HOME']) {
      assert.equal(Object.hasOwn(environment, key), false, `${key} must not reach bundled Git`)
    }
    assert.equal(environment.GIT_CONFIG_NOSYSTEM, '1')
    assert.equal(environment.GIT_CONFIG_GLOBAL, '/dev/null')
    assert.equal(environment.GIT_CONFIG_SYSTEM, '/dev/null')
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})

test('the build recipe and desktop packaging keep Git self-contained, outside ASAR, and in smoke coverage', () => {
  const buildSource = readFileSync(new URL('./bundledGitBuild.mjs', import.meta.url), 'utf8')
  const runtimeSource = readFileSync(new URL('./bundledGit.mjs', import.meta.url), 'utf8')
  const packageSource = readFileSync(new URL('./package.mjs', import.meta.url), 'utf8')
  const packagerSource = readFileSync(new URL('./packager.config.mjs', import.meta.url), 'utf8')
  const smokeSource = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')

  assert.match(buildSource, /build-recipe\.json/)
  assert.match(buildSource, /COPYING/)
  assert.match(buildSource, /LGPL-2\.1/)
  assert.match(runtimeSource, /CC=\/usr\/bin\/clang/)
  assert.match(runtimeSource, /agent-commons-git/)
  assert.doesNotMatch(runtimeSource, /return\s+['"]git['"]/, 'runtime resolution must not fall back to host Git')
  assert.match(packageSource, /bundledGitBuildPlan|buildBundledGit/)
  assert.match(packageSource, /extraResource/)
  assert.match(packagerSource, /desktop\/bin/)
  assert.match(smokeSource, /bundledGitSmoke/)
  assert.match(smokeSource, /smokePackagedBundledGit/)
  assert.equal(ignoreFromPackage('/desktop/bundledGit.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/bundledGitBuild.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/bundledGitSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/entitlements.git.plist'), true)
  assert.equal(ignoreFromPackage('/desktop/bundledGit.test.ts'), true)
})

test('packaged Git smoke verifies the internal baseline against shipped ASAR dependencies', () => {
  const smokeSource = readFileSync(new URL('./bundledGitSmoke.mjs', import.meta.url), 'utf8')
  const baselineDependencies = [
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
  assert.ok(smokeSource.includes('await assertBaselineSourcesMatchPackagedAsar(executable)'))
  assert.ok(smokeSource.includes('extractFile(archive, name)'))
  assert.ok(smokeSource.includes('assert.deepEqual(packaged, source'))
  assert.ok(smokeSource.includes('withLocalGitBaseline(pinned'))
  assert.ok(smokeSource.includes("withLocalGitFileBaseline(pinned, 'tracked.txt'"))
  assert.ok(smokeSource.includes('assert.deepEqual(selectedBaseline, {'))
  assert.ok(smokeSource.includes("headPaths: ['tracked.txt'], indexPaths: ['tracked.txt']"))
  assert.ok(smokeSource.includes('readLocalGitReview(pinned, { gitExecutable: git, fileExecutable: fileHelper })'))
  assert.ok(smokeSource.includes("createLocalGitReader({ gitExecutable: git, fileExecutable: fileHelper })"))
  assert.ok(smokeSource.includes('await localReader.listLocalGitUntrackedFiles(pinned)'))
  assert.ok(smokeSource.includes("await localReader.readLocalGitUntrackedFile(pinned, { selection: { path: 'untracked.txt' } })"))
  assert.ok(smokeSource.includes("await assert.rejects(localReader.readLocalGitFile(pinned, { selection: { path: 'untracked.txt' } })"))
  assert.ok(smokeSource.includes('await localReader.readLocalGitSnapshot(pinned)'))
  assert.ok(smokeSource.includes("headBytes.toString('utf8'), 'HEAD baseline bytes\\n'"))
  assert.ok(smokeSource.includes("indexBytes.toString('utf8'), 'staged index bytes\\n'"))
  assert.ok(smokeSource.includes("'uncommitted working text\\n'"))
  assert.ok(smokeSource.includes("trackedReview.staged, 'modified'"))
  assert.ok(smokeSource.includes("trackedReview.unstaged, 'modified'"))
  assert.ok(smokeSource.includes("removedReview.staged, 'deleted'"))
  assert.ok(smokeSource.includes("removedReview.unstaged, 'unchanged'"))
  assert.ok(smokeSource.includes("['untracked.txt', 'private.secret']"))
  assert.ok(smokeSource.includes("run(['pack-refs', '--all', '--prune'])"))
  assert.ok(smokeSource.includes("'the fixture exercises packed refs'"))
  assert.ok(smokeSource.includes("'the fixture exercises packed objects'"))
  assert.ok(smokeSource.includes("metadataSnapshot(join(fixture, '.git'))"))
  for (const modulePath of baselineDependencies) {
    assert.ok(smokeSource.includes(`'${modulePath}'`), `smoke verifies ${modulePath} in ASAR`)
    assert.equal(ignoreFromPackage(`/${modulePath}`), false, `${modulePath} ships inside app.asar`)
    const source = read(join(ROOT, modulePath))
    for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(modulePath), specifier))
      assert.ok(baselineDependencies.includes(dependency), `${modulePath} dependency ${dependency} must also be verified`)
    }
  }
  assert.equal(ignoreFromPackage('/desktop/gitBaselineReader.test.ts'), true)
  assert.equal(ignoreFromPackage('/desktop/localGitReview.test.ts'), true)
})
