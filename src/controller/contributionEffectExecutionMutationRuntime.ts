/** Lazy transport and acknowledgement FIFO behind Contribution effect execution. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionEffectExecution,
  reconcileContributionEffectExecution,
  type ContributionEffectExecutionIntent,
} from '../api/contributionEffectExecutionCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionEffectExecutionStatus } from './contributionEffectExecutionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That effect attempt belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This approved effect is no longer available to run. Dismiss it and review the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to run this effect. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This effect did not run because the current envelope no longer covers it. Dismiss the attempt and review the envelope.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Effect execution is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this approved effect ran. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionEffectExecutionIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionEffectExecution,
  reconcile: reconcileContributionEffectExecution,
  describeFailure,
  setStatus: publishContributionEffectExecutionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionEffectExecutionRuntime = controller.enqueue
export const retryContributionEffectExecutionRuntime = controller.retry
export const discardContributionEffectExecutionRuntime = controller.discard
export const clearContributionEffectExecutions = controller.clearAll
