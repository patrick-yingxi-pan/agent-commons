import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import { isPdfFileName } from '../../contract/pdfImport.mjs'
import type { PdfOcrResult } from '../../contract/pdfOcr.mjs'
import { recognizeDesktopPdfText } from '../api/desktopPdfOcr.ts'
import { importedDocumentName, type ArtifactDocumentImportResult } from './artifactDocumentImport.ts'
import type { UiHostFile } from './uiHostFs.ts'

const failures: Record<Exclude<PdfOcrResult['status'], 'ready' | 'no-text' | 'cancelled'>, string> = {
  invalid: 'The PDF could not be read. Choose another PDF.',
  'too-large': 'The PDF or recognized text exceeds the extraction limit. Choose a PDF up to 8 MB with less text.',
  'page-limit': 'This PDF has more than 100 pages. Choose a shorter PDF.',
  protected: 'This PDF is password-protected or restricted. Choose an unprotected PDF.',
  unavailable: 'On-device PDF text extraction is unavailable. Try again or type the text yourself.',
  busy: 'PDF text extraction is already busy on this Mac. Wait for it to finish, then try again.',
  timeout: 'PDF text extraction took too long. Try a smaller PDF.',
}

/** Native OCR receives only a selected, bounded PDF byte snapshot. Raw PDF
 * bytes are discarded after recognition; this path cannot upload or save. */
export async function reviewArtifactPdfOcrImport(
  files: readonly Pick<UiHostFile, 'name' | 'kind' | 'pdfOcrInput' | 'pdfOcrFailure'>[],
  signal: AbortSignal,
  recognize = recognizeDesktopPdfText,
): Promise<ArtifactDocumentImportResult> {
  if (signal.aborted || files.length === 0) return { status: 'cancelled' }
  if (files.length !== 1) return { status: 'error', message: 'Choose one PDF to extract text. Your draft is unchanged.' }
  const file = files[0]
  if (file.kind !== 'file' || !isPdfFileName(file.name)) {
    return { status: 'error', message: 'Choose one supported PDF to extract text. Your draft is unchanged.' }
  }
  if (file.pdfOcrFailure) return { status: 'error', message: `${failures[file.pdfOcrFailure]} Your draft is unchanged.` }
  if (!(file.pdfOcrInput instanceof Uint8Array)) return { status: 'error', message: 'The selected PDF could not be read. Your draft is unchanged.' }
  const result = await recognize(file.pdfOcrInput, signal)
  if (signal.aborted || result.status === 'cancelled') return { status: 'cancelled' }
  if (result.status === 'no-text') {
    return { status: 'error', message: `No readable text was recognized on any of the ${result.pages} PDF pages. Your draft is unchanged.` }
  }
  if (result.status !== 'ready') return { status: 'error', message: `${failures[result.status]} Your draft is unchanged.` }
  if (result.text.length > MAX_AUTHORED_DOCUMENT_SOURCE_CHARS) {
    return { status: 'error', message: `Recognized text exceeds the ${MAX_AUTHORED_DOCUMENT_SOURCE_CHARS.toLocaleString()} character authoring limit. Nothing was truncated; your draft is unchanged.` }
  }
  return {
    status: 'ready', name: importedDocumentName(file.name), text: result.text,
    disclosure: `All ${result.pages} PDF pages were processed on this Mac; text was recognized on ${result.textPages} pages. Check page order, omissions and recognition errors. Pages are rendered at up to 2,000 pixels per edge for recognition; formatting and layout are not preserved. The PDF is not uploaded or saved; extraction makes no model call.`,
  }
}
