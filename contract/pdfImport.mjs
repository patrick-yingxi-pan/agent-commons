/** PDF intake policy shared by native selection and the browser extractor.
 * Raw PDF bytes are transient. Only bounded extracted text and this path-free
 * outcome can enter a conversation; partial text is never reported as complete. */
export const MAX_PDF_FILE_BYTES = 8 * 1024 * 1024
export const MAX_PDF_SELECTION_BYTES = 24 * 1024 * 1024
export const MAX_PDF_PAGES = 100
export const MAX_PDF_TEXT_BYTES = 64 * 1024
export const PDF_IMPORT_TIMEOUT_MS = 15_000
const PDF_IMPORT_FAILURE_COPY = {
  'file-too-large': 'Choose a PDF up to 8 MB.',
  'selection-limit': 'Choose up to 24 MB of PDFs at a time.',
  'page-limit': 'Choose a document with 100 pages or fewer.',
  'text-limit': 'Extracted text exceeds 64 KB; split the document and reattach. No partial text was saved.',
  protected: 'Export an unlocked copy and reattach it.',
  timeout: 'PDF import took too long. Try a smaller document or attach a text version.',
  invalid: 'The document could not be read reliably; export a new copy and reattach it.',
  unavailable: 'PDF import is unavailable. Try again or attach a text version.',
}

export const isPdfFileName = (name) => typeof name === 'string' && /\.pdf$/i.test(name)
export const pdfImportFailure = (status) => ({ documentImport: { format: 'pdf', status } })

export function pdfImportCopy(outcome) {
  if (!outcome || outcome.format !== 'pdf') return ''
  if (outcome.status === 'ready') {
    const disclosure = 'Images and layout are not included; reading order may differ.'
    return outcome.method === 'ocr'
      ? `On-device OCR text · ${outcome.textPages} of ${outcome.pages} pages contain recognized text. Recognition may err or omit text. ${disclosure}`
      : `Extracted PDF text · ${outcome.textPages} of ${outcome.pages} pages contain text. ${disclosure} No OCR is performed.`
  }
  if (outcome.status === 'no-text') return 'No readable PDF text was found. This may be a scan; this import does not perform OCR. Attach a text version instead.'
  const copy = typeof outcome.status === 'string' && Object.hasOwn(PDF_IMPORT_FAILURE_COPY, outcome.status)
    ? PDF_IMPORT_FAILURE_COPY[outcome.status] : undefined
  if (copy === undefined) return PDF_IMPORT_FAILURE_COPY.unavailable
  return outcome.status === 'timeout' || outcome.status === 'unavailable' ? copy : `PDF not imported. ${copy}`
}

export function isPdfImportOutcome(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'pdf') return false
  if (value.status !== 'ready' && value.status !== 'no-text' &&
      (typeof value.status !== 'string' || !Object.hasOwn(PDF_IMPORT_FAILURE_COPY, value.status))) return false
  if (Object.keys(value).some((key) => !['format', 'status', 'pages', 'textPages', 'method'].includes(key))) return false
  if (value.method !== undefined && (value.method !== 'ocr' || value.status !== 'ready')) return false
  if (value.status === 'ready' || value.status === 'no-text') {
    return Number.isSafeInteger(value.pages) && value.pages >= 1 && value.pages <= MAX_PDF_PAGES &&
      Number.isSafeInteger(value.textPages) && value.textPages <= value.pages &&
      (value.status === 'ready' ? value.textPages >= 1 : value.textPages === 0)
  }
  return value.pages === undefined && value.textPages === undefined
}
