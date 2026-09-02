/** Lazy transport and acknowledgement FIFO behind Contributor commissioning. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyCommissionCreation,
  reconcileCommissionCreation,
} from '../api/commissionCreationCommands.ts'
import {
  commissionCreationResourceId,
  type CommissionCreationIntent,
} from '../api/commissionCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishCommissionCreationStatus } from './commissionCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Contributor choice belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to commission this Agent. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'This Project cannot accept another Contributor right now. Retry after making room.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the Agent joined this Project. Contributors were checked—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<CommissionCreationIntent, undefined>({
  resourceId: commissionCreationResourceId,
  snapshot: () => undefined,
  mutate: applyCommissionCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileCommissionCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishCommissionCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueCommissionCreationRuntime = controller.enqueue
export const retryCommissionCreationRuntime = controller.retry
export const discardCommissionCreationRuntime = controller.discard
export const clearCommissionCreations = controller.clearAll
