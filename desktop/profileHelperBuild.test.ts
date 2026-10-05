import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import packagerConfig, { ignoreFromPackage } from './packager.config.mjs'
import { buildDesktopProfileHelper, profileHelperBuildPlan } from './profileHelperBuild.mjs'

test('the macOS ACL helper build is target-specific, architecture-bounded, and uses Electron 44 minimum macOS', () => {
  assert.equal(buildDesktopProfileHelper({ targetPlatform: 'linux', targetArch: 'x64' }), null)
  assert.equal(profileHelperBuildPlan({ targetPlatform: 'win32', targetArch: 'x64' }), null)

  const arm = profileHelperBuildPlan({
    targetPlatform: 'darwin',
    targetArch: 'arm64',
    outputPath: '/tmp/profile-acl-arm64',
  })
  assert.equal(arm.compiler, '/usr/bin/clang')
  assert.equal(arm.outputPath, '/tmp/profile-acl-arm64')
  assert.deepEqual(arm.args.slice(0, 8), [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=13.0', '-arch', 'arm64',
  ])
  assert.equal(arm.args.at(-1), '/tmp/profile-acl-arm64')

  const intel = profileHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'x64' })
  assert.equal(intel.args[intel.args.indexOf('-arch') + 1], 'x86_64')
  assert.equal(intel.outputPath, fileURLToPath(new URL('./bin/profile-acl', import.meta.url)))
  assert.throws(() => profileHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'ia32' }), /does not support architecture/)
})

test('macOS ACL helper is copied beside the application and excluded with its build inputs from ASAR', () => {
  assert.equal(ignoreFromPackage('/desktop/native'), true)
  assert.equal(ignoreFromPackage('/desktop/native/profile-acl.c'), true)
  assert.equal(ignoreFromPackage('/desktop/bin'), true)
  assert.equal(ignoreFromPackage('/desktop/bin/profile-acl'), true)
  assert.equal(ignoreFromPackage('/desktop/profileHelperBuild.mjs'), true)

  const packageSource = readFileSync(new URL('./package.mjs', import.meta.url), 'utf8')
  assert.match(packageSource, /buildDesktopProfileHelper\(\{ targetPlatform, targetArch \}\)/)
  assert.match(packageSource, /extraResource: \[profileHelperPath, gitDirectory\]\.filter\(Boolean\)/)
  assert.ok(packageSource.indexOf('buildDesktopProfileHelper(') < packageSource.indexOf('await packager('))
  assert.equal(ignoreFromPackage('/desktop/userDataDirectory.mjs'), false)
  assert.equal(packagerConfig.asar, true)

  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.scripts.prestart, 'node desktop/profileHelperBuild.mjs')
  assert.equal(manifest.scripts['prestart:desktop'], 'node desktop/profileHelperBuild.mjs')
  const devSource = readFileSync(new URL('./dev.mjs', import.meta.url), 'utf8')
  assert.match(devSource, /buildDesktopProfileHelper\(\)/)
})
