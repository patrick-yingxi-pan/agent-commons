/** Lazy transport and acknowledgement FIFO behind envelope approval. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionEnvelopeApproval,
  reconcileContributionEnvelopeApproval,
  type ContributionEnvelopeApprovalIntent,
} from '../api/contributionEnvelopeApprovalCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionEnvelopeApprovalStatus } from './contributionEnvelopeApprovalMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That approval belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact envelope approval is no longer available. Dismiss it and review the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to approve this envelope. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'The envelope changed after you reviewed it. Dismiss this approval and review the current version.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Envelope approval is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this envelope was approved. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionEnvelopeApprovalIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionEnvelopeApproval,
  reconcile: reconcileContributionEnvelopeApproval,
  describeFailure,
  setStatus: publishContributionEnvelopeApprovalStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionEnvelopeApprovalRuntime = controller.enqueue
export const retryContributionEnvelopeApprovalRuntime = controller.retry
export const discardContributionEnvelopeApprovalRuntime = controller.discard
export const clearContributionEnvelopeApprovals = controller.clearAll
