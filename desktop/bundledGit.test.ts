import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertBundledGitProbes,
  BUNDLED_GIT,
  bundledGitDirectory,
  bundledGitProbeEnvironment,
} from './bundledGit.mjs'
import { assertGitSourceArchive, bundledGitBuildPlan } from './bundledGitBuild.mjs'
import { ignoreFromPackage } from './packager.config.mjs'

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
