import {
  MAX_PDF_FILE_BYTES, MAX_PDF_SELECTION_BYTES, PDF_IMPORT_TIMEOUT_MS, pdfImportFailure, type PdfImportResult,
} from '../../contract/pdfImport.mjs'

/** The parser graph is never on the cold app path. Intake is serial across
 * callers so many dropped PDFs cannot create an unbounded worker pool. */
let tail: Promise<unknown> = Promise.resolve()
let queuedBytes = 0
export function importPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfImportResult> {
  if (bytes.byteLength > MAX_PDF_FILE_BYTES) return Promise.resolve(pdfImportFailure('file-too-large'))
  if (queuedBytes + bytes.byteLength > MAX_PDF_SELECTION_BYTES) return Promise.resolve(pdfImportFailure('selection-limit'))
  const size = bytes.byteLength
  queuedBytes += size
  const run = tail.then(async () => {
    if (signal?.aborted) return pdfImportFailure('unavailable')
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    let cancel: (() => void) | undefined
    try {
      return await Promise.race([
        import('./pdfExtractor').then(({ extractPdf }) => controller.signal.aborted
          ? pdfImportFailure('unavailable') : extractPdf(bytes, PDF_IMPORT_TIMEOUT_MS, controller.signal)),
        new Promise<PdfImportResult>((resolve) => {
          cancel = () => { resolve(pdfImportFailure('unavailable')); controller.abort() }
          signal?.addEventListener('abort', cancel, { once: true })
          timer = setTimeout(() => {
            resolve(pdfImportFailure('timeout'))
            controller.abort()
          }, PDF_IMPORT_TIMEOUT_MS * 2)
        }),
      ])
    } catch {
      return pdfImportFailure('unavailable')
    } finally {
      clearTimeout(timer)
      if (cancel) signal?.removeEventListener('abort', cancel)
    }
  }).finally(() => { queuedBytes -= size })
  tail = run.catch(() => {})
  return run
}
