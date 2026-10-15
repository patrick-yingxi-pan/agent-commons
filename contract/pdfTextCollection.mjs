import { MAX_PDF_PAGES, MAX_PDF_TEXT_BYTES, pdfImportFailure } from './pdfImport.mjs'

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
