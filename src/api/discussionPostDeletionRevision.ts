import type { DiscussionPost, SocialEntityRef } from '../../contract/index.ts'

/** Frozen consent for one post deletion. `postIds` is the complete reviewed
 * effect: just the target for promotion, or the target plus its descendants. */
export interface DiscussionPostDeletionIntent {
  readonly discussionId: string
  readonly anchor: SocialEntityRef
  readonly post: DiscussionPost
  readonly postIds: readonly string[]
  readonly cascade: boolean
  readonly intentId: string
}

export const discussionPostDeletionResourceId = (
  intent: Pick<DiscussionPostDeletionIntent, 'discussionId' | 'post'>,
): string => `discussion-post-delete:${intent.discussionId}:${intent.post.id}`
