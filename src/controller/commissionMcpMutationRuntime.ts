import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import { decideCommissionMcp, getCommissionMcpReview } from '../api/commissionMcpReview.ts'
import { keys } from '../api/keys.ts'
import { evictPrefix, invalidate, invalidatePrefix, peek } from '../api/cache.ts'
import { accountGeneration, activeAccount } from '../api/account.ts'
import type { Identity } from '../../contract/identity.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { commissionMcpMutationStatus as mutationStatus, type CommissionMcpMutationIntent } from './commissionMcpMutationState.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

const DEADLINE_MS = 30_000
function assertIntentScope(intent: CommissionMcpMutationIntent): void {
  const identity = peek<Identity>(keys.me)
  const account = activeAccount()
  if (accountGeneration() !== intent.accountGeneration || !identity || identity.tenant.id !== intent.tenantId ||
      identity.user.id !== intent.userId || (identity.via === 'session' ? identity.user.id : null) !== intent.sourceUserId ||
      (account && (account.tenantId !== intent.tenantId || account.userId !== intent.userId))) {
    throw new AccountSwitchedError('Commission MCP decision identity changed')
  }
}
function deadline(): AbortSignal { return AbortSignal.timeout(DEADLINE_MS) }
function selection(intent: CommissionMcpMutationIntent) {
  return intent.request.action === 'approve'
    ? { providerId: intent.request.approval.execution.providerId, modelId: intent.request.approval.execution.modelId }
    : undefined
}
const controller = createAcknowledgedActionMutationController<CommissionMcpMutationIntent, number>({
  resourceId: (intent) => intent.commissionId,
  snapshot: (intent) => intent.request.action === 'approve' ? intent.request.approval.expectedRevision : intent.request.expectedRevision,
  mutate: async (intent) => {
    assertIntentScope(intent)
    const response = await decideCommissionMcp(intent.commissionId, intent.request, { expectedSessionUserId: intent.sourceUserId, signal: deadline() })
    assertIntentScope(intent)
    if (response.requestId !== intent.request.requestId || !response.decisionId) throw new Error('The Commission MCP acknowledgement did not identify this decision.')
    invalidatePrefix(keys.commissionMcpPermission())
    invalidatePrefix(keys.commissions())
  },
  reconcile: async (intent) => {
    assertIntentScope(intent)
    try {
      await getCommissionMcpReview(intent.commissionId, selection(intent), intent.sourceUserId, deadline(), intent)
    } catch (error) {
      if (!(error instanceof ApiRequestError) || ![401, 403, 404].includes(error.status)) throw error
      // The privacy-preserving read denial is authoritative for availability,
      // not proof the keyed decision committed. Let explicit Dismiss release
      // local recovery while removing private cached review variants.
      assertIntentScope(intent)
      evictPrefix(keys.commissionMcpPermission())
      return false
    }
    assertIntentScope(intent)
    invalidate(keys.commissionMcpPermission(intent.commissionId, selection(intent)))
    // Only the idempotency-key-bound POST receipt proves this decision landed.
    return false
  },
  discardReconcileFailure: 'retain',
  describeFailure: (error): RevisionedMutationFailure => {
    if (error instanceof AccountSwitchedError) return { message: 'This MCP approval belongs to the previous account. Dismiss after recovery.', retryable: false }
    if (error instanceof ApiRequestError && [400, 404, 409, 422].includes(error.status)) return { message: error.message, retryable: false }
    if (error instanceof ApiRequestError && [401, 403].includes(error.status)) return { message: 'You no longer have permission to approve MCP tools for this Commission. Dismiss after an authoritative check.', retryable: false }
    return { message: 'Couldn’t confirm whether the MCP decision was saved. Retry the same request, or Dismiss after an authoritative check.', retryable: true }
  },
  setStatus: mutationStatus.publish,
  mintIdempotencyKey: (intent) => intent.request.requestId,
})
export const enqueueCommissionMcpMutationRuntime = controller.enqueue
export const retryCommissionMcpMutationRuntime = controller.retry
export const dismissCommissionMcpMutationRuntime = controller.discard
export const clearCommissionMcpMutations = controller.clearAll
