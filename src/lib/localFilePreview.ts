import { isDocumentImportOutcome, type DocumentImportOutcome } from '../../contract/documentImport.mjs'
import { IMAGE_MAX_BYTES, IMAGE_MAX_CONTAINER_BYTES, isImageSnapshot, type ImageSnapshot } from '../../contract/imageInput.ts'
import { imageOriginal, type ImageOriginal } from '../../contract/imageOriginal.ts'
import { isImageFileName } from '../../contract/imageFile.mjs'
import { localBrowseDocumentFormat, MAX_LOCAL_BROWSE_TEXT_BYTES } from '../../contract/localFileBrowse.mjs'
import type { LocalFolderFilePreview } from '../../contract/localFolderBrowse.mjs'
import type { LocalGitFilePreview } from '../../contract/localGitBrowse.mjs'
import { snapshotPdfOcrInput } from '../../contract/pdfOcr.mjs'

/** Native containers never enter browser state as read-capable objects. Text
 * retains its fidelity outcome; image previews retain normalized PNG data and
 * an opaque, download-only original for a later explicit saved-copy action. */
export interface LocalBrowsePreview {
  version: 1
  path: string
  sizeBytes: number
  snapshot: { text: string; omitted?: never; image?: never; original?: never } |
    { image: ImageSnapshot; original: ImageOriginal; text?: never; omitted?: never } |
    { omitted: 'unsupported' | 'too-large' | 'unreadable' | 'document-extraction' | 'image-import'; text?: never; image?: never; original?: never }
  documentImport?: DocumentImportOutcome
  imageFailure?: ImageImportFailure
  /** Disposable captured bytes for a separate, explicit on-device recognition.
   * Never part of the saved-copy projection or a native path capability. */
  pdfOcrInput?: Uint8Array
}

export type ImageImportFailure = 'invalid' | 'too-large' | 'decode-failed' | 'timeout' | 'unavailable'

type DocumentReader = { read(bytes: Uint8Array, signal?: AbortSignal): Promise<unknown> }
type ReaderLoader = (path: string) => Promise<DocumentReader | undefined>
const loadReader: ReaderLoader = async path => (await import('./documentFileImport.ts')).documentReaderForName(path)
type ImageImporter = (bytes: Uint8Array, signal?: AbortSignal) => Promise<unknown>
type ImageImporterLoader = (path: string) => Promise<ImageImporter | undefined>
const loadImageImporter: ImageImporterLoader = async () => (await import('./imageImport.ts')).importImage

function imageFailureFrom(error: unknown): ImageImportFailure {
  if (!error || typeof error !== 'object') return 'unavailable'
  const name = Object.getOwnPropertyDescriptor(error, 'name')
  const reason = Object.getOwnPropertyDescriptor(error, 'reason')
  if (name && 'value' in name && name.value === 'ImageImportError' && reason && 'value' in reason &&
      ['invalid', 'too-large', 'decode-failed', 'timeout'].includes(reason.value)) return reason.value
  return 'unavailable'
}

function ownDataRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && descriptor?.enumerable === true && 'value' in descriptor
  })
}

/** Module loading itself cannot be cancelled. Stop holding this operation open
 * immediately on disposal, without allowing its eventual load to start work. */
function untilCancelled<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason) }
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(value => { signal.removeEventListener('abort', cancel); resolve(value) }, error => {
      signal.removeEventListener('abort', cancel); reject(error)
    })
    if (signal.aborted) cancel()
  })
}

/** Called only after source validation. Reader and image importer loading are
 * deferred until one document or image is selected. */
