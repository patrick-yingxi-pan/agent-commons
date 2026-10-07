import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { buildPdfOcrHelper } from './pdfOcrHelperBuild.mjs'
import { pdfOcrFixture } from './pdfOcrFixture.mjs'
import { PDF_OCR_MAX_INPUT_BYTES } from '../contract/pdfOcr.mjs'
import { createPdfOcrRunner } from './pdfOcr.mjs'

const temporaryDirectories: string[] = []
after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }) })

function fixtureDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-pdf-ocr-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function invoke(helper: string, input: Buffer, args: string[] = []) {
  const result = spawnSync(helper, args, { input, encoding: 'utf8', timeout: 120_000, maxBuffer: 512 * 1024 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/)
  return {
    payload: JSON.parse(result.stdout) as { status: string; text?: string; pages?: number; textPages?: number },
    stderr: result.stderr,
  }
}

test('native PDF OCR handles generated scanned and invalid documents', {
  skip: process.platform !== 'darwin',
}, async (t) => {
  const directory = fixtureDirectory()
  const bundle = buildPdfOcrHelper({ targetArch: process.arch === 'x64' ? 'x64' : 'arm64', outputPath: join(directory, 'PDF OCR.app') })
  assert.equal(bundle, join(directory, 'PDF OCR.app'))
  const helper = join(bundle, 'Contents', 'MacOS', 'agent-commons-pdf-ocr')
  const scanned = pdfOcrFixture({ mode: 'scanned' })
  const observed = invoke(helper, scanned)
  await t.test('recognizes every image-only page with macOS Vision', () => {
    const result = observed.payload
    assert.equal(result.status, 'ready')
    assert.equal(result.pages, 2)
    assert.equal(result.textPages, 2)
    assert.match(result.text ?? '', /\[Page 1\][\s\S]*Scan\s+Alpha\s+427/i)
    assert.match(result.text ?? '', /\[Page 2\][\s\S]*Scan\s+Bravo\s+813/i)
    assert.ok(Buffer.byteLength(result.text ?? '', 'utf8') <= 64 * 1024)
  })

  const runner = createPdfOcrRunner({ executable: helper, targetPlatform: 'darwin' })
  assert.deepEqual(await runner.recognize(scanned), observed.payload)
  runner.dispose()

  assert.deepEqual(invoke(helper, pdfOcrFixture({ mode: 'blank' })).payload, { status: 'no-text', pages: 2, textPages: 0 })
  assert.deepEqual(invoke(helper, Buffer.from('not a PDF')).payload, { status: 'invalid' })
  assert.deepEqual(invoke(helper, pdfOcrFixture({ mode: 'blank' }), ['--help']).payload, { status: 'invalid' })
  assert.deepEqual(invoke(helper, Buffer.alloc(PDF_OCR_MAX_INPUT_BYTES + 1)).payload, { status: 'too-large' })
  assert.deepEqual(invoke(helper, pdfOcrFixture({ mode: 'protected' })).payload, { status: 'protected' })
  assert.deepEqual(invoke(helper, pdfOcrFixture({ mode: 'pages101' })).payload, { status: 'page-limit' })
})
