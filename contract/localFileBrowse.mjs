import { decodeLocalTextPreview, isLocalTextFileName } from './localTextFile.mjs'
import { isPdfFileName, MAX_PDF_FILE_BYTES } from './pdfImport.mjs'
import { isDocxFileName, MAX_DOCX_FILE_BYTES } from './docxImport.mjs'
import { isXlsxFileName, MAX_XLSX_FILE_BYTES } from './xlsxImport.mjs'
import { isPptxFileName, MAX_PPTX_FILE_BYTES } from './pptxImport.mjs'

export const MAX_LOCAL_BROWSE_TEXT_BYTES = 64 * 1024
const documents = [
  ['pdf', isPdfFileName, MAX_PDF_FILE_BYTES], ['docx', isDocxFileName, MAX_DOCX_FILE_BYTES],
  ['xlsx', isXlsxFileName, MAX_XLSX_FILE_BYTES], ['pptx', isPptxFileName, MAX_PPTX_FILE_BYTES],
]
const encoder = new TextEncoder()
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get
const resizableOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get
const copyBytes = Uint8Array.prototype.set

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
  for (const key in value) if (!Object.hasOwn(value, key)) return undefined
  const result = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
    result[key] = descriptor.value
  }
  return result
}

export function localBrowseDocumentFormat(name) {
  return documents.find(([, matches]) => matches(name))?.[0]
}

export function isLocalBrowseFileName(name) {
  return isLocalTextFileName(name) || localBrowseDocumentFormat(name) !== undefined
}

/** The byte budget is for one explicit selection, never a directory body scan. */
export function localBrowseFileByteLimit(name) {
  return documents.find(([, matches]) => matches(name))?.[2] ?? MAX_LOCAL_BROWSE_TEXT_BYTES
}

function detachedDocumentBytes(value, sizeBytes, limit) {
  if (!value || Object.getPrototypeOf(value) !== Uint8Array.prototype ||
    ['buffer', 'byteLength', 'byteOffset', 'length'].some(key => Object.hasOwn(value, key)) ||
    Object.getOwnPropertySymbols(value).length !== 0) return undefined
  // Intrinsic accessors reject proxies and forged prototypes without running
  // caller getters or iterators. Do not enumerate millions of byte-index keys.
  const length = byteLengthOf.call(value)
  const buffer = bufferOf.call(value)
  if (length !== sizeBytes || length > limit || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    resizableOf?.call(buffer)) return undefined
  const detached = new Uint8Array(length)
  copyBytes.call(detached, value)
  return detached
}

/** Validate transport only. Document extraction and ready/refusal outcomes
 * belong to the renderer; even empty or malformed document bytes remain raw. */
export function parseLocalBrowseFileSnapshot(path, sizeBytes, value) {
  try {
    if (typeof path !== 'string' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return undefined
    const name = path.slice(path.lastIndexOf('/') + 1)
    const text = record(value, ['text'])
    if (text) {
      if (!isLocalTextFileName(name) || typeof text.text !== 'string' || text.text.length > MAX_LOCAL_BROWSE_TEXT_BYTES) return undefined
      const bytes = encoder.encode(text.text)
      if (bytes.byteLength !== sizeBytes || bytes.byteLength > MAX_LOCAL_BROWSE_TEXT_BYTES || decodeLocalTextPreview(bytes) !== text.text) return undefined
      return { text: text.text }
    }
    const raw = record(value, ['document'])
    if (raw) {
      const document = record(raw.document, ['format', 'bytes'])
      const format = localBrowseDocumentFormat(name)
      if (!format || !document || document.format !== format) return undefined
      const bytes = detachedDocumentBytes(document.bytes, sizeBytes, localBrowseFileByteLimit(name))
      return bytes ? { document: { format, bytes } } : undefined
    }
    const omission = record(value, ['omitted'])
    if (!omission || !['unsupported', 'too-large', 'unreadable'].includes(omission.omitted) ||
      (omission.omitted === 'too-large' && sizeBytes <= localBrowseFileByteLimit(name))) return undefined
    return { omitted: omission.omitted }
  } catch { return undefined }
}

/** Native readers share name admission and whole-text decoding; no document
 * parser or implied extraction result enters the privileged host. */
export function localBrowseSnapshotFromBytes(path, sizeBytes, bytes) {
  const format = localBrowseDocumentFormat(path)
  if (format) return parseLocalBrowseFileSnapshot(path, sizeBytes, { document: { format, bytes } })
  const text = decodeLocalTextPreview(bytes)
  return parseLocalBrowseFileSnapshot(path, sizeBytes, text === undefined ? { omitted: 'unsupported' } : { text })
}
