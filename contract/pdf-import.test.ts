import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_BYTES,
  isPdfFileName,
  isPdfImportOutcome,
  pdfImportCopy,
} from './pdfImport.mjs'
import { collectPdfText } from './pdfTextCollection.mjs'

type Item = { str?: string; hasEOL?: boolean }

test('page resources are cleaned even when its text stream cannot be opened', async () => {
  let cleaned = 0
  await assert.rejects(() => collectPdfText({
    numPages: 1,
    getPage: async () => ({
      streamTextContent: () => { throw new Error('stream unavailable') },
      cleanup: () => { cleaned += 1 },
    }),
  }), /stream unavailable/)
  assert.equal(cleaned, 1)
})

function page(items: Item[], counters: { reads?: number; cancels?: number; releases?: number; cleanups?: number } = {}) {
  let read = false
  return {
    streamTextContent() {
      return {
        getReader() {
          return {
            async read() {
              if (read) return { done: true, value: undefined }
              read = true
              counters.reads = (counters.reads ?? 0) + 1
              return { done: false, value: { items } }
            },
            async cancel() { counters.cancels = (counters.cancels ?? 0) + 1 },
            releaseLock() { counters.releases = (counters.releases ?? 0) + 1 },
          }
        },
      }
    },
    cleanup() { counters.cleanups = (counters.cleanups ?? 0) + 1 },
  }
}

function documentFrom(pages: Array<ReturnType<typeof page>>) {
  return {
    numPages: pages.length,
    async getPage(number: number) { return pages[number - 1] },
  }
}

test('collects readable pages with explicit page boundaries and skips blank pages', async () => {
  const counters = {}
  const result = await collectPdfText(documentFrom([
    page([{ str: 'First', hasEOL: true }, { str: 'line' }], counters),
    page([{ str: '   ', hasEOL: true }], counters),
    page([{ str: 'Third' }], counters),
  ]))
  assert.deepEqual(result, {
    text: '[Page 1]\nFirst\nline\n\n[Page 3]\nThird',
    documentImport: { format: 'pdf', status: 'ready', pages: 3, textPages: 2 },
  })
  assert.equal(counters.cleanups, 3)
  assert.equal(counters.releases, 3)
  assert.equal(counters.cancels, undefined)
})

test('reports no-text for documents containing only blank or non-text items', async () => {
  const result = await collectPdfText(documentFrom([
    page([{ str: '', hasEOL: true }, { hasEOL: true }]),
    page([{ str: '   ' }]),
  ]))
  assert.deepEqual(result, { documentImport: { format: 'pdf', status: 'no-text', pages: 2, textPages: 0 } })
})

test('rejects invalid and over-page PDFs before reading any page', async () => {
  let reads = 0
  const invalid = await collectPdfText({ numPages: 0, async getPage() { reads += 1; throw new Error('must not read') } })
  assert.deepEqual(invalid, { documentImport: { format: 'pdf', status: 'invalid' } })
  const tooMany = await collectPdfText({ numPages: MAX_PDF_PAGES + 1, async getPage() { reads += 1; throw new Error('must not read') } })
  assert.deepEqual(tooMany, { documentImport: { format: 'pdf', status: 'page-limit' } })
  assert.equal(reads, 0)
})

test('rejects whole extracted text without returning a partial body and cleans up the limited page', async () => {
  const counters = {}
  const result = await collectPdfText(documentFrom([page([{ str: 'x'.repeat(MAX_PDF_TEXT_BYTES) }], counters)]))
  assert.deepEqual(result, { documentImport: { format: 'pdf', status: 'text-limit' } })
  assert.equal(counters.cancels, 1)
  assert.equal(counters.releases, 1)
  assert.equal(counters.cleanups, 1)
})

test('accounts UTF-8 bytes rather than JavaScript string length', async () => {
  const text = 'é'.repeat(32_000)
  assert.equal(new TextEncoder().encode(text).byteLength, 64_000)
  const result = await collectPdfText(documentFrom([page([{ str: text }])]))
  assert.equal(result.documentImport.status, 'ready')
  assert.equal(result.text, `[Page 1]\n${text}`)
})

test('a known text-limit result never waits for worker cancellation acknowledgement', { timeout: 1_000 }, async () => {
  let cancelled = 0
  let cleaned = 0
  const result = await collectPdfText({
    numPages: 1,
    getPage: async () => ({
      streamTextContent: () => new ReadableStream({
        start(controller) { controller.enqueue({ items: [{ str: 'x'.repeat(MAX_PDF_TEXT_BYTES) }] }) },
        cancel(reason) { assert.ok(reason instanceof Error); cancelled += 1; return new Promise(() => {}) },
      }),
      cleanup() { cleaned += 1 },
    }),
  })
  assert.deepEqual(result, { documentImport: { format: 'pdf', status: 'text-limit' } })
  assert.equal(cancelled, 1)
  assert.equal(cleaned, 1)
})

