import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

function checkWiring(packageSource, smokeSource) {
  assert.ok(packageSource.includes('buildImageOcrHelper({ targetPlatform, targetArch })'))
  assert.ok(packageSource.includes('extraResource: [profileHelperPath, gitDirectory, gitFileHelperPath, imageOcrHelperPath].filter(Boolean)'))
  assert.ok(packageSource.includes("if (!existsSync(ocrPath)) throw new Error('The packaged macOS image OCR helper is missing.')"))
  assert.ok(packageSource.indexOf('buildImageOcrHelper({') < packageSource.indexOf('await packager('))
  assert.ok(smokeSource.includes('await smokePackagedImageOcr({ executable })'))
}

test('OCR is a native packaged prerequisite, with recognition proof in executable and extracted-release smoke', () => {
  const packageSource = readFileSync(new URL('./package.mjs', import.meta.url), 'utf8')
  const smokeSource = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  checkWiring(packageSource, smokeSource)
  const withoutAcceptance = smokeSource.replace('await smokePackagedImageOcr({ executable })', '')
  assert.notEqual(withoutAcceptance, smokeSource)
  assert.throws(() => checkWiring(packageSource, withoutAcceptance), assert.AssertionError)
  const nativeBuild = readFileSync(new URL('./nativeBuild.mjs', import.meta.url), 'utf8')
  assert.ok(nativeBuild.includes('buildImageOcrHelper({ targetPlatform, targetArch })'))
  for (const path of ['native/image-ocr.m', 'native/image-ocr-fixture.m', 'bin/agent-commons-image-ocr',
    'ocrHelperBuild.mjs', 'imageOcrFixture.mjs', 'imageOcrSmoke.mjs']) assert.equal(ignoreFromPackage(`/desktop/${path}`), true, path)
  assert.equal(ignoreFromPackage('/desktop/imageOcr.mjs'), false)
})

test('internal OCR engine adds no renderer bridge before explicit review/adoption', () => {
  for (const name of ['main.mjs', 'preload.cjs', 'contextPicker.mjs']) {
    const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /createImageOcrRunner|imageOcr|image-ocr/, name)
  }
})
