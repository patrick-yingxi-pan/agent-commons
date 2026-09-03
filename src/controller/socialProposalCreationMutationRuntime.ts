/** Lazy transport and acknowledgement FIFO behind change-offer creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applySocialProposalCreation,
  reconcileSocialProposalCreation,
} from '../api/socialProposalCreationCommands.ts'
import {
  socialProposalCreationResourceId,
  type SocialProposalCreationIntent,
} from '../api/socialProposalCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishSocialProposalCreationStatus } from './socialProposalCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That change offer belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 409) {
      return { message: error.message, retryable: false }
    }
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      return { message: 'You can no longer offer a change here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Change offers are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this change was offered. The change ledger was checked—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<SocialProposalCreationIntent, undefined>({
  resourceId: socialProposalCreationResourceId,
  snapshot: () => undefined,
  mutate: applySocialProposalCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileSocialProposalCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishSocialProposalCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueSocialProposalCreationRuntime = controller.enqueue
export const retrySocialProposalCreationRuntime = controller.retry
export const discardSocialProposalCreationRuntime = controller.discard
export const clearSocialProposalCreations = controller.clearAll
