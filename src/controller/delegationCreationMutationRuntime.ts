/** Lazy transport and acknowledgement FIFO behind Delegation creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyDelegationCreation,
  reconcileDelegationCreation,
} from '../api/delegationCreationCommands.ts'
import {
  delegationCreationResourceId,
  type DelegationCreationIntent,
} from '../api/delegationCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishDelegationCreationStatus } from './delegationCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Delegation belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to delegate judgment here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409 || error.status === 429) {
      return { message: 'This Project cannot accept another Delegation right now. Make room, then Retry.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this Delegation was established. The roster was checked—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<DelegationCreationIntent, undefined>({
  resourceId: delegationCreationResourceId,
  snapshot: () => undefined,
  mutate: applyDelegationCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileDelegationCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishDelegationCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueDelegationCreationRuntime = controller.enqueue
export const retryDelegationCreationRuntime = controller.retry
export const discardDelegationCreationRuntime = controller.discard
export const clearDelegationCreations = controller.clearAll
