import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLocalFolderFileListing, parseLocalFolderFilePreview } from './localFolderBrowse.mjs'
import { parseLocalGitFileListing, parseLocalGitFilePreview } from './localGitBrowse.mjs'
import { MAX_PDF_FILE_BYTES } from './pdfImport.mjs'
import { MAX_DOCX_FILE_BYTES } from './docxImport.mjs'
import { MAX_XLSX_FILE_BYTES } from './xlsxImport.mjs'
import { MAX_PPTX_FILE_BYTES } from './pptxImport.mjs'

const formats = [['pdf', MAX_PDF_FILE_BYTES], ['docx', MAX_DOCX_FILE_BYTES],
  ['xlsx', MAX_XLSX_FILE_BYTES], ['pptx', MAX_PPTX_FILE_BYTES]] as const
const parsers = [parseLocalFolderFilePreview, parseLocalGitFilePreview]
const preview = (format = 'pdf', bytes = new Uint8Array([0, 255, 1])) => ({
  version: 1, path: `nested/selected.${format}`, sizeBytes: bytes.byteLength,
  snapshot: { document: { format, bytes } },
})

test('folder and Git listings admit only the four supported document suffixes as readable candidates', () => {
  const files = formats.map(([format]) => ({ path: `selected.${format.toUpperCase()}`, kind: 'file' })).sort((a, b) => a.path.localeCompare(b.path))
  assert.deepEqual(parseLocalFolderFileListing({ version: 1, visited: 4, hiddenCount: 0, directoryCount: 0, files })?.files, files)
  assert.deepEqual(parseLocalGitFileListing({ version: 1, excludedCount: 0, files })?.files, files)
  for (const extension of ['doc', 'xls', 'ppt', 'docm', 'xlsm', 'pptm', 'png', 'zip']) {
    const unsupported = [{ path: `selected.${extension}`, kind: 'file' }]
    assert.equal(parseLocalFolderFileListing({ version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: unsupported }), undefined)
    assert.equal(parseLocalGitFileListing({ version: 1, excludedCount: 0, files: unsupported }), undefined)
  }
})

test('selected document transport detaches exact bytes without declaring extraction success', () => {
  for (const parser of parsers) for (const [format] of formats) {
    const value = preview(format)
    const parsed = parser(value)
    assert.deepEqual(parsed, value)
    assert.notStrictEqual(parsed?.snapshot.document.bytes, value.snapshot.document.bytes)
    value.snapshot.document.bytes[0] = 99
    assert.equal(parsed?.snapshot.document.bytes[0], 0)
    assert.equal(Object.hasOwn(parsed!.snapshot, 'text'), false)
    assert.equal(Object.hasOwn(parsed!.snapshot.document, 'status'), false)
  }
})

test('document transport uses each format raw-byte cap rather than the text cap', () => {
  for (const parser of parsers) for (const [format, cap] of formats) {
    assert.equal(parser(preview(format, new Uint8Array(65537)))?.sizeBytes, 65537)
    assert.equal(parser(preview(format, new Uint8Array(cap)))?.sizeBytes, cap)
    assert.equal(parser(preview(format, new Uint8Array(cap + 1))), undefined)
    assert.equal(parser({ ...preview(format), sizeBytes: cap, snapshot: { omitted: 'too-large' } }), undefined)
    assert.deepEqual(parser({ ...preview(format), sizeBytes: cap + 1, snapshot: { omitted: 'too-large' } })?.snapshot, { omitted: 'too-large' })
  }
})

test('document transport refuses mismatched suffix, size, records and byte-array impostors without invoking accessors', () => {
  let calls = 0
  const value = preview()
  const bytesGetter = Object.defineProperty(new Uint8Array([1, 2, 3]), 'byteLength', { get() { calls++; return 3 } })
  const bufferGetter = Object.defineProperty(new Uint8Array([1, 2, 3]), 'buffer', { get() { calls++; return new ArrayBuffer(3) } })
  const invalidBytes = [Array(3), [0, 255, 1], new DataView(new ArrayBuffer(3)), new Uint16Array(3), Buffer.from([0, 255, 1]),
    Object.create(Uint8Array.prototype), new (class extends Uint8Array {})(3), bytesGetter, bufferGetter,
    new Uint8Array(new SharedArrayBuffer(3)), new Uint8Array(new ArrayBuffer(3, { maxByteLength: 6 }))]
  for (const parser of parsers) {
    for (const invalid of [
      { ...value, sizeBytes: 2 }, { ...value, path: 'selected.docx' }, { ...value, path: 'selected.txt' },
      { ...value, snapshot: { document: { ...value.snapshot.document, status: 'ready' } } },
      { ...value, snapshot: { document: { ...value.snapshot.document, path: '/private' } } },
      { ...value, snapshot: { document: { ...value.snapshot.document, format: 'doc' } } },
      { ...value, snapshot: { document: Object.assign(Object.create({ inherited: true }), value.snapshot.document) } },
      { ...value, snapshot: { document: { get format() { calls++; return 'pdf' }, bytes: value.snapshot.document.bytes } } },
      { ...value, snapshot: { get document() { calls++; return value.snapshot.document } } },
      { ...value, snapshot: { document: { ...value.snapshot.document, [Symbol('extra')]: true } } },
      ...invalidBytes.map(bytes => ({ ...value, snapshot: { document: { format: 'pdf', bytes } } })),
    ]) assert.equal(parser(invalid), undefined)
  }
  assert.equal(calls, 0)
})
