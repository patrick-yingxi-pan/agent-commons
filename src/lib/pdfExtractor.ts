import { getDocument, PDFWorker, VerbosityLevel } from 'pdfjs-dist'
import ParserWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { collectPdfText, pdfImportFailure, type PdfImportResult } from '../../contract/pdfImport.mjs'

/** Never grant a document URLs, filesystem, scripting, or a fake/main-thread
 * parser. The only worker input is user-selected bytes; all auxiliary fetching
 * is refused, and timeout terminates the actual parsing worker. */
class NoExternalData {
  async fetch(): Promise<never> { throw new Error('External PDF data is unavailable.') }
}

export async function extractPdf(bytes: Uint8Array, timeoutMs: number, signal?: AbortSignal): Promise<PdfImportResult> {
  if (signal?.aborted) return pdfImportFailure('unavailable')
  let port: Worker | undefined
  let worker: PDFWorker | undefined
  let loading: ReturnType<typeof getDocument> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    port = new ParserWorker()
    worker = PDFWorker.create({ port, verbosity: VerbosityLevel.ERRORS })
    loading = getDocument({
      data: bytes, worker, verbosity: VerbosityLevel.ERRORS,
      stopAtErrors: true, useWorkerFetch: false, BinaryDataFactory: NoExternalData,
      useWasm: false, useSystemFonts: false, disableFontFace: true,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      enableXfa: false, maxImageSize: 0, disableAutoFetch: true,
    })
    return await Promise.race([
      loading.promise.then((document) => collectPdfText(document)),
      new Promise<PdfImportResult>((resolve) => {
        abort = () => { port?.terminate(); resolve(pdfImportFailure('unavailable')) }
        signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => {
          port?.terminate()
          resolve(pdfImportFailure('timeout'))
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    return pdfImportFailure(error instanceof Error && error.name === 'PasswordException' ? 'protected' : loading ? 'invalid' : 'unavailable')
  } finally {
    clearTimeout(timer)
    if (abort) signal?.removeEventListener('abort', abort)
    // A terminated/hung parser cannot be trusted to acknowledge destroy.
    void loading?.destroy().catch(() => {})
    worker?.destroy()
    port?.terminate()
  }
}
