import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

const source = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function wiring(pack, smoke) {
  assert.ok(pack.includes('buildPdfOcrHelper({ targetPlatform, targetArch })'))
  assert.ok(pack.includes('extraResource: [profileHelperPath, gitDirectory, gitFileHelperPath, imageOcrHelperPath, pdfOcrBrokerBundlePath].filter(Boolean)'))
  assert.ok(pack.includes('afterCopyExtraResources: ['))
  assert.ok(pack.includes('relocatePdfOcrBrokerAfterCopyExtraResources'))
  assert.ok(pack.includes("'Contents', 'Helpers', 'Agent Commons PDF OCR.app'"))
  assert.ok(pack.includes("if (!existsSync(pdfOcrBroker) || !existsSync(pdfOcrService)) throw new Error('The packaged macOS PDF OCR broker or sandboxed service is missing.')"))
  assert.ok(pack.indexOf('buildPdfOcrHelper({') < pack.indexOf('await packager('))
  assert.ok(smoke.includes('await smokePackagedPdfOcr({ executable })'))
}
test('PDF OCR ships the signed broker/XPC service bundle and native acceptance, without test fixtures', () => {
  const pack = source('./package.mjs')
  const smoke = source('./smoke.mjs')
  wiring(pack, smoke)
  const broken = smoke.replace('await smokePackagedPdfOcr({ executable })', '')
  assert.notEqual(broken, smoke)
  assert.throws(() => wiring(pack, broken), assert.AssertionError)
  const builder = source('./pdfOcrHelperBuild.mjs')
  assert.match(builder, /pdf-ocr-broker\.m/)
  assert.match(builder, /pdf-ocr-service\.m/)
  assert.match(builder, /pdf-ocr-peer\.m/)
  assert.match(builder, /entitlements\.pdf-ocr\.plist/)
  assert.match(builder, /serviceSignArgs/)
  assert.match(builder, /brokerSignArgs/)
  assert.match(builder, /transportRequirementArgs/)
  assert.match(builder, /ACPdfOcrAdHocBrokerRequirement/)
  assert.ok(source('./nativeBuild.mjs').includes('buildPdfOcrHelper({ targetPlatform, targetArch })'))
  for (const path of ['native/pdf-ocr.m', 'native/pdf-ocr-fixture.m', 'bin/agent-commons-pdf-ocr',
    'pdfOcrHelperBuild.mjs', 'pdfOcrFixture.mjs', 'pdfOcrSmoke.mjs', 'artifactPdfOcrSmoke.mjs', 'entitlements.pdf-ocr.plist']) {
    assert.equal(ignoreFromPackage(`/desktop/${path}`), true, path)
  }
  for (const path of ['pdfOcr.mjs', 'pdfOcrHost.mjs', 'ocrHost.mjs', 'ocrRunner.mjs', 'pdf-ocr-channels.cjs']) assert.equal(ignoreFromPackage(`/desktop/${path}`), false, path)
  assert.equal(ignoreFromPackage('/contract/pdfOcr.mjs'), false)
})
