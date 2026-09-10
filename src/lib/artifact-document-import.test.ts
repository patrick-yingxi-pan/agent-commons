import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import { isArtifactDocumentFileName, reviewArtifactDocumentImport } from './artifactDocumentImport.ts'

const textFile = (overrides: Record<string, unknown> = {}) => ({
  name: 'notes.txt', kind: 'file' as const, text: 'First line.\n\nSecond line.', documentImport: undefined, ...overrides,
})

test('empty selection is cancellation and one text file is ready with a markdown name', () => {
  assert.deepEqual(reviewArtifactDocumentImport([]), { status: 'cancelled' })
  assert.deepEqual(reviewArtifactDocumentImport([textFile()]), {
    status: 'ready', name: 'notes.md', text: 'First line.\n\nSecond line.',
  })
})

test('filename admission shares the local text policy and excludes structured Office/media files', () => {
  assert.equal(isArtifactDocumentFileName('README'), true)
  assert.equal(isArtifactDocumentFileName('brief.PDF'), true)
  assert.equal(isArtifactDocumentFileName('brief.DOCX'), true)
  assert.equal(isArtifactDocumentFileName('table.xlsx'), false)
  assert.equal(isArtifactDocumentFileName('deck.pptx'), false)
  assert.equal(isArtifactDocumentFileName('photo.png'), false)
})

test('basename naming replaces only the final extension and falls back when invalid', () => {
  assert.equal(reviewArtifactDocumentImport([textFile({ name: 'report.final.txt' })]).name, 'report.final.md')
  assert.equal(reviewArtifactDocumentImport([textFile({ name: '.env' })]).name, '.env.md')
  assert.equal(reviewArtifactDocumentImport([textFile({ name: `${'x'.repeat(240)}.txt` })]).name, 'imported-document.md')
})

test('rejects photos, multi-selection, unsupported formats and empty text', () => {
  assert.match(reviewArtifactDocumentImport([textFile({ kind: 'photo' })]).message, /Photos/)
  assert.match(reviewArtifactDocumentImport([textFile(), textFile({ name: 'other.txt' })]).message, /one document/)
  assert.match(reviewArtifactDocumentImport([textFile({ name: 'book.xlsx' })]).message, /text file, PDF, or DOCX/)
  assert.match(reviewArtifactDocumentImport([textFile({ text: ' \n\t' })]).message, /no readable content/)
})

test('requires complete ready PDF and DOCX snapshots', () => {
  const pdf = { name: 'brief.pdf', kind: 'file' as const, text: 'PDF body', documentImport: { format: 'pdf', status: 'ready', pages: 1, textPages: 1 } }
  const docx = { name: 'brief.docx', kind: 'file' as const, text: 'DOCX body', documentImport: { format: 'docx', status: 'ready' } }
  const pdfReady = reviewArtifactDocumentImport([pdf])
  const docxReady = reviewArtifactDocumentImport([docx])
  assert.equal(pdfReady.status, 'ready')
  assert.match(pdfReady.disclosure, /1 of 1 pages/)
  assert.equal(docxReady.status, 'ready')
  assert.match(docxReady.disclosure, /Extracted Word body text/)
  assert.match(reviewArtifactDocumentImport([{ ...pdf, documentImport: { format: 'pdf', status: 'text-limit' } }]).message, /exceeds 64 KB|complete text snapshot/i)
  assert.match(reviewArtifactDocumentImport([{ ...docx, documentImport: { format: 'docx', status: 'no-text' } }]).message, /No readable Word|complete text snapshot/i)
  assert.match(reviewArtifactDocumentImport([{ ...pdf, documentImport: { format: 'docx', status: 'ready' } }]).message, /complete text snapshot/i)
  assert.match(reviewArtifactDocumentImport([{ ...pdf, text: undefined }]).message, /complete text snapshot|readable document/i)
  assert.match(reviewArtifactDocumentImport([{ ...pdf, documentImport: { format: 'pdf', status: 'ready' } }]).message, /complete text snapshot|readable document/i)
  assert.match(reviewArtifactDocumentImport([{ ...pdf, documentImport: { format: 'pdf', status: 'wat' } }]).message, /complete text snapshot/i)
  assert.doesNotMatch(reviewArtifactDocumentImport([{ ...pdf, documentImport: { format: 'pdf', status: 'text-limit' } }]).message, /attach|reattach/i)
})

test('rejects oversized source before any authoring clamp', () => {
  const maximum = 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)
  assert.equal(reviewArtifactDocumentImport([textFile({ text: maximum })]).status, 'ready')
  const text = 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS + 1)
  const result = reviewArtifactDocumentImport([textFile({ text })])
  assert.equal(result.status, 'error')
  assert.match(result.message, /authoring limit/)
})

test('preserves extracted text exactly for preview', () => {
  const text = '  leading\nwrapped\r\ntrailing  '
  assert.deepEqual(reviewArtifactDocumentImport([textFile({ name: 'readme.md', text })]), {
    status: 'ready', name: 'readme.md', text,
  })
})
