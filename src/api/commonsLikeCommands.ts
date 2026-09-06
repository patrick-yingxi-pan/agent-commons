/** Transport and exact authoritative recovery for one Commons endorsement. */
import type { CommonsItem, CommonsLikeState, SetCommonsLikeRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeCommonsLikeMembership } from './commonsLikeRevision.ts'

export interface CommonsLikeIntent {
  tenantId: string
  itemId: string
  liked: boolean
  intentId: string
}

export const commonsLikeResourceId = (itemId: string): string => `commons-like:${itemId}`

function rememberLike(itemId: string, state: CommonsLikeState): void {
  mutate<CommonsItem[]>(keys.commons, (current) =>
    current
      ? mergeCommonsLikeMembership(current, itemId, state.liked)
      : current as unknown as CommonsItem[],
  )
  // The acknowledgement safely owns this viewer's membership, not the public
  // aggregate's ordering. Re-read the projection for its current count.
  invalidate(keys.commons)
}

export async function applyCommonsLike(
  intent: CommonsLikeIntent,
  idempotencyKey: string,
): Promise<void> {
  const state = await apiPost<CommonsLikeState>(
    paths.commonsLike(intent.itemId),
    { liked: intent.liked } satisfies SetCommonsLikeRequest,
    { idempotencyKey },
  )
  if (state.liked !== intent.liked) {
    throw new Error('The server did not acknowledge the requested Like state.')
  }
  rememberLike(intent.itemId, state)
}

export async function reconcileCommonsLike(intent: CommonsLikeIntent): Promise<boolean> {
  const state = await apiGet<CommonsLikeState>(paths.commonsLike(intent.itemId))
  rememberLike(intent.itemId, state)
  return state.liked === intent.liked
}
