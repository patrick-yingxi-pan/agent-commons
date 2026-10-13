/** Lazy, acknowledgement-aware stop transport for one frozen run identity. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import { reconcileScheduleRunStop, scheduleRunStopBaseline, stopScheduleRun } from '../api/scheduleRunStopCommands'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore'
import type { ScheduleRunStopIntent } from '../api/scheduleRunStopCommands'
import { publishScheduleRunStopStatus } from './scheduleRunStopMutations'
import type { RevisionedMutationFailure } from './revisionedMutationCore'
import { SCHEDULE_RUN_STOP_SCOPE } from '../lib/scheduleRunStopPresentation'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) return { message: 'That Stop request belonged to the previous account. Dismiss it to continue.', retryable: false }
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return { message: 'You can no longer stop that run. Dismiss the request to continue.', retryable: false }
  }
  return { message: `Couldn’t confirm Stop. The run may still be active. ${SCHEDULE_RUN_STOP_SCOPE} Retry safely or Dismiss.`, retryable: true }
}

const controller = createAcknowledgedActionMutationController<ScheduleRunStopIntent, string | null>({
  resourceId: (intent) => `${intent.scheduleId}:${intent.runId}`,
  snapshot: scheduleRunStopBaseline,
  mutate: stopScheduleRun,
  reconcile: reconcileScheduleRunStop,
  describeFailure,
  setStatus: publishScheduleRunStopStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueScheduleRunStopRuntime = controller.enqueue
export const retryScheduleRunStopRuntime = controller.retry
export const discardScheduleRunStopRuntime = controller.discard
export const clearScheduleRunStops = controller.clearAll
