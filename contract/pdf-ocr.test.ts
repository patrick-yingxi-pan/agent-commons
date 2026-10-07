import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PDF_OCR_MAX_INPUT_BYTES, PDF_OCR_MAX_PAGES, PDF_OCR_MAX_TEXT_BYTES,
  isPdfOcrHelperResult, isPdfOcrResult, snapshotPdfOcrInput,
} from './pdfOcr.mjs'

const pdf = (tail = '') => Buffer.from(`%PDF-1.7\n${tail}`)

test('PDF OCR input snapshot is detached, header-checked, and byte-bounded', () => {
  const bytes = pdf('body')
  const snapshot = snapshotPdfOcrInput(bytes)
  assert.equal(snapshot.status, 'ready')
  if (snapshot.status !== 'ready') return
  bytes.fill(0)
  assert.equal(Buffer.from(snapshot.pdf).toString(), '%PDF-1.7\nbody')

  const leading = Buffer.concat([Buffer.alloc(1018, 32), Buffer.from('%PDF-1.7\n')])
  assert.equal(snapshotPdfOcrInput(leading).status, 'ready', 'PDF headers may occur within the first 1024 bytes')
  for (const value of ['https://example.test/a.pdf', new ArrayBuffer(32), new Uint8Array(), Buffer.from('not a PDF')]) {
    assert.deepEqual(snapshotPdfOcrInput(value), { status: 'invalid' })
  }
  assert.deepEqual(snapshotPdfOcrInput(Buffer.alloc(PDF_OCR_MAX_INPUT_BYTES + 1)), { status: 'too-large' })
  if (typeof SharedArrayBuffer === 'function') assert.deepEqual(snapshotPdfOcrInput(new Uint8Array(new SharedArrayBuffer(20))), { status: 'invalid' })
})

test('PDF OCR results are closed and enforce whole UTF-8 text and page bounds', () => {
  const ready = { status: 'ready', text: '[Page 1]\nCobalt garden 427', pages: 2, textPages: 1 }
  assert.equal(isPdfOcrResult(ready), true)
  assert.equal(isPdfOcrHelperResult(ready), true)
  assert.equal(isPdfOcrResult({ status: 'ready', text: 'last page', pages: 100, textPages: 1 }), true)
  const empty = { status: 'no-text', pages: 2, textPages: 0 }
  assert.equal(isPdfOcrResult(empty), true)
  assert.equal(isPdfOcrHelperResult(empty), true)
  for (const status of ['invalid', 'too-large', 'page-limit', 'protected', 'unavailable']) {
    assert.equal(isPdfOcrHelperResult({ status }), true)
  }
  for (const status of ['busy', 'cancelled', 'timeout']) {
    assert.equal(isPdfOcrResult({ status }), true)
    assert.equal(isPdfOcrHelperResult({ status }), false)
  }
  for (const value of [
    null, [], {}, { ...ready, path: '/tmp/source.pdf' }, { ...ready, text: ' ' },
    { ...ready, text: 'bad\0text' }, { ...ready, text: '\ud800' },
    { ...ready, text: 'é'.repeat(PDF_OCR_MAX_TEXT_BYTES / 2 + 1) },
    { ...ready, pages: PDF_OCR_MAX_PAGES + 1 }, { ...ready, textPages: 3 },
    { status: 'no-text', pages: 0, textPages: 0 }, { status: 'no-text', pages: 1, textPages: 1 },
    { status: 'ready', text: 'text', pages: 1, textPages: 0 },
  ]) assert.equal(isPdfOcrResult(value), false)
  assert.equal(PDF_OCR_MAX_TEXT_BYTES, 64 * 1024)
})
