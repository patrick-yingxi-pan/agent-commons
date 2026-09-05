/** Lazy transport and acknowledgement FIFO behind crystallization. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionCrystallization,
  reconcileContributionCrystallization,
  type ContributionCrystallizationIntent,
} from '../api/contributionCrystallizationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionCrystallizationStatus } from './contributionCrystallizationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That crystallization belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact changeset can no longer be crystallized. Dismiss it and review the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to crystallize this Contribution. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'The Contribution changed before this version could be confirmed. Dismiss it and review the current ledger.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Crystallization is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this changeset was crystallized. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionCrystallizationIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionCrystallization,
  reconcile: reconcileContributionCrystallization,
  describeFailure,
  setStatus: publishContributionCrystallizationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionCrystallizationRuntime = controller.enqueue
export const retryContributionCrystallizationRuntime = controller.retry
export const discardContributionCrystallizationRuntime = controller.discard
export const clearContributionCrystallizations = controller.clearAll
