/** Lazy acknowledgement FIFO behind resolve/reopen. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import { applyDiscussionState, reconcileDiscussionState } from '../api/discussionStateCommands.ts'
import {
  discussionStateResourceId,
  type DiscussionStateIntent,
} from '../api/discussionStateRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishDiscussionStateStatus } from './discussionStateMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That discussion action belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return { message: 'This discussion changed elsewhere. Dismiss, review it again, and choose the current action.', retryable: false }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'This discussion can no longer be changed. Dismiss the action and review the latest state.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change this discussion. Dismiss the action to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Discussion changes are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the discussion state. Retry safely or Dismiss.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<DiscussionStateIntent, undefined>({
  resourceId: discussionStateResourceId,
  snapshot: () => undefined,
  mutate: applyDiscussionState,
  reconcile: reconcileDiscussionState,
  describeFailure,
  setStatus: publishDiscussionStateStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueDiscussionStateRuntime = controller.enqueue
export const retryDiscussionStateRuntime = controller.retry
export const discardDiscussionStateRuntime = controller.discard
export const clearDiscussionStates = controller.clearAll
