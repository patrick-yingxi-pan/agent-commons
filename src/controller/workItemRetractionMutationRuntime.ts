/** Lazy transport and acknowledgement FIFO behind work-item retraction. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyWorkItemRetraction,
  reconcileWorkItemRetraction,
  type WorkItemRetractionIntent,
} from '../api/workItemRetractionCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishWorkItemRetractionStatus } from './workItemRetractionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That retraction belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This work item can no longer be retracted. Dismiss the action and review the Project.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to retract this item. Dismiss the action to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This work item was closed elsewhere. Dismiss the action and review its current history.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Retraction is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this item was retracted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<WorkItemRetractionIntent, undefined>({
  resourceId: (intent) => intent.itemId,
  snapshot: () => undefined,
  mutate: applyWorkItemRetraction,
  reconcile: reconcileWorkItemRetraction,
  describeFailure,
  setStatus: publishWorkItemRetractionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueWorkItemRetractionRuntime = controller.enqueue
export const retryWorkItemRetractionRuntime = controller.retry
export const discardWorkItemRetractionRuntime = controller.discard
export const clearWorkItemRetractions = controller.clearAll
