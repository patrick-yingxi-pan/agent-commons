/** Exact transport and recovery for viewer-private DM read cursors. */
import type { DiscussionReadState, MarkDiscussionReadRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix } from './cache.ts'
import { keys, paths } from './keys.ts'
import { discussionReadRealized } from './discussionReadRevision.ts'

export interface DiscussionReadIntent {
  tenantId: string
  discussionId: string
  throughPostId: string
  intentId: string
}

export const discussionReadResourceId = (discussionId: string, throughPostId: string): string =>
  `discussion-read:${encodeURIComponent(discussionId)}:${encodeURIComponent(throughPostId)}`

function refreshReadProjections(): void {
  invalidate(keys.directMessages)
  // Advancing one cursor may evict another bounded mark, so every open detail
  // derives viewer-relative unread state again.
  invalidatePrefix(keys.discussion())
}

export async function applyDiscussionRead(
  intent: DiscussionReadIntent,
  idempotencyKey: string,
): Promise<void> {
  await apiPost<{ ok: true }>(
    paths.discussionRead(intent.discussionId),
    { throughPostId: intent.throughPostId } satisfies MarkDiscussionReadRequest,
    { idempotencyKey },
  )
  refreshReadProjections()
}

export async function reconcileDiscussionRead(intent: DiscussionReadIntent): Promise<boolean> {
  const state = await apiGet<DiscussionReadState>(
    paths.discussionReadState(intent.discussionId, intent.throughPostId),
  )
  const realized = discussionReadRealized(state, intent.throughPostId)
  refreshReadProjections()
  return realized
}
