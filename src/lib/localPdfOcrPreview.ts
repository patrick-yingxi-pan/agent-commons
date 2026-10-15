import { isPdfOcrResult, snapshotPdfOcrInput } from '../../contract/pdfOcr.mjs'
import { isPdfImportOutcome } from '../../contract/pdfImport.mjs'
import { localBrowseDocumentFormat } from '../../contract/localFileBrowse.mjs'
import { recognizeDesktopPdfText } from '../api/desktopPdfOcr.ts'
import type { LocalPreviewProcessingResult } from '../controller/localFileBrowserCore.ts'
import type { LocalBrowsePreview } from './localFilePreview.ts'

type Recognize = (bytes: Uint8Array, signal: AbortSignal) => Promise<unknown>
const failure = (message: string): LocalPreviewProcessingResult<LocalBrowsePreview> => ({
  status: 'error', message: `${message} The previous preview is unchanged.`,
})

/** Recognizes one already captured PDF. This seam has no source-read, picker,
 * upload, persistence or model capability. Adoption remains an explicit Attach. */
export async function recognizeLocalPdfPreview(
  preview: LocalBrowsePreview,
  signal: AbortSignal,
  recognize: Recognize = recognizeDesktopPdfText,
): Promise<LocalPreviewProcessingResult<LocalBrowsePreview>> {
  if (signal.aborted) return { status: 'cancelled' }
  try {
    const metadata = preview.documentImport
    if (localBrowseDocumentFormat(preview.path) !== 'pdf' || !isPdfImportOutcome(metadata) ||
        metadata.method !== undefined || preview.version !== 1 ||
        !((metadata.status === 'ready' && typeof preview.snapshot.text === 'string') ||
          (metadata.status !== 'ready' && preview.snapshot.omitted === 'document-extraction'))) {
      return failure('Choose a PDF preview before recognizing scanned text.')
    }
    const input = snapshotPdfOcrInput(preview.pdfOcrInput)
    if (input.status !== 'ready' || preview.sizeBytes !== input.pdf.byteLength) {
      return failure('The captured PDF is unavailable or exceeds 8 MiB. Select the file again.')
    }
    const candidate = await recognize(input.pdf, signal)
    if (signal.aborted) return { status: 'cancelled' }
    // Reject accessors, hidden fields and mutable native references before use.
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(candidate)) ||
        !Reflect.ownKeys(candidate).every(key => {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
          return typeof key === 'string' && descriptor?.enumerable === true && 'value' in descriptor
        })) return failure('Recognition returned an invalid result. Try again.')
    const result: unknown = structuredClone(candidate)
    if (!isPdfOcrResult(result)) return failure('Recognition returned an invalid result. Try again.')
    switch (result.status) {
      case 'ready': return { status: 'ready', preview: {
        version: preview.version, path: preview.path, sizeBytes: preview.sizeBytes,
        snapshot: { text: result.text },
        documentImport: { format: 'pdf', status: 'ready', pages: result.pages, textPages: result.textPages, method: 'ocr' },
      } }
      case 'cancelled': return { status: 'cancelled' }
      case 'no-text': return failure(`No text was recognized across ${result.pages} pages. Try a clearer text version.`)
      case 'busy': return failure('Another recognition is running. Wait for it to finish, then try again.')
      case 'protected': return failure('This PDF is protected. Choose an unlocked copy.')
      case 'page-limit': return failure('This PDF exceeds the 100-page recognition limit. Choose a shorter PDF.')
      case 'too-large': return failure('This PDF exceeds recognition limits. Choose a smaller PDF up to 8 MiB.')
      case 'timeout': return failure('Recognition did not finish within 120 seconds. Try a shorter PDF.')
      case 'invalid': return failure('This PDF could not be recognized safely. Choose another PDF.')
      default: return failure('On-device PDF recognition is unavailable. Try again in the macOS desktop app.')
    }
  } catch {
    return signal.aborted ? { status: 'cancelled' } : failure('Could not recognize this PDF. Try again.')
  }
}
