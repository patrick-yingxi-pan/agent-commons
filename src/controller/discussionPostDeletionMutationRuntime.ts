/** Lazy acknowledgement FIFO behind discussion-post deletion. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyDiscussionPostDeletion,
  reconcileDiscussionPostDeletion,
} from '../api/discussionPostDeletionCommands.ts'
import {
  discussionPostDeletionResourceId,
  type DiscussionPostDeletionIntent,
} from '../api/discussionPostDeletionRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishDiscussionPostDeletionStatus } from './discussionPostDeletionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That deletion belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'These posts can no longer be deleted. Dismiss the action and review the thread.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to delete these posts. Dismiss the action to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This reply branch changed. Dismiss, review it again, and confirm a new deletion.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Post deletion is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether these posts were deleted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<DiscussionPostDeletionIntent, undefined>({
  resourceId: discussionPostDeletionResourceId,
  snapshot: () => undefined,
  mutate: applyDiscussionPostDeletion,
  reconcile: reconcileDiscussionPostDeletion,
  describeFailure,
  setStatus: publishDiscussionPostDeletionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueDiscussionPostDeletionRuntime = controller.enqueue
export const retryDiscussionPostDeletionRuntime = controller.retry
export const discardDiscussionPostDeletionRuntime = controller.discard
export const clearDiscussionPostDeletions = controller.clearAll
