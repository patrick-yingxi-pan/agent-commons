/** Transport and exact desired-state reconciliation for discussion deletion. */
import type {
  DeleteDiscussionPostRequest,
  DeleteDiscussionPostResponse,
  Discussion,
  SocialEntityRef,
} from '../../contract/index.ts'
import { ApiRequestError, apiDelete, apiGet } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import type { DiscussionPostDeletionIntent } from './discussionPostDeletionRevision.ts'

const sameRef = (left: SocialEntityRef, right: SocialEntityRef): boolean =>
  left.kind === right.kind && left.id === right.id

const represented = (discussion: Discussion, intent: DiscussionPostDeletionIntent): boolean =>
  discussion.id === intent.discussionId &&
  sameRef(discussion.anchor.ref, intent.anchor) &&
  intent.postIds.every((id) => !discussion.posts.some((post) => post.id === id))

/** Apply only the addressed absence to a loaded cache. A crossed acknowledgement
 * must not erase newer replies, reactions, or thread state it did not own. */
function withoutReviewedPosts(
  discussion: Discussion,
  intent: DiscussionPostDeletionIntent,
): Discussion {
  const removed = new Set(intent.postIds)
  return {
    ...discussion,
    posts: discussion.posts
      .filter((post) => !removed.has(post.id))
      .map((post) => {
        if (post.replyTo === undefined || !removed.has(post.replyTo)) return post
        const { replyTo: _, ...promoted } = post
        return promoted
      }),
  }
}

function refreshDeletionFaces(intent: DiscussionPostDeletionIntent): void {
  invalidate(keys.discussions(intent.anchor.kind, intent.anchor.id))
  invalidate(keys.myDiscussions)
  invalidate(keys.directMessages)
  invalidate(keys.commons)
}

function acceptDeletion(
  intent: DiscussionPostDeletionIntent,
  discussion: Discussion | null,
): void {
  const key = keys.discussion(intent.discussionId)
  if (discussion === null) {
    setData<Discussion | undefined>(key, undefined)
  } else {
    const cached = peek<Discussion>(key)
    if (cached?.id === intent.discussionId && sameRef(cached.anchor.ref, intent.anchor)) {
      mutate<Discussion>(key, (current) => current ? withoutReviewedPosts(current, intent) : discussion)
    } else if (!cached) {
      setData(key, discussion)
    }
    invalidate(key)
  }
  refreshDeletionFaces(intent)
}

export async function applyDiscussionPostDeletion(
  intent: DiscussionPostDeletionIntent,
  idempotencyKey: string,
): Promise<void> {
  const request: DeleteDiscussionPostRequest = { expectedPostIds: [...intent.postIds] }
  const response = await apiDelete<DeleteDiscussionPostResponse>(
    paths.discussionPost(intent.discussionId, intent.post.id, intent.cascade),
    request,
    { idempotencyKey },
  )
  if (
    response.ok !== true ||
    (response.discussion !== null && !represented(response.discussion, intent))
  ) {
    throw new Error('The deletion acknowledgement did not match the reviewed discussion posts.')
  }
  acceptDeletion(intent, response.discussion)
}

export async function reconcileDiscussionPostDeletion(
  intent: DiscussionPostDeletionIntent,
): Promise<boolean> {
  let incoming: Discussion
  try {
    incoming = await apiGet<Discussion>(paths.discussion(intent.discussionId))
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      acceptDeletion(intent, null)
      return true
    }
    throw error
  }
  if (!represented(incoming, intent)) {
    invalidate(keys.discussion(intent.discussionId))
    return false
  }
  acceptDeletion(intent, incoming)
  return true
}
