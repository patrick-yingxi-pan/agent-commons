import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import { localPreviewDocumentImport } from './localPreviewDocumentImport.ts'
import type { LocalBrowsePreview } from './localFilePreview.ts'

const preview = (path: string, text: string, documentImport?: LocalBrowsePreview['documentImport']): LocalBrowsePreview => ({
  version: 1, path, sizeBytes: new TextEncoder().encode(text).byteLength,
  snapshot: { text }, ...(documentImport && { documentImport }),
})

test('nested connected text paths use leaf admission but preserve every reviewed character', () => {
  for (const path of ['notes/draft.txt', 'src/nested/main.ts', 'docs/README']) {
    const input = preview(path, '\ufeffFirst line\r\n\r\nSecond   paragraph')
    const result = localPreviewDocumentImport(input)
    assert.equal(result?.status, 'ready', path)
    if (result?.status !== 'ready') throw new Error(`Not admitted: ${path}`)
    assert.equal(result.text, input.snapshot.text)
    assert.equal(result.name, path.endsWith('README') ? 'README.md' : path.endsWith('main.ts') ? 'main.md' : 'draft.md')
    assert.equal(input.path, path)
    assert.deepEqual(Object.keys(result).sort(), ['name', 'status', 'text'])
  }
})

test('connected document adoption preserves complete fidelity and excludes raw PDF bytes', () => {
  const input = { ...preview('research/scan.pdf', '[Page 1]\nExact OCR text', { format: 'pdf', status: 'ready', method: 'ocr', pages: 1, textPages: 1 }), pdfOcrInput: new Uint8Array([1, 2, 3]) }
  const result = localPreviewDocumentImport(input)
  assert.equal(result?.status, 'ready')
  assert.match(result?.disclosure ?? '', /OCR|recogniz/i)
  assert.deepEqual(Object.keys(result!).sort(), ['disclosure', 'name', 'status', 'text'])
  assert.equal(localPreviewDocumentImport(preview('docs/draft.docx', 'Word text', { format: 'docx', status: 'ready' }))?.status, 'ready')
  assert.equal(localPreviewDocumentImport(preview('docs/draft.pdf', 'Partial', { format: 'pdf', status: 'text-limit' }))?.status, 'error')
})

test('connected draft admission refuses empty and oversized text without clipping or flattening other formats', () => {
  assert.equal(localPreviewDocumentImport(null), null)
  assert.equal(localPreviewDocumentImport(preview('notes/empty.md', ' \n\t'))?.status, 'error')
  assert.equal(localPreviewDocumentImport(preview('notes/full.md', 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)))?.status, 'ready')
  assert.equal(localPreviewDocumentImport(preview('notes/large.md', 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS + 1)))?.status, 'error')
  for (const path of ['data/book.xlsx', 'deck/slides.pptx', 'images/photo.png', 'other/archive.zip']) {
    assert.equal(localPreviewDocumentImport(preview(path, 'This is not a document import.')), null, path)
  }
  assert.equal(localPreviewDocumentImport({ version: 1, path: 'docs/missing.md', sizeBytes: 0, snapshot: { omitted: 'unreadable' } }), null)
})
