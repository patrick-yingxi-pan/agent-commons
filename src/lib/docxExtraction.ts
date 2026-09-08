import { ZipReader, Uint8ArrayReader, type FileEntry } from '@zip.js/zip.js/lib/zip-core-custom.js'
import { docxMainPart, assertDocxContentType, docxBodyText, DocxExtractionError } from './docxText.ts'
import {
  MAX_DOCX_FILE_BYTES, MAX_DOCX_ENTRIES, MAX_DOCX_PART_BYTES, MAX_DOCX_EXPANDED_BYTES,
  docxImportFailure, type DocxImportResult,
} from '../../contract/docxImport.mjs'

function decodeXml(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0
    ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c ? 'utf-16be' : 'utf-8'
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) } catch { throw new DocxExtractionError('invalid') }
}

/** Actual output bytes, not trusted ZIP size fields, bound memory allocation.
 * ZIP syntax, CRC, local/central agreement and overlap checks belong to zip.js. */
async function readPart(entry: FileEntry, budget: { used: number }): Promise<string> {
  if (entry.uncompressedSize > MAX_DOCX_PART_BYTES) throw new DocxExtractionError('structure-limit')
  const chunks: Uint8Array[] = []
  let used = 0
  await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
    used += chunk.byteLength
    budget.used += chunk.byteLength
    if (used > MAX_DOCX_PART_BYTES || budget.used > MAX_DOCX_EXPANDED_BYTES) throw new DocxExtractionError('structure-limit')
    chunks.push(chunk)
  } }), { checkCrc32: true, checkOverlappingEntry: true, strictness: 'strict', useWebWorkers: false, useCompressionStream: true })
  if (used !== entry.uncompressedSize) throw new DocxExtractionError('invalid')
  const bytes = new Uint8Array(used)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return decodeXml(bytes)
}

/** Imported only by the dedicated renderer worker (and direct Node tests).
 * The custom ZIP entry has no fallback worker/WASM assets. We accept only ZIP
 * store/deflate with the browser's native bounded streaming codec; no document
 * path, URL, relationship, image, macro or embedded object is ever executed. */
export async function extractDocx(bytes: Uint8Array): Promise<DocxImportResult> {
  if (bytes.byteLength > MAX_DOCX_FILE_BYTES) return docxImportFailure('file-too-large')
  // Encrypted modern Office files and old binary .doc share this compound
  // container. Do not guess which it is or prompt for a reusable password.
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value)) return docxImportFailure('unsupported')
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { strictness: 'strict', useWebWorkers: false, useCompressionStream: true })
  try {
    const entries = new Map<string, FileEntry>()
    let count = 0
    let declared = 0
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > MAX_DOCX_ENTRIES) throw new DocxExtractionError('structure-limit')
      if (entry.encrypted || ![0, 8].includes(entry.compressionMethod)) throw new DocxExtractionError('unsupported')
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new DocxExtractionError('invalid')
      declared += entry.uncompressedSize
      if (declared > MAX_DOCX_EXPANDED_BYTES) throw new DocxExtractionError('structure-limit')
      if (!entry.directory) entries.set(entry.filename, entry)
    }
    const budget = { used: 0 }
    const part = async (name: string) => {
      const entry = entries.get(name)
      if (!entry) throw new DocxExtractionError('invalid')
      return readPart(entry, budget)
    }
    const main = docxMainPart(await part('_rels/.rels'))
    assertDocxContentType(await part('[Content_Types].xml'), main)
    const text = docxBodyText(await part(main))
    return text.trim() ? { text, documentImport: { format: 'docx', status: 'ready' } } : { documentImport: { format: 'docx', status: 'no-text' } }
  } catch (error) {
    return docxImportFailure(error instanceof DocxExtractionError ? error.status : 'invalid')
  } finally { await reader.close() }
}
