/** Lazy transport and acknowledgement FIFO behind requiring review. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionReviewRequirement,
  reconcileContributionReviewRequirement,
  type ContributionReviewRequirementIntent,
} from '../api/contributionReviewRequirementCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionReviewRequirementStatus } from './contributionReviewRequirementMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That review requirement belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact review requirement is no longer available. Dismiss it and inspect the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to require review. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'The Contribution is already tightened or landed. Dismiss this request and inspect its current state.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Requiring review is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether review is required. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionReviewRequirementIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionReviewRequirement,
  reconcile: reconcileContributionReviewRequirement,
  describeFailure,
  setStatus: publishContributionReviewRequirementStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionReviewRequirementRuntime = controller.enqueue
export const retryContributionReviewRequirementRuntime = controller.retry
export const discardContributionReviewRequirementRuntime = controller.discard
export const clearContributionReviewRequirements = controller.clearAll
