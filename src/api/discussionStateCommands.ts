/** Exact desired-state transport and reconciliation for resolve/reopen. */
import type { Discussion, SetDiscussionStateRequest, SocialEntityRef } from '../../contract/index.ts'
import { ApiRequestError, apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import type { DiscussionStateIntent } from './discussionStateRevision.ts'

const sameRef = (left: SocialEntityRef, right: SocialEntityRef): boolean =>
  left.kind === right.kind && left.id === right.id

const validateIdentity = (intent: DiscussionStateIntent, discussion: Discussion): void => {
  if (
    discussion.id !== intent.discussionId ||
    !sameRef(discussion.anchor.ref, intent.anchor) ||
    !Number.isInteger(discussion.stateRevision) ||
    discussion.stateRevision < 0
  ) {
    throw new Error('The lifecycle acknowledgement did not match the reviewed discussion.')
  }
}

const validateAcknowledgement = (intent: DiscussionStateIntent, discussion: Discussion): void => {
  validateIdentity(intent, discussion)
  if (discussion.state !== intent.state || discussion.stateRevision < intent.expectedStateRevision) {
    throw new Error('The lifecycle acknowledgement did not match the reviewed discussion.')
  }
}

function refreshFaces(intent: DiscussionStateIntent): void {
  invalidate(keys.discussions(intent.anchor.kind, intent.anchor.id))
  invalidate(keys.myDiscussions)
  invalidate(keys.directMessages)
  invalidate(keys.commons)
}

function acceptState(intent: DiscussionStateIntent, discussion: Discussion): void {
  const key = keys.discussion(intent.discussionId)
  const cached = peek<Discussion>(key)
  const projected = peek<Discussion[]>(keys.discussions(intent.anchor.kind, intent.anchor.id))
    ?.find((candidate) => candidate.id === intent.discussionId)
  const newest = [cached, projected].reduce<Discussion | undefined>(
    (current, candidate) => !candidate || (current && current.stateRevision >= candidate.stateRevision)
      ? current
      : candidate,
    undefined,
  )
  if (newest && newest.stateRevision > discussion.stateRevision) {
    if (newest.state !== intent.state) {
      throw new ApiRequestError('conflict', 'A newer discussion state superseded this acknowledgement.', 409)
    }
    setData(key, newest)
  } else if (cached) {
    mutate<Discussion>(key, (current) => current ? {
      ...current,
      state: discussion.state,
      stateRevision: discussion.stateRevision,
    } : discussion)
  } else {
    setData(key, discussion)
  }
  invalidate(key)
  refreshFaces(intent)
}

export async function applyDiscussionState(
  intent: DiscussionStateIntent,
  idempotencyKey: string,
): Promise<void> {
  const request: SetDiscussionStateRequest = {
    state: intent.state,
    expectedStateRevision: intent.expectedStateRevision,
  }
  const discussion = await apiPost<Discussion>(
    paths.discussionResolve(intent.discussionId),
    request,
    { idempotencyKey },
  )
  validateAcknowledgement(intent, discussion)
  acceptState(intent, discussion)
}

export async function reconcileDiscussionState(intent: DiscussionStateIntent): Promise<boolean> {
  const discussion = await apiGet<Discussion>(paths.discussion(intent.discussionId))
  validateIdentity(intent, discussion)
  setData(keys.discussion(intent.discussionId), discussion)
  refreshFaces(intent)
  return discussion.state === intent.state
}
