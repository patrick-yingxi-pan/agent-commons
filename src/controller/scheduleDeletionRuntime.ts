/** Lazy transport and FIFO engine behind the routine-deletion facade. */
import type { ScheduledTask } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteSchedule,
  reconcileScheduleDefinition,
} from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore'
import { publishScheduleDeletionStatus } from './scheduleDeletionMutations'
import type { RevisionedMutationFailure } from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That deletion belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This routine changed elsewhere. The latest definition is loaded—review it, then retry deletion or dismiss.',
        retryable: true,
        rebaseOnRetry: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return {
        message: 'That routine is no longer available. Dismiss the deletion to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 401 || error.status === 403) {
      return {
        message: 'You no longer have permission to delete that routine. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many routine changes at once. Retry deletion in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm deletion. The routine remains available—retry when the connection recovers.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const controller = createRevisionedDeletionMutationController<ScheduledTask>({
  reconcile: async (id) => (await reconcileScheduleDefinition(id)) ?? null,
  mutate: deleteSchedule,
  revision: (task) => task.revision ?? 0,
  describeFailure,
  setStatus: publishScheduleDeletionStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueScheduleDeletionRuntime = controller.enqueue
export const retryScheduleDeletionRuntime = controller.retry
export const discardScheduleDeletionRuntime = controller.discard
export const clearScheduleDeletions = controller.clearAll
