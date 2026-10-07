import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import type { PdfOcrResult } from '../../contract/pdfOcr.mjs'
import { reviewArtifactPdfOcrImport } from './artifactPdfOcrImport.ts'

const pdf = new TextEncoder().encode('%PDF-1.7\ntest bytes')
const file = { name: 'scan.manual.pdf', kind: 'file' as const, pdfOcrInput: pdf }

test('successful scan yields a review-only candidate with complete text and page disclosure', async () => {
  const signal = new AbortController().signal
  const result = await reviewArtifactPdfOcrImport([file], signal, async (input, seenSignal) => {
    assert.deepEqual(input, pdf)
    assert.equal(seenSignal, signal)
    return { status: 'ready', text: '  Cobalt garden 427\nExact body.  ', pages: 4, textPages: 3 }
  })
  assert.deepEqual(result, {
    status: 'ready', name: 'scan.manual.md', text: '  Cobalt garden 427\nExact body.  ',
    disclosure: 'All 4 PDF pages were processed on this Mac; text was recognized on 3 pages. Check page order, omissions and recognition errors. Pages are rendered at up to 2,000 pixels per edge for recognition; formatting and layout are not preserved. The PDF is not uploaded or saved; extraction makes no model call.',
  })
  assert.deepEqual(Object.keys(result).sort(), ['disclosure', 'name', 'status', 'text'])
})

test('empty, cancelled, wrong-format and malformed selections refuse before recognition', async () => {
  const never = async (): Promise<PdfOcrResult> => { assert.fail('must refuse before OCR') }
  const signal = new AbortController().signal
  assert.deepEqual(await reviewArtifactPdfOcrImport([], signal, never), { status: 'cancelled' })
  assert.deepEqual(await reviewArtifactPdfOcrImport([file], AbortSignal.abort(), never), { status: 'cancelled' })
  for (const files of [[file, file], [{ ...file, kind: 'photo' as const }], [{ ...file, name: 'notes.txt' }], [{ name: 'scan.pdf', kind: 'file' as const }]]) {
    assert.equal((await reviewArtifactPdfOcrImport(files, signal, never)).status, 'error')
  }
})

test('all native failures are actionable, preserve the draft and do not reveal diagnostics', async () => {
  for (const status of ['invalid', 'too-large', 'page-limit', 'protected', 'unavailable', 'busy', 'timeout'] as const) {
    const result = await reviewArtifactPdfOcrImport([file], new AbortController().signal, async () => ({ status }))
    assert.equal(result.status, 'error', status)
    if (result.status === 'error') {
      assert.match(result.message, /Your draft is unchanged\./)
      assert.doesNotMatch(result.message, /private|native diagnostic|\/Users\//i)
    }
  }
  assert.deepEqual(await reviewArtifactPdfOcrImport([file], new AbortController().signal, async () => ({ status: 'cancelled' })), { status: 'cancelled' })
  const noText = await reviewArtifactPdfOcrImport([file], new AbortController().signal, async () => ({ status: 'no-text', pages: 5, textPages: 0 }))
  assert.equal(noText.status, 'error')
  if (noText.status === 'error') assert.match(noText.message, /any of the 5 PDF pages/)
})

test('refuses whole recognized text above authoring limit without clipping and fences late cancellation', async () => {
  const exact = 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)
  assert.equal((await reviewArtifactPdfOcrImport([file], new AbortController().signal, async () => ({ status: 'ready', text: exact, pages: 1, textPages: 1 }))).status, 'ready')
  const tooLong = await reviewArtifactPdfOcrImport([file], new AbortController().signal, async () => ({ status: 'ready', text: `${exact}x`, pages: 1, textPages: 1 }))
  assert.equal(tooLong.status, 'error')
  if (tooLong.status === 'error') assert.match(tooLong.message, /Nothing was truncated/)
  const controller = new AbortController()
  let resolve!: (result: PdfOcrResult) => void
  const pending = reviewArtifactPdfOcrImport([file], controller.signal, () => new Promise(yes => { resolve = yes }))
  controller.abort()
  resolve({ status: 'ready', text: 'late text', pages: 1, textPages: 1 })
  assert.deepEqual(await pending, { status: 'cancelled' })
})