test('PDF filename recognition and import copy expose stable bounded outcomes', () => {
  assert.equal(isPdfFileName('report.PDF'), true)
  assert.equal(isPdfFileName('report.pdf.backup'), false)
  assert.equal(isPdfFileName('report.txt'), false)
  assert.match(pdfImportCopy({ format: 'pdf', status: 'text-limit' }), /No partial text was saved/)
  assert.match(pdfImportCopy({ format: 'pdf', status: 'page-limit' }), /100 pages or fewer/)
  assert.match(pdfImportCopy({ format: 'pdf', status: 'ready', pages: 4, textPages: 2 }), /2 of 4 pages/)
  const ocrCopy = pdfImportCopy({ format: 'pdf', status: 'ready', method: 'ocr', pages: 4, textPages: 2 })
  assert.match(ocrCopy, /On-device OCR text/)
  assert.match(ocrCopy, /2 of 4 pages/)
  assert.match(ocrCopy, /Recognition may err or omit text/)
  assert.match(ocrCopy, /reading order may differ/)
  assert.match(ocrCopy, /Images and layout are not included/)
  assert.doesNotMatch(ocrCopy, /No OCR is performed/)
  assert.equal(pdfImportCopy({ format: 'txt', status: 'ready' }), '')
  assert.equal(pdfImportCopy(), '')
})

test('optional OCR provenance preserves every legacy PDF import-copy string', () => {
  const cases = [
    [{ status: 'ready', pages: 4, textPages: 2 }, 'Extracted PDF text · 2 of 4 pages contain text. Images and layout are not included; reading order may differ. No OCR is performed.'],
    [{ status: 'no-text', pages: 4, textPages: 0 }, 'No readable PDF text was found. This may be a scan; this import does not perform OCR. Attach a text version instead.'],
    [{ status: 'file-too-large' }, 'PDF not imported. Choose a PDF up to 8 MB.'],
    [{ status: 'selection-limit' }, 'PDF not imported. Choose up to 24 MB of PDFs at a time.'],
    [{ status: 'page-limit' }, 'PDF not imported. Choose a document with 100 pages or fewer.'],
    [{ status: 'text-limit' }, 'PDF not imported. Extracted text exceeds 64 KB; split the document and reattach. No partial text was saved.'],
    [{ status: 'protected' }, 'PDF not imported. Export an unlocked copy and reattach it.'],
    [{ status: 'timeout' }, 'PDF import took too long. Try a smaller document or attach a text version.'],
    [{ status: 'invalid' }, 'PDF not imported. The document could not be read reliably; export a new copy and reattach it.'],
    [{ status: 'unavailable' }, 'PDF import is unavailable. Try again or attach a text version.'],
    [{ status: 'unknown' }, 'PDF import is unavailable. Try again or attach a text version.'],
    [{ status: '__proto__' }, 'PDF import is unavailable. Try again or attach a text version.'],
  ]
  for (const [outcome, expected] of cases) assert.equal(pdfImportCopy({ format: 'pdf', ...outcome }), expected)
})

test('validates exact PDF outcome metadata and rejects forged counters or extra keys', () => {
  assert.equal(isPdfImportOutcome({ format: 'pdf', status: 'ready', pages: 3, textPages: 2 }), true)
  assert.equal(isPdfImportOutcome({ format: 'pdf', status: 'ready', method: 'ocr', pages: 3, textPages: 2 }), true)
  assert.equal(isPdfImportOutcome({ format: 'pdf', status: 'no-text', pages: 3, textPages: 0 }), true)
  for (const value of [
    { format: 'pdf', status: 'ready', pages: 0, textPages: 1 },
    { format: 'pdf', status: 'ready', pages: 3, textPages: 0 },
    { format: 'pdf', status: 'ready', pages: 3, textPages: 4 },
    { format: 'pdf', status: 'no-text', pages: 3, textPages: 1 },
    { format: 'pdf', status: 'no-text', method: 'ocr', pages: 3, textPages: 0 },
    { format: 'pdf', status: 'ready', method: 'embedded', pages: 3, textPages: 2 },
    { format: 'pdf', status: 'invalid', method: 'ocr' },
    { format: 'pdf', status: 'ready', method: 'ocr', pages: 3 },
    { format: 'pdf', status: 'page-limit', pages: 101 },
    { format: 'pdf', status: 'ready', pages: 3, textPages: 1, text: 'forged' },
    { format: 'pdf', status: 'ready', pages: 3, textPages: 1, extra: true },
    { format: 'pdf', status: 'ready', pages: 3.5, textPages: 1 },
    { format: 'pdf', status: 'unknown', pages: 3, textPages: 1 },
    null,
    [],
  ]) assert.equal(isPdfImportOutcome(value), false)
})
