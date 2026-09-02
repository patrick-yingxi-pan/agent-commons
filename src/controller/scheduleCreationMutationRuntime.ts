/** Lazy transport and acknowledgement FIFO behind routine creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  createSchedule,
  reconcileScheduleCreation,
  scheduleCreationBaseline,
  type ScheduleCreationBaseline,
  type ScheduleCreationIntent,
} from '../api/scheduleCreationCommands'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore'
import { publishScheduleCreationStatus } from './scheduleCreationMutations'
import type { RevisionedMutationFailure } from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That routine belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'That routine template is no longer valid. Dismiss it and choose again.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to create this routine. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many routine requests at once. Retry in a moment.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the routine was created. Routines were refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<
  ScheduleCreationIntent,
  ScheduleCreationBaseline
>({
  resourceId: (intent) => intent.intentId,
  snapshot: scheduleCreationBaseline,
  mutate: createSchedule,
  reconcile: reconcileScheduleCreation,
  describeFailure,
  setStatus: publishScheduleCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueScheduleCreationRuntime = controller.enqueue
export const retryScheduleCreationRuntime = controller.retry
export const discardScheduleCreationRuntime = controller.discard
export const clearScheduleCreations = controller.clearAll
