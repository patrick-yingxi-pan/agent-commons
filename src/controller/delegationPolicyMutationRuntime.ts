/** Lazy acknowledgement FIFO behind Delegation policy edits. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import { applyDelegationPolicy, reconcileDelegationPolicy } from '../api/delegationPolicyCommands.ts'
import { delegationPolicyResourceId, type DelegationPolicyIntent } from '../api/delegationPolicyRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishDelegationPolicyStatus } from './delegationPolicyMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That policy edit belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: `${error.message} Your draft is preserved. Dismiss to close this request, then follow the server’s guidance above.`,
        retryable: false,
      }
    }
    if ([400, 404].includes(error.status)) return { message: error.message, retryable: false }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to edit this Delegation. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Delegation changes are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this policy version saved. Retry the exact reviewed request or Dismiss after checking the current policy.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<DelegationPolicyIntent, undefined>({
  resourceId: delegationPolicyResourceId,
  snapshot: () => undefined,
  mutate: applyDelegationPolicy,
  reconcile: (intent) => reconcileDelegationPolicy(intent),
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: publishDelegationPolicyStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueDelegationPolicyRuntime = controller.enqueue
export const retryDelegationPolicyRuntime = controller.retry
export const discardDelegationPolicyRuntime = controller.discard
export const clearDelegationPolicies = controller.clearAll
