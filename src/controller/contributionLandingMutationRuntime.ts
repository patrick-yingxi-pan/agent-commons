/** Lazy transport and acknowledgement FIFO behind Contribution landing. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionLanding,
  reconcileContributionLanding,
  type ContributionLandingIntent,
} from '../api/contributionLandingCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionLandingStatus } from './contributionLandingMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That landing belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This Contribution is no longer available to land. Dismiss the action and review the Project.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to land this Contribution. Dismiss the action to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This Contribution’s landing requirements changed. Dismiss the action and review its current gate.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Contribution landing is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this Contribution landed. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionLandingIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionLanding,
  reconcile: reconcileContributionLanding,
  describeFailure,
  setStatus: publishContributionLandingStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionLandingRuntime = controller.enqueue
export const retryContributionLandingRuntime = controller.retry
export const discardContributionLandingRuntime = controller.discard
export const clearContributionLandings = controller.clearAll
