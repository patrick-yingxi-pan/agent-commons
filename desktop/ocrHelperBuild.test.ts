import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildImageOcrHelper, ocrHelperBuildPlan } from './ocrHelperBuild.mjs'

test('the macOS image OCR helper build is target-specific, architecture-bounded, and uses system frameworks', () => {
  assert.equal(buildImageOcrHelper({ targetPlatform: 'linux', targetArch: 'x64' }), null)
  assert.equal(ocrHelperBuildPlan({ targetPlatform: 'win32', targetArch: 'x64' }), null)

  const arm = ocrHelperBuildPlan({
    targetPlatform: 'darwin',
    targetArch: 'arm64',
    outputPath: '/tmp/agent-commons-image-ocr-arm64',
  })
  assert.equal(arm.compiler, '/usr/bin/clang')
  assert.equal(arm.outputPath, '/tmp/agent-commons-image-ocr-arm64')
  assert.deepEqual(arm.args.slice(0, 8), [
    '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=13.0', '-arch', 'arm64',
  ])
  assert.equal(arm.args.at(-1), '/tmp/agent-commons-image-ocr-arm64')
  for (const framework of ['Foundation', 'ImageIO', 'CoreGraphics', 'Vision']) {
    assert.ok(arm.args.some((arg, index) => arg === framework && arm.args[index - 1] === '-framework'))
  }
  assert.equal(arm.args.some((arg) => /(^|\/)node_modules\//.test(arg)), false)

  const intel = ocrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'x64' })
  assert.equal(intel.args[intel.args.indexOf('-arch') + 1], 'x86_64')
  assert.equal(intel.outputPath, fileURLToPath(new URL('./bin/agent-commons-image-ocr', import.meta.url)))
  assert.throws(() => ocrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'ia32' }), /does not support architecture/)
  assert.throws(() => ocrHelperBuildPlan({ targetPlatform: 'darwin', targetArch: 'arm64', outputPath: 'relative/path' }), /output path must be absolute/)
})
