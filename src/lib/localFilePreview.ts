import { isDocumentImportOutcome, type DocumentImportOutcome } from '../../contract/documentImport.mjs'
import { localBrowseDocumentFormat, MAX_LOCAL_BROWSE_TEXT_BYTES } from '../../contract/localFileBrowse.mjs'
import type { LocalFolderFilePreview } from '../../contract/localFolderBrowse.mjs'
import type { LocalGitFilePreview } from '../../contract/localGitBrowse.mjs'

/** The native container never enters browser state. Only this text projection
 * and its format-specific fidelity outcome may become a saved attachment. */
export interface LocalBrowsePreview {
  version: 1
  path: string
  sizeBytes: number
  snapshot: { text: string; omitted?: never } | { omitted: 'unsupported' | 'too-large' | 'unreadable' | 'document-extraction'; text?: never }
  documentImport?: DocumentImportOutcome
}

type DocumentReader = { read(bytes: Uint8Array, signal?: AbortSignal): Promise<unknown> }
type ReaderLoader = (path: string) => Promise<DocumentReader | undefined>
const loadReader: ReaderLoader = async path => (await import('./documentFileImport.ts')).documentReaderForName(path)

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

/** Called only after the source API's closed validation. Reader loading is
 * deliberately deferred until one document is selected; ordinary text, path
 * listings, and native omissions never load the parser graph. */
export async function prepareLocalFilePreview(
  native: LocalFolderFilePreview | LocalGitFilePreview,
  signal: AbortSignal,
  readerForPath: ReaderLoader = loadReader,
): Promise<LocalBrowsePreview> {
  signal.throwIfAborted()
  const { version, path, sizeBytes } = native
  const base = { version, path, sizeBytes }
  const format = localBrowseDocumentFormat(path)
  const failure = (status: 'invalid' | 'unavailable' | 'text-limit' | 'file-too-large'): LocalBrowsePreview => ({
    ...base, snapshot: { omitted: 'document-extraction' }, documentImport: { format: format!, status },
  })
  if ('text' in native.snapshot) return { ...base, snapshot: { text: native.snapshot.text } }
  if ('omitted' in native.snapshot) return {
    ...base, snapshot: { omitted: native.snapshot.omitted },
    ...(format ? { documentImport: { format, status: native.snapshot.omitted === 'too-large' ? 'file-too-large' as const : 'unavailable' as const } } : {}),
  }
  if (!format || native.snapshot.document.format !== format) throw new Error('Invalid local document preview.')
  try {
    const reader = await untilCancelled(readerForPath(path), signal)
    signal.throwIfAborted()
    if (!reader) return failure('unavailable')
    const result = await untilCancelled(reader.read(native.snapshot.document.bytes, signal), signal)
    signal.throwIfAborted()
    if (!ownDataRecord(result) || Object.keys(result).some(key => !['text', 'documentImport'].includes(key)) ||
        !ownDataRecord(result.documentImport) || !isDocumentImportOutcome(result.documentImport) || result.documentImport.format !== format) return failure('invalid')
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
