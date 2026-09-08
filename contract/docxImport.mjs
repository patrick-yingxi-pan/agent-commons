/** Word text intake policy. Original archive bytes and package paths are
 * transient; only bounded body text and this outcome may be persisted. */
export const MAX_DOCX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_DOCX_SELECTION_BYTES = 24 * 1024 * 1024
export const MAX_DOCX_TEXT_BYTES = 64 * 1024
export const MAX_DOCX_ENTRIES = 512
export const MAX_DOCX_PART_BYTES = 4 * 1024 * 1024
export const MAX_DOCX_EXPANDED_BYTES = 16 * 1024 * 1024
export const DOCX_IMPORT_TIMEOUT_MS = 15_000

export const isDocxFileName = (name) => typeof name === 'string' && /\.docx$/i.test(name)
export const docxImportFailure = (status) => ({ documentImport: { format: 'docx', status } })

const statuses = ['ready', 'no-text', 'file-too-large', 'selection-limit', 'text-limit', 'structure-limit', 'unsupported', 'timeout', 'invalid', 'unavailable']
export function isDocxImportOutcome(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && Object.hasOwn(value, 'format') && Object.hasOwn(value, 'status') &&
    value.format === 'docx' && statuses.includes(value.status)
}

export function docxImportCopy(outcome) {
  if (!outcome || outcome.format !== 'docx') return ''
  switch (outcome.status) {
    case 'ready': return 'Extracted Word body text, including table cells. Formatting, images, headers, footers, notes, comments and revision history are not included.'
    case 'no-text': return 'No readable Word body text was found. Images are not read; attach a text version instead.'
    case 'file-too-large': return 'Word document not imported. Choose a .docx file up to 8 MB.'
    case 'selection-limit': return 'Word document not imported. Choose up to 24 MB of documents at a time.'
    case 'text-limit': return 'Word document not imported. Extracted text exceeds 64 KB; split the document and reattach. No partial text was saved.'
    case 'structure-limit': return 'Word document not imported. Its expanded content or structure exceeds the import limits. Export a simpler document or attach a text version.'
    case 'unsupported': return 'Word document not imported. Save an unlocked .docx copy and reattach it; older Word files and macro-enabled documents are not supported.'
    case 'timeout': return 'Word import took too long. Try a smaller document or attach a text version.'
    case 'invalid': return 'Word document not imported. The document could not be read reliably; export a new copy and reattach it.'
    default: return 'Word import is unavailable. Try again or attach a text version.'
  }
}
