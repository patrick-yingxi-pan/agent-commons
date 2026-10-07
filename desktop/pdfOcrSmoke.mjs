import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createPdfOcrRunner, pdfOcrExecutable } from './pdfOcr.mjs'
import { pdfOcrFixture } from './pdfOcrFixture.mjs'

const require = createRequire(import.meta.url)
const { extractFile } = require('@electron/asar')

/** Real generated scanned pages through the shipped native engine. The
 * separate artifact smoke owns selection, review, save and relaunch proof. */
export async function smokePackagedPdfOcr({ executable }) {
  if (process.platform !== 'darwin') return
  const resourcesPath = join(dirname(dirname(executable)), 'Resources')
  const helper = pdfOcrExecutable({ packaged: true, resourcesPath })
  const brokerBundle = dirname(dirname(dirname(helper)))
  const serviceBundle = join(brokerBundle, 'Contents', 'XPCServices', 'com.agentcommons.desktop.pdf-ocr.service.xpc')
  const service = join(serviceBundle, 'Contents', 'MacOS', 'agent-commons-pdf-ocr-service')
  const container = join(brokerBundle, 'Contents', 'MacOS', 'agent-commons-pdf-ocr-container')
  for (const path of ['desktop/pdfOcr.mjs', 'desktop/ocrRunner.mjs', 'desktop/pdfOcrHost.mjs', 'desktop/ocrHost.mjs', 'contract/pdfOcr.mjs']) {
    assert.deepEqual(extractFile(join(resourcesPath, 'app.asar'), path), await readFile(new URL(`../${path}`, import.meta.url)), `${path} matches the tested source`)
  }
  for (const binary of [container, helper, service]) {
    const arch = spawnSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8', timeout: 5_000, maxBuffer: 8_192 })
    assert.equal(arch.status, 0)
    assert.equal(arch.stdout.trim(), process.arch === 'arm64' ? 'arm64' : 'x86_64')
    const libraries = spawnSync('/usr/bin/otool', ['-L', binary], { encoding: 'utf8', timeout: 5_000, maxBuffer: 8_192 })
    assert.equal(libraries.status, 0)
    const dependencies = libraries.stdout.trim().split('\n').slice(1).map(line => line.trim().split(' (')[0])
    assert.ok(dependencies.length > 0 && dependencies.every(path => path.startsWith('/System/Library/') || path.startsWith('/usr/lib/')))
    if (binary !== service) assert.ok(dependencies.every(path => !/CoreGraphics|Vision/.test(path)), 'the unsandboxed broker never links the PDF decoder')
  }
  for (const bundle of [serviceBundle, brokerBundle]) {
    const signature = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', bundle], { encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384 })
    assert.equal(signature.status, 0, signature.stderr)
  }
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', serviceBundle], { encoding: 'utf8', timeout: 5_000, maxBuffer: 16_384 })
  assert.equal(entitlements.status, 0)
  assert.match(entitlements.stdout, /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/)
  assert.doesNotMatch(entitlements.stdout, /security\.(network|files|application-groups|temporary-exception|cs\.)/)
  const runner = createPdfOcrRunner({ executable: helper })
  try {
    const result = await runner.recognize(pdfOcrFixture())
    assert.equal(result.status, 'ready')
    assert.equal(result.pages, 2)
    assert.equal(result.textPages, 2)
    assert.match(result.text, /\[Page 1\][\s\S]+\[Page 2\]/)
    assert.match(result.text, /Scan\s+Alpha\s+427/)
    assert.match(result.text, /Scan\s+Bravo\s+813/)
    assert.deepEqual(await runner.recognize(pdfOcrFixture({ mode: 'blank' })), { status: 'no-text', pages: 2, textPages: 0 })
    assert.deepEqual(await runner.recognize(pdfOcrFixture({ mode: 'protected' })), { status: 'protected' })
    assert.deepEqual(await runner.recognize(pdfOcrFixture({ mode: 'pages101' })), { status: 'page-limit' })
    assert.deepEqual(await runner.recognize(Buffer.from('not a PDF')), { status: 'invalid' })
    assert.deepEqual(await runner.recognize(pdfOcrFixture(), { signal: AbortSignal.abort() }), { status: 'cancelled' })
  } finally { runner.dispose() }
  console.log('[desktop-pdf-ocr-smoke] broker/service architectures + system libraries · sealed bundles + minimal App Sandbox entitlement · ASAR runtime identity · real image-only pages · complete page labels/text · blank/protected/page-limit/invalid/cancel refusal')
}
