/** Lazy transport and acknowledgement FIFO behind the manual-run facade. */
import {
  AccountSwitchedError,
  ApiRequestError,
} from '../api'
import {
  reconcileScheduleRun,
  runScheduleNow,
  scheduleRunBaseline,
} from '../api/scheduleRunCommands'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore'
import { publishScheduleRunStatus } from './scheduleRunMutations'
import type { RevisionedMutationFailure } from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That run request belonged to the previous account. Dismiss it to continue.',
      retryable: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return {
        message: 'That routine is no longer available. Dismiss the run request to continue.',
        retryable: false,
      }
    }
    if (error.status === 401 || error.status === 403) {
      return {
        message: 'You no longer have permission to run that routine. Dismiss the request to continue.',
        retryable: false,
      }
    }
    if (error.status === 409) {
      return { message: 'Another run is already in progress. Retry after it finishes, or Dismiss.', retryable: true }
    }
    if (error.status === 429) {
      return { message: 'Too many routine requests at once. Retry in a moment.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the run started. Recent runs was refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<readonly string[]>({
  snapshot: scheduleRunBaseline,
  mutate: runScheduleNow,
  reconcile: reconcileScheduleRun,
  describeFailure,
  setStatus: publishScheduleRunStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueScheduleRunRuntime = controller.enqueue
export const retryScheduleRunRuntime = controller.retry
export const discardScheduleRunRuntime = controller.discard
export const clearScheduleRuns = controller.clearAll
