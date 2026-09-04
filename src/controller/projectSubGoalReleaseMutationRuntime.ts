/** Lazy transport and acknowledgement FIFO behind sub-goal release. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyProjectSubGoalRelease,
  reconcileProjectSubGoalRelease,
  type ProjectSubGoalReleaseIntent,
} from '../api/projectSubGoalReleaseCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishProjectSubGoalReleaseStatus } from './projectSubGoalReleaseMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That release belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to release this claim. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 404) {
      return { message: 'This claim or Project is no longer available. Dismiss the action and review Coordination.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Claim release is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this claim was released. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ProjectSubGoalReleaseIntent, undefined>({
  resourceId: (intent) => intent.reservationId,
  snapshot: () => undefined,
  mutate: applyProjectSubGoalRelease,
  reconcile: reconcileProjectSubGoalRelease,
  describeFailure,
  setStatus: publishProjectSubGoalReleaseStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueProjectSubGoalReleaseRuntime = controller.enqueue
export const retryProjectSubGoalReleaseRuntime = controller.retry
export const discardProjectSubGoalReleaseRuntime = controller.discard
export const clearProjectSubGoalReleases = controller.clearAll
