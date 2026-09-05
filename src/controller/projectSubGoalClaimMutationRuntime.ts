/** Lazy transport and acknowledgement FIFO behind Project claim acquisition. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyProjectSubGoalClaim,
  reconcileProjectSubGoalClaim,
  type ProjectSubGoalClaimIntent,
} from '../api/projectSubGoalClaimCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishProjectSubGoalClaimStatus } from './projectSubGoalClaimMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That claim belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This sub-goal can no longer be claimed here. Dismiss it and review the Project.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to claim this sub-goal. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Claiming is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this sub-goal was claimed. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ProjectSubGoalClaimIntent, undefined>({
  resourceId: (intent) => intent.projectId,
  snapshot: () => undefined,
  mutate: applyProjectSubGoalClaim,
  reconcile: reconcileProjectSubGoalClaim,
  settleRejected: (error) =>
    error instanceof ApiRequestError && error.status === 409 ? 'discarded' : undefined,
  describeFailure,
  setStatus: publishProjectSubGoalClaimStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueProjectSubGoalClaimRuntime = controller.enqueue
export const retryProjectSubGoalClaimRuntime = controller.retry
export const discardProjectSubGoalClaimRuntime = controller.discard
export const clearProjectSubGoalClaims = controller.clearAll
