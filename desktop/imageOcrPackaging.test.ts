import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

function checkWiring(packageSource, smokeSource) {
  assert.ok(packageSource.includes('buildImageOcrHelper({ targetPlatform, targetArch })'))
  assert.ok(packageSource.includes('extraResource: [profileHelperPath, gitDirectory, gitFileHelperPath, imageOcrHelperPath, pdfOcrBrokerBundlePath].filter(Boolean)'))
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

test('native file selection never starts OCR and packaged UI acceptance exercises explicit review/adoption', () => {
  const picker = readFileSync(new URL('./contextPicker.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(picker, /createImageOcrRunner|imageOcr|image-ocr/, 'picking is never implicit extraction')
  const smoke = readFileSync(new URL('./attachmentSmoke.mjs', import.meta.url), 'utf8')
  assert.match(smoke, /runArtifactImageImportSmoke\(/)
  assert.match(smoke, /assert\.deepEqual\(restoredImageOcrBody, importedImage\.body/)
  for (const path of ['imageOcr.mjs', 'imageOcrHost.mjs', 'image-ocr-channels.cjs']) assert.equal(ignoreFromPackage(`/desktop/${path}`), false, path)
  assert.equal(ignoreFromPackage('/contract/imageOcr.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/artifactImageImportSmoke.mjs'), true)
})
