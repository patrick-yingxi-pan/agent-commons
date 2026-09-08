/** PDF intake policy shared by native selection and the browser extractor.
 * Raw PDF bytes are transient. Only bounded extracted text and this path-free
 * outcome can enter a conversation; partial text is never reported as complete. */
export const MAX_PDF_FILE_BYTES = 8 * 1024 * 1024
export const MAX_PDF_SELECTION_BYTES = 24 * 1024 * 1024
export const MAX_PDF_PAGES = 100
export const MAX_PDF_TEXT_BYTES = 64 * 1024
export const PDF_IMPORT_TIMEOUT_MS = 15_000

export const isPdfFileName = (name) => typeof name === 'string' && /\.pdf$/i.test(name)
export const pdfImportFailure = (status) => ({ documentImport: { format: 'pdf', status } })

/** Stream page text rather than materializing an unbounded whole-document
 * result. Page boundaries are explicit; figures, layout and OCR are not inferred. */
export async function collectPdfText(document) {
  const pages = document.numPages
  if (!Number.isSafeInteger(pages) || pages < 1) return pdfImportFailure('invalid')
  if (pages > MAX_PDF_PAGES) return pdfImportFailure('page-limit')
  const encoder = new TextEncoder()
  const parts = []
  let used = 0
  let textPages = 0
  for (let number = 1; number <= pages; number += 1) {
    const page = await document.getPage(number)
    let reader
    const pageParts = []
    try {
      reader = page.streamTextContent().getReader()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        for (const item of chunk.value.items) {
          if (typeof item.str !== 'string') continue
          const text = item.str + (item.hasEOL ? '\n' : ' ')
          const bytes = text.length > MAX_PDF_TEXT_BYTES ? Infinity : encoder.encode(text).byteLength
          if (used + bytes > MAX_PDF_TEXT_BYTES) {
            // The result is already known. A worker may never acknowledge a
            // cancelled stream; its owner terminates it when this returns.
            void reader.cancel(new Error('PDF extracted-text limit exceeded.')).catch(() => {})
            return pdfImportFailure('text-limit')
          }
          used += bytes
          pageParts.push(text)
        }
      }
    } finally {
      reader?.releaseLock()
      page.cleanup()
    }
    const body = pageParts.join('').trim()
    if (body) {
      textPages += 1
      const heading = `[Page ${number}]\n`
      used += encoder.encode(heading + '\n\n').byteLength
      if (used > MAX_PDF_TEXT_BYTES) return pdfImportFailure('text-limit')
      parts.push(heading + body)
    }
  }
  const documentImport = { format: 'pdf', status: textPages ? 'ready' : 'no-text', pages, textPages }
  return textPages ? { text: parts.join('\n\n'), documentImport } : { documentImport }
}

export function pdfImportCopy(outcome) {
  if (!outcome || outcome.format !== 'pdf') return ''
  switch (outcome.status) {
    case 'ready': return `Extracted PDF text · ${outcome.textPages} of ${outcome.pages} pages contain text. Images and layout are not included; reading order may differ. No OCR is performed.`
    case 'no-text': return 'No readable PDF text was found. This may be a scan; OCR is not available. Attach a text version instead.'
    case 'file-too-large': return 'PDF not imported. Choose a PDF up to 8 MB.'
    case 'selection-limit': return 'PDF not imported. Choose up to 24 MB of PDFs at a time.'
    case 'page-limit': return 'PDF not imported. Choose a document with 100 pages or fewer.'
    case 'text-limit': return 'PDF not imported. Extracted text exceeds 64 KB; split the document and reattach. No partial text was saved.'
    case 'protected': return 'PDF not imported. Export an unlocked copy and reattach it.'
    case 'timeout': return 'PDF import took too long. Try a smaller document or attach a text version.'
    case 'invalid': return 'PDF not imported. The document could not be read reliably; export a new copy and reattach it.'
    default: return 'PDF import is unavailable. Try again or attach a text version.'
  }
}

export function isPdfImportOutcome(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'pdf') return false
  if (!['ready', 'no-text', 'file-too-large', 'selection-limit', 'page-limit', 'text-limit', 'protected', 'timeout', 'invalid', 'unavailable'].includes(value.status)) return false
  if (Object.keys(value).some((key) => !['format', 'status', 'pages', 'textPages'].includes(key))) return false
  if (value.status === 'ready' || value.status === 'no-text') {
    return Number.isSafeInteger(value.pages) && value.pages >= 1 && value.pages <= MAX_PDF_PAGES &&
      Number.isSafeInteger(value.textPages) && value.textPages <= value.pages &&
      (value.status === 'ready' ? value.textPages >= 1 : value.textPages === 0)
  }
  return value.pages === undefined && value.textPages === undefined
}
