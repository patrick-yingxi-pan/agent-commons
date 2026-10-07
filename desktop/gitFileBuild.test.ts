import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import packagerConfig, { ignoreFromPackage } from './packager.config.mjs'
import { gitFileBuildPlan } from './gitFileBuild.mjs'
import { gitFileExecutable } from './gitFileRead.mjs'

test('Git file helper is target-specific, architecture-bounded, and uses only system clang', () => {
  assert.equal(gitFileBuildPlan({ targetPlatform: 'linux', targetArch: 'x64' }), null)
  assert.equal(gitFileBuildPlan({ targetPlatform: 'win32', targetArch: 'x64' }), null)

  const arm = gitFileBuildPlan({ targetPlatform: 'darwin', targetArch: 'arm64', outputPath: '/tmp/git-file-arm64' })
  assert.equal(arm.compiler, '/usr/bin/clang')
  assert.equal(arm.outputPath, '/tmp/git-file-arm64')
  assert.equal(arm.architecture, 'arm64')
  assert.deepEqual(arm.args.slice(0, 8), [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=13.0', '-arch', 'arm64',
  ])
  assert.equal(arm.args.at(-1), '/tmp/git-file-arm64')

  const intel = gitFileBuildPlan({ targetPlatform: 'darwin', targetArch: 'x64' })
  assert.equal(intel.architecture, 'x86_64')
  assert.equal(intel.args[intel.args.indexOf('-arch') + 1], 'x86_64')
  assert.equal(intel.outputPath, fileURLToPath(new URL('./bin/git-file-x64/agent-commons-git-file', import.meta.url)))
  assert.throws(() => gitFileBuildPlan({ targetPlatform: 'darwin', targetArch: 'ia32' }), /does not support architecture/)
})

test('Git file helper has a fixed packaged path and build inputs stay out of ASAR', () => {
  assert.equal(gitFileExecutable({ packaged: true, resourcesPath: '/App/Contents/Resources', targetArch: 'arm64' }),
    '/App/Contents/Resources/agent-commons-git-file')
  assert.equal(gitFileExecutable({ packaged: false, targetArch: 'arm64' }),
    fileURLToPath(new URL('./bin/git-file-arm64/agent-commons-git-file', import.meta.url)))
  assert.equal(gitFileExecutable({ targetPlatform: 'linux', targetArch: 'x64' }), null)
  assert.equal(ignoreFromPackage('/desktop/gitFileBuild.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/gitFilePaths.mjs'), false, 'the runtime path resolver belongs in ASAR')
  assert.equal(ignoreFromPackage('/desktop/native/git-file.c'), true)
  assert.equal(ignoreFromPackage('/desktop/bin/git-file-arm64/agent-commons-git-file'), true)
  assert.equal(ignoreFromPackage('/desktop/gitFileRead.mjs'), false, 'the runtime wrapper belongs in ASAR')

  const packageSource = readFileSync(new URL('./package.mjs', import.meta.url), 'utf8')
  assert.match(packageSource, /buildGitFileHelper\(\{ targetPlatform, targetArch \}\)/)
  assert.match(packageSource, /extraResource: \[profileHelperPath, gitDirectory, gitFileHelperPath, imageOcrHelperPath, pdfOcrBrokerBundlePath\]\.filter\(Boolean\)/)
  assert.ok(packageSource.indexOf('buildGitFileHelper(') < packageSource.indexOf('await packager('))
  assert.equal(packagerConfig.asar, true)
  const devSource = readFileSync(new URL('./dev.mjs', import.meta.url), 'utf8')
  assert.match(devSource, /buildDesktopNativeRuntime\(\)/)
})
