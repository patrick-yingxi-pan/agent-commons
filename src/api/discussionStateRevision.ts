import type { Discussion, SocialEntityRef } from '../../contract/index.ts'

export interface DiscussionStateIntent {
  readonly discussionId: string
  readonly anchor: SocialEntityRef
  readonly state: Discussion['state']
  readonly expectedStateRevision: number
  readonly intentId: string
}

export const discussionStateResourceId = (
  intent: Pick<DiscussionStateIntent, 'discussionId'>,
): string => `discussion-state:${intent.discussionId}`
