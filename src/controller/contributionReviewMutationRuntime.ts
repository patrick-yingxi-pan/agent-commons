/** Lazy transport and acknowledgement FIFO behind Contribution review. */
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import {
  applyContributionReview,
  reconcileContributionReview,
  type ContributionReviewIntent,
} from '../api/contributionReviewCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionReviewStatus } from './contributionReviewMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That review belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact changeset review is no longer available. Dismiss it and review the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to run this review. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'The changeset changed or can no longer be reviewed. Dismiss this review and inspect the current version.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'The Project owner’s review budget or request rate limit is exhausted. Retry after the applicable limit resets.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this changeset was reviewed. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionReviewIntent, undefined>({
  resourceId: (intent) => `${intent.projectId}\0${intent.contributionId}`,
  snapshot: () => undefined,
  mutate: applyContributionReview,
  reconcile: reconcileContributionReview,
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: publishContributionReviewStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionReviewRuntime = controller.enqueue
export const retryContributionReviewRuntime = controller.retry
export const discardContributionReviewRuntime = controller.discard
export const clearContributionReviews = controller.clearAll
