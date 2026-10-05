import { isServedPath, isServedSourceId } from '../../contract/servedTextSnapshot.ts'
import { activeAccount, accountGeneration, onAccountSwitch, shouldDropResponse } from './account.ts'
import { AccountSwitchedError, ApiRequestError, apiUrl } from './client.ts'
import { paths } from './keys.ts'

/** Explicit intake only. Neither query caches nor previews call this reader.
 * Raw bytes are bounded while streaming and never enter durable context. */
export async function readFsDocumentBytes(source: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!isServedSourceId(source) || !isServedPath(path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
    throw new Error('This document source is invalid. Nothing was saved.')
  }
  const account = activeAccount()
  const generation = accountGeneration()
  const controller = new AbortController()
  const unsubscribe = onAccountSwitch(() => controller.abort())
  const bounded = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])])
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const assertCurrent = (response?: Response) => {
    const verdict = shouldDropResponse(generation, accountGeneration(), account, response?.headers.get('x-resolved-tenant') ?? null)
    if (verdict.drop) throw new AccountSwitchedError(verdict.reason ?? 'switched')
    bounded.throwIfAborted()
  }
  try {
    assertCurrent()
    const response = await fetch(apiUrl(paths.fsContent(source, path)), { signal: bounded, cache: 'no-store', redirect: 'error' })
    assertCurrent(response)
    if (!response.ok) throw new ApiRequestError(response.status === 404 ? 'not_found' : 'internal', 'This document could not be read with its current permissions.', response.status)
    const length = response.headers.get('content-length')
    const declared = length !== null && /^\d+$/.test(length) ? Number(length) : undefined
    if (length !== null && (declared === undefined || !Number.isSafeInteger(declared))) throw new Error('The source returned an invalid document size.')
    if (declared !== undefined && declared > maxBytes) throw new Error('Document not imported. Choose a document up to 8 MB.')
    if (!response.body) throw new Error('The source returned no document bytes.')
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const chunk = await reader.read()
      assertCurrent(response)
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxBytes) throw new Error('Document not imported. Choose a document up to 8 MB.')
      chunks.push(chunk.value)
    }
    if (size === 0 || (declared !== undefined && !response.headers.get('content-encoding') && size !== declared)) {
      throw new Error('The complete document could not be read. Nothing was saved.')
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  } finally {
    // Do not let an uncooperative stream cancellation extend the intake wait.
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock() }
    controller.abort()
    unsubscribe()
  }
}
