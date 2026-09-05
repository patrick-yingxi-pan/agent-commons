/** Lazy transport and acknowledgement FIFO behind envelope proposals. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionEnvelopeProposal,
  reconcileContributionEnvelopeProposal,
  type ContributionEnvelopeProposalIntent,
} from '../api/contributionEnvelopeProposalCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionEnvelopeProposalStatus } from './contributionEnvelopeProposalMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That envelope draft belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact envelope draft is no longer valid. Dismiss it and review the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to propose this envelope. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'The envelope changed after this draft was opened. Dismiss it and review the current version.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Envelope proposal is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this envelope was proposed. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionEnvelopeProposalIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionEnvelopeProposal,
  reconcile: reconcileContributionEnvelopeProposal,
  describeFailure,
  setStatus: publishContributionEnvelopeProposalStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionEnvelopeProposalRuntime = controller.enqueue
export const retryContributionEnvelopeProposalRuntime = controller.retry
export const discardContributionEnvelopeProposalRuntime = controller.discard
export const clearContributionEnvelopeProposals = controller.clearAll
