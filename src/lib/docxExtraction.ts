import { readOfficePackage, OfficeExtractionError } from './officePackage.ts'
import { docxMainPart, assertDocxContentType, docxBodyText } from './docxText.ts'
import {
  MAX_DOCX_FILE_BYTES, MAX_DOCX_ENTRIES, MAX_DOCX_PART_BYTES, MAX_DOCX_EXPANDED_BYTES,
  docxImportFailure, type DocxImportResult,
} from '../../contract/docxImport.mjs'

/** Imported only by the dedicated renderer worker (and direct Node tests).
 * The shared package reader has no fallback worker/WASM assets. We accept only
 * bounded ZIP store/deflate content; no document path, URL, relationship,
 * image, macro or embedded object is ever executed. */
export async function extractDocx(bytes: Uint8Array): Promise<DocxImportResult> {
  if (bytes.byteLength > MAX_DOCX_FILE_BYTES) return docxImportFailure('file-too-large')
  let officePackage
  try {
    officePackage = await readOfficePackage(bytes, {
      maxEntries: MAX_DOCX_ENTRIES,
      maxPartBytes: MAX_DOCX_PART_BYTES,
      maxExpandedBytes: MAX_DOCX_EXPANDED_BYTES,
    })
  } catch (error) {
    return docxImportFailure(error instanceof OfficeExtractionError ? error.status : 'invalid')
  }
  try {
    const main = docxMainPart(await officePackage.readPart('_rels/.rels'))
    assertDocxContentType(await officePackage.readPart('[Content_Types].xml'), main)
    const text = docxBodyText(await officePackage.readPart(main))
    return text.trim() ? { text, documentImport: { format: 'docx', status: 'ready' } } : { documentImport: { format: 'docx', status: 'no-text' } }
  } catch (error) {
    return docxImportFailure(error instanceof OfficeExtractionError ? error.status : 'invalid')
  } finally { await officePackage.close() }
}
