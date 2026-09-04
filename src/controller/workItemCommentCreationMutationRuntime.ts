/** Lazy transport and acknowledgement FIFO behind work-item commenting. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyWorkItemCommentCreation,
  reconcileWorkItemCommentCreation,
  type WorkItemCommentCreationIntent,
} from '../api/workItemCommentCreationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishWorkItemCommentCreationStatus } from './workItemCommentCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That comment belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This comment can no longer be posted here. Dismiss it and review the work item.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to comment here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This discussion is full and cannot accept another comment. Dismiss this draft.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Commenting is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this comment was posted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<WorkItemCommentCreationIntent, undefined>({
  resourceId: (intent) => intent.itemId,
  snapshot: () => undefined,
  mutate: applyWorkItemCommentCreation,
  reconcile: reconcileWorkItemCommentCreation,
  describeFailure,
  setStatus: publishWorkItemCommentCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueWorkItemCommentCreationRuntime = controller.enqueue
export const retryWorkItemCommentCreationRuntime = controller.retry
export const discardWorkItemCommentCreationRuntime = controller.discard
export const clearWorkItemCommentCreations = controller.clearAll
