import type { SessionContextState } from '../../contract/api.ts'
import type { RefreshServedAttachmentRequest } from '../../contract/servedTextSnapshot.ts'
import { apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'

/** A logical Refresh keeps its request ID through lost-response recovery. */
export async function refreshSessionAttachment(sessionId: string, attachmentId: string, request: RefreshServedAttachmentRequest, expectedSessionUserId?: string | null): Promise<SessionContextState> {
  const next = await apiPost<SessionContextState>(paths.refreshSessionAttachment(sessionId, attachmentId), request, { signal: AbortSignal.timeout(30_000), expectedSessionUserId })
  invalidate(keys.session(sessionId))
  return next
}
