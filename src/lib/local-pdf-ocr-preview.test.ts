import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDF_OCR_MAX_INPUT_BYTES, PDF_OCR_MAX_TEXT_BYTES } from '../../contract/pdfOcr.mjs'
import { recognizeLocalPdfPreview } from './localPdfOcrPreview.ts'

const path = 'research/scanned.pdf'
function pdfBytes(length = 24) {
  const bytes = new Uint8Array(length)
  bytes.set(new TextEncoder().encode('%PDF-1.7'))
  return bytes
}
function preview(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    path,
    sizeBytes: 24,
    snapshot: { omitted: 'document-extraction' },
    pdfOcrInput: pdfBytes(),
    documentImport: { format: 'pdf', status: 'no-text', pages: 2, textPages: 0 },
    ...overrides,
  }
}
const success = { status: 'ready', text: 'recognized text\nsecond line', pages: 2, textPages: 2 }

test('recognizes only a matching bounded PDF snapshot and publishes a byte-free OCR text preview', async () => {
  const source = preview()
  const input = source.pdfOcrInput
  let received!: Uint8Array
  const controller = new AbortController()
  const result = await recognizeLocalPdfPreview(source as never, controller.signal, async (bytes, signal) => {
    received = bytes
    assert.equal(signal, controller.signal)
    assert.notEqual(bytes, input, 'OCR receives a detached copy')
    assert.deepEqual(bytes, input)
    return success
  })
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.deepEqual(result.preview, {
    version: 1, path, sizeBytes: 24,
    snapshot: { text: success.text },
    documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' },
  })
  assert.equal('pdfOcrInput' in result.preview, false)
  assert.equal(JSON.stringify(result.preview).includes('%PDF-'), false)
  assert.equal(JSON.stringify(result.preview).includes('bytes'), false)
  assert.equal(received.byteLength, input.byteLength)
})

test('explicit OCR can be requested for a PDF whose embedded text preview is already ready', async () => {
  const source = preview({
    snapshot: { text: 'embedded text' },
    documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 1 },
  })
  const result = await recognizeLocalPdfPreview(source as never, new AbortController().signal, async () => success)
  assert.equal(result.status, 'ready')
  if (result.status === 'ready') assert.equal(result.preview.snapshot.text, success.text)
})

test('rejects wrong PDF metadata, missing or malformed captured bytes, and out-of-bounds input before recognition', async () => {
  const oversized = pdfBytes(PDF_OCR_MAX_INPUT_BYTES + 1)
  const invalidHeader = new Uint8Array(24).fill(0x41)
  const lateHeader = new Uint8Array(1100).fill(0x41)
  lateHeader.set(new TextEncoder().encode('%PDF-1.7'), 1025)
  const invalid = [
    preview({ path: 'research/scanned.txt' }),
    preview({ snapshot: { document: { format: 'pdf', bytes: pdfBytes() } } }),
    preview({ documentImport: { format: 'docx', status: 'no-text' } }),
    preview({ snapshot: { omitted: 'unsupported' } }),
    preview({ sizeBytes: 23 }),
    preview({ pdfOcrInput: undefined }),
    preview({ pdfOcrInput: new Uint8Array(7) }),
    preview({ pdfOcrInput: invalidHeader }),
    preview({ pdfOcrInput: lateHeader }),
    preview({ pdfOcrInput: oversized }),
    preview({ pdfOcrInput: [37, 80, 68, 70] }),
  ]
  for (const candidate of invalid) {
    let called = false
    const result = await recognizeLocalPdfPreview(candidate as never, new AbortController().signal, async () => {
      called = true
      return success
    })
    assert.equal(result.status, 'error')
    assert.equal(called, false)
    if (result.status === 'error') assert.doesNotMatch(result.message, /%PDF|\/Users|private|native diagnostic/i)
  }
})

test('accepts a PDF header within the bounded scan window and gives the recognizer only captured bytes', async () => {
  const bytes = new Uint8Array(1024).fill(0x20)
  bytes.set(new TextEncoder().encode('%PDF-1.7'), 1016)
  const source = preview({ sizeBytes: 1024, pdfOcrInput: bytes })
  let observed: Uint8Array | undefined
  const result = await recognizeLocalPdfPreview(source as never, new AbortController().signal, async input => {
    observed = input
    return success
  })
  assert.equal(result.status, 'ready')
  assert.ok(observed)
  assert.notEqual(observed, bytes)
  assert.deepEqual(observed, bytes)
})

test('malformed, incomplete, over-limit and no-text OCR results refuse without replacing the prior preview', async () => {
  const results: unknown[] = [
    { status: 'ready', text: '', pages: 1, textPages: 1 },
    { status: 'ready', text: 'x'.repeat(PDF_OCR_MAX_TEXT_BYTES + 1), pages: 1, textPages: 1 },
    { status: 'ready', text: 'partial', pages: 2, textPages: 1, privatePath: '/Users/private.pdf' },
    { status: 'ready', text: 'text', pages: 1, textPages: 2 },
    { status: 'no-text', pages: 2, textPages: 0 },
    { status: 'mystery', text: 'text', pages: 1, textPages: 1 },
    { status: 'timeout', diagnostic: '/Users/private/native diagnostic' },
  ]
  for (const outcome of results) {
    const prior = preview()
    const before = structuredClone(prior)
    const result = await recognizeLocalPdfPreview(prior as never, new AbortController().signal, async () => outcome)
    assert.equal(result.status, 'error')
    assert.deepEqual(prior, before, 'recognition refusal leaves the prior preview available to its owner')
    if (result.status === 'error') assert.doesNotMatch(result.message, /private|native diagnostic|\/Users\//i)
  }
  for (const status of ['invalid', 'too-large', 'page-limit', 'protected', 'unavailable', 'busy', 'cancelled', 'timeout'] as const) {
    const result = await recognizeLocalPdfPreview(preview() as never, new AbortController().signal, async () => ({ status }))
    if (status === 'cancelled') assert.deepEqual(result, { status: 'cancelled' })
    else {
      assert.equal(result.status, 'error', status)
      if (result.status === 'error') assert.doesNotMatch(result.message, /private|native diagnostic|\/Users\//i)
    }
  }
})

test('recognition exceptions become safe errors and cancellation never returns late recognized text', async () => {
  const failed = await recognizeLocalPdfPreview(preview() as never, new AbortController().signal, async () => {
    throw new Error('/Users/private.pdf native diagnostic')
  })
  assert.equal(failed.status, 'error')
  if (failed.status === 'error') assert.doesNotMatch(failed.message, /private|native diagnostic|\/Users\//i)

  const controller = new AbortController()
  let finish!: (value: unknown) => void
  const source = preview()
  const captured = source.pdfOcrInput
  let passed!: Uint8Array
  const pending = recognizeLocalPdfPreview(source as never, controller.signal, async bytes => {
    passed = bytes
    return new Promise(resolve => { finish = resolve })
  })
  captured.fill(0)
  assert.deepEqual(passed, pdfBytes(), 'source mutation cannot alter the detached bytes being recognized')
  controller.abort()
  finish(success)
  assert.deepEqual(await pending, { status: 'cancelled' })
})

test('an already-aborted signal refuses without invoking the recognizer', async () => {
  const controller = new AbortController()
  controller.abort()
  let called = false
  const result = await recognizeLocalPdfPreview(preview() as never, controller.signal, async () => {
    called = true
    return success
  })
  assert.deepEqual(result, { status: 'cancelled' })
  assert.equal(called, false)
})
