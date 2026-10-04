import type { FsCatalog, FsFolderContents, FsSource } from '../../contract/fs.ts'
import { apiGet } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { isServedTextSnapshot, type ServedTextSnapshot } from '../../contract/servedTextSnapshot.ts'

/** The file picker owns one bounded wait per network read, including its body.
 * Closing an intake adds cancellation without weakening the deadline. */
const FS_READ_TIMEOUT_MS = 30_000
function readSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(FS_READ_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

export const readFsSources = () => apiGet<FsSource[]>(paths.fsSources, { signal: readSignal() })
export const readFsCatalog = (source: string) => apiGet<FsCatalog>(paths.fsCatalog(source), { signal: readSignal() })
export const readFsFolder = (source: string, path: string, signal?: AbortSignal) =>
  apiGet<FsFolderContents>(paths.fsFolder(source, path), { signal: readSignal(signal) })

/** Explicit intake only: never cached, subscribed, or fetched during rendering. */
export async function readFsSnapshot(source: string, path: string, signal?: AbortSignal): Promise<ServedTextSnapshot> {
  const snapshot = await apiGet<unknown>(paths.fsSnapshot(source, path), { signal: readSignal(signal) })
  if (!isServedTextSnapshot(snapshot) || snapshot.sourceId !== source || snapshot.path !== path) {
    throw new Error('The source returned an invalid saved copy. Nothing was attached.')
  }
  return snapshot
}

export const retryFsSources = () => invalidate(keys.fsSources)
export const retryFsCatalog = (source: string) => invalidate(keys.fsCatalog(source))
