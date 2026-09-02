/** Lazy transport and authoritative reconciliation for authored social prose. */
import type { Discussion, OpenDiscussionRequest, PostToDiscussionRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { discussionPostId } from './discussionPostIdentity.ts'
import {
  discussionWithPost,
  type SocialPostMutationIntent,
} from './socialPostRevision.ts'

const results = new Map<string, Discussion>()

function remember(intent: SocialPostMutationIntent, discussion: Discussion): void {
  results.set(intent.logicalKey, discussion)
  invalidate(keys.discussion(discussion.id))
  if (intent.kind === 'wall') {
    invalidate(keys.commons)
    invalidatePrefix(keys.ownerProfile())
    invalidate(keys.discussions('principal', intent.authorName))
    return
  }
  invalidate(keys.discussions(intent.subject.kind, intent.subject.id))
  if (intent.subject.kind === 'principal') invalidate(keys.directMessages)
}

export async function applySocialPostMutation(
  intent: SocialPostMutationIntent,
  idempotencyKey: string,
): Promise<void> {
  let discussion: Discussion
  if (intent.kind === 'wall') {
    discussion = await apiPost<Discussion>(paths.posts, { body: intent.body }, { idempotencyKey })
  } else if (intent.kind === 'open') {
    const request: OpenDiscussionRequest = {
      anchor: { ref: intent.subject, ...(intent.locus ? { locus: intent.locus } : {}) },
      firstPost: intent.body,
    }
    discussion = await apiPost<Discussion>(paths.discussionOpen(), request, { idempotencyKey })
  } else {
    const request: PostToDiscussionRequest = {
      body: intent.body,
      ...(intent.replyTo !== undefined ? { replyTo: intent.replyTo } : {}),
    }
    discussion = await apiPost<Discussion>(paths.discussionPosts(intent.discussionId), request, { idempotencyKey })
  }
  // Discussions have no monotonic revision yet. Keep the response only for the
  // initiating callback and invalidate shared projections; a delayed row must
  // never replace newer replies delivered by another window.
  remember(intent, discussion)
}

export async function reconcileSocialPostMutation(intent: SocialPostMutationIntent): Promise<boolean> {
  const expectedPostId = await discussionPostId(intent.tenantId, intent.logicalKey)
  let discussions: Discussion[]
  if (intent.kind === 'append') {
    const discussion = await apiGet<Discussion>(paths.discussion(intent.discussionId))
    discussions = [discussion]
    setData(keys.discussion(intent.discussionId), discussion)
  } else if (intent.kind === 'wall') {
    discussions = await apiGet<Discussion[]>(paths.discussions('principal', intent.authorName))
    setData(keys.discussions('principal', intent.authorName), discussions)
  } else if (intent.subject.kind === 'principal') {
    discussions = await apiGet<Discussion[]>(paths.directMessages())
    setData(keys.directMessages, discussions)
  } else {
    discussions = await apiGet<Discussion[]>(paths.discussions(intent.subject.kind, intent.subject.id))
    setData(keys.discussions(intent.subject.kind, intent.subject.id), discussions)
  }
  const represented = discussionWithPost(discussions, expectedPostId)
  if (!represented) return false
  remember(intent, represented)
  return true
}

export function takeSocialPostResult(logicalKey: string): Discussion | undefined {
  const result = results.get(logicalKey)
  results.delete(logicalKey)
  return result
}

export function clearSocialPostResults(): void {
  results.clear()
}
