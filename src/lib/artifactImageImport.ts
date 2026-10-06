import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import { isImageSnapshot } from '../../contract/imageInput.ts'
import { recognizeDesktopImageText } from '../api/desktopImageOcr.ts'
import { importedDocumentName, type ArtifactDocumentImportResult } from './artifactDocumentImport.ts'
import type { UiHostFile } from './uiHostFs.ts'

const failures = {
  'no-text': 'No readable text was found. Try a clearer image or type the text yourself.',
  invalid: 'The image could not be read. Choose another supported image.',
  'too-large': 'The image or recognized text exceeds the extraction limit. Choose a smaller image.',
  unavailable: 'On-device text extraction is unavailable. Try again or type the text yourself.',
  busy: 'Text extraction is already busy on this Mac. Wait for it to finish, then try again.',
  timeout: 'Text extraction took too long. Try a smaller or clearer image.',
}

/** This path has no upload or save capability. Only the normalized image
 * crosses the native byte-only adapter; the candidate retains text, not pixels. */
export async function reviewArtifactImageImport(
  files: readonly Pick<UiHostFile, 'name' | 'kind' | 'imageInput'>[],
  signal: AbortSignal,
  recognize = recognizeDesktopImageText,
): Promise<ArtifactDocumentImportResult> {
  if (signal.aborted || files.length === 0) return { status: 'cancelled' }
  if (files.length !== 1) return { status: 'error', message: 'Choose one image to extract text. Your draft is unchanged.' }
  const file = files[0]
  if (file.kind !== 'photo' || !isImageSnapshot(file.imageInput) || file.imageInput.mimeType !== 'image/png') {
    return { status: 'error', message: 'Choose a supported image to extract text. Your draft is unchanged.' }
  }
  const bytes = Uint8Array.from(atob(file.imageInput.data), (character) => character.charCodeAt(0))
  const result = await recognize(bytes, signal)
  if (signal.aborted || result.status === 'cancelled') return { status: 'cancelled' }
  if (result.status !== 'ready') return { status: 'error', message: `${failures[result.status]} Your draft is unchanged.` }
  if (result.text.length > MAX_AUTHORED_DOCUMENT_SOURCE_CHARS) {
    return { status: 'error', message: `Recognized text exceeds the ${MAX_AUTHORED_DOCUMENT_SOURCE_CHARS.toLocaleString()} character authoring limit. Nothing was truncated; your draft is unchanged.` }
  }
  return {
    status: 'ready', name: importedDocumentName(file.name), text: result.text,
    disclosure: 'Text recognized on this Mac from a reduced, single-frame image. Check for missing text, reading order and recognition errors. The image is not uploaded or saved; extraction makes no model call.',
  }
}
