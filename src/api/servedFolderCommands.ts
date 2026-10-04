import type { SessionContextState } from '../../contract/api.ts'
import type { RefreshServedAttachmentRequest } from '../../contract/servedTextSnapshot.ts'
import { apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'

/** A logical folder Save keeps its request ID through lost-response recovery. */
export async function refreshSessionFolder(sessionId: string, folderId: string, request: RefreshServedAttachmentRequest): Promise<SessionContextState> {
  const next = await apiPost<SessionContextState>(paths.refreshSessionFolder(sessionId, folderId), request, { signal: AbortSignal.timeout(30_000) })
  invalidate(keys.session(sessionId))
  return next
}
