/** Lazy transport and acknowledgement FIFO behind Contribution creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionCreation,
  reconcileContributionCreation,
} from '../api/contributionCreationCommands.ts'
import {
  contributionCreationResourceId,
  type ContributionCreationIntent,
} from '../api/contributionCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionCreationStatus } from './contributionCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Contribution belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have access to declare work here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409 || error.status === 429) {
      return { message: 'This Project cannot accept another Contribution right now. Review the Changes ledger, then Retry or Dismiss.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this Contribution was declared. The Changes ledger was checked—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionCreationIntent, undefined>({
  resourceId: contributionCreationResourceId,
  snapshot: () => undefined,
  mutate: applyContributionCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileContributionCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishContributionCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionCreationRuntime = controller.enqueue
export const retryContributionCreationRuntime = controller.retry
export const discardContributionCreationRuntime = controller.discard
export const clearContributionCreations = controller.clearAll