export async function prepareLocalFilePreview(
  native: LocalFolderFilePreview | LocalGitFilePreview,
  signal: AbortSignal,
  readerForPath: ReaderLoader = loadReader,
  imageImporterForPath: ImageImporterLoader = loadImageImporter,
  options: { retainPdfOcrInput?: boolean } = {},
): Promise<LocalBrowsePreview> {
  signal.throwIfAborted()
  const { version, path, sizeBytes } = native
  const base: Pick<LocalBrowsePreview, 'version' | 'path' | 'sizeBytes' | 'pdfOcrInput'> = { version, path, sizeBytes }
  const format = localBrowseDocumentFormat(path)
  const failure = (status: 'invalid' | 'unavailable' | 'text-limit' | 'file-too-large'): LocalBrowsePreview => ({
    ...base, snapshot: { omitted: 'document-extraction' }, documentImport: { format: format!, status },
  })
  if ('image' in native.snapshot) {
    const imageFailure = (reason: ImageImportFailure): LocalBrowsePreview => ({
      ...base, snapshot: { omitted: 'image-import' }, imageFailure: reason,
    })
    try {
      const bytes = native.snapshot.image.bytes
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) return imageFailure('invalid')
      if (bytes.byteLength > IMAGE_MAX_CONTAINER_BYTES) return imageFailure('too-large')
      const importer = await untilCancelled(imageImporterForPath(path), signal)
      signal.throwIfAborted()
      if (!importer) return imageFailure('unavailable')
      const candidate = await untilCancelled(importer(bytes, signal), signal)
      signal.throwIfAborted()
      if (!ownDataRecord(candidate) || Object.keys(candidate).length !== 5 ||
          Object.keys(candidate).some(key => !['mimeType', 'data', 'width', 'height', 'byteLength'].includes(key))) {
        return imageFailure('invalid')
      }
      const detached = structuredClone(candidate)
      if (!ownDataRecord(detached) || !isImageSnapshot(detached) || detached.mimeType !== 'image/png' ||
          detached.byteLength > IMAGE_MAX_BYTES || detached.width > 2000 || detached.height > 2000) {
        return imageFailure('invalid')
      }
      return { ...base, snapshot: { image: detached, original: imageOriginal(path.slice(path.lastIndexOf('/') + 1), bytes) } }
    } catch (error) {
      signal.throwIfAborted()
      return imageFailure(imageFailureFrom(error))
    }
  }
  if ('text' in native.snapshot) return { ...base, snapshot: { text: native.snapshot.text } }
  if ('omitted' in native.snapshot) {
    if (isImageFileName(path)) return {
      ...base, snapshot: { omitted: 'image-import' },
      imageFailure: native.snapshot.omitted === 'too-large' ? 'too-large' : 'unavailable',
    }
    return {
      ...base, snapshot: { omitted: native.snapshot.omitted },
      ...(format ? { documentImport: { format, status: native.snapshot.omitted === 'too-large' ? 'file-too-large' as const : 'unavailable' as const } } : {}),
    }
  }
  if (!format || native.snapshot.document.format !== format) throw new Error('Invalid local document preview.')
  if (format === 'pdf' && options.retainPdfOcrInput && native.snapshot.document.bytes.byteLength === sizeBytes) {
    // Detach before PDF extraction can transfer or mutate its input buffer.
    const captured = snapshotPdfOcrInput(native.snapshot.document.bytes)
    if (captured.status === 'ready') base.pdfOcrInput = captured.pdf
  }
  try {
    const reader = await untilCancelled(readerForPath(path), signal)
    signal.throwIfAborted()
    if (!reader) return failure('unavailable')
    const result = await untilCancelled(reader.read(native.snapshot.document.bytes, signal), signal)
    signal.throwIfAborted()
    if (!ownDataRecord(result) || Object.keys(result).some(key => !['text', 'documentImport'].includes(key)) ||
        !ownDataRecord(result.documentImport) || !isDocumentImportOutcome(result.documentImport) || result.documentImport.format !== format ||
        (result.documentImport.format === 'pdf' && result.documentImport.method !== undefined)) return failure('invalid')
    const documentImport = structuredClone(result.documentImport)
    if (documentImport.status !== 'ready') {
      if (result.text !== undefined) return failure('invalid')
      return { ...base, snapshot: { omitted: 'document-extraction' }, documentImport }
    }
    if (typeof result.text !== 'string' || !result.text.trim()) return failure('invalid')
    if (result.text.length > MAX_LOCAL_BROWSE_TEXT_BYTES || new TextEncoder().encode(result.text).byteLength > MAX_LOCAL_BROWSE_TEXT_BYTES) return failure('text-limit')
    return { ...base, snapshot: { text: result.text }, documentImport }
  } catch {
    signal.throwIfAborted()
    return failure('unavailable')
  }
}
