import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import { decideRoutineMcp, getRoutineMcpReview } from '../api/routineMcpReview.ts'
import { keys } from '../api/keys.ts'
import { invalidate, peek } from '../api/cache.ts'
import { accountGeneration, activeAccount } from '../api/account.ts'
import type { Identity } from '../../contract/identity.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishRoutineMcpMutationStatus, type RoutineMcpMutationIntent } from './routineMcpMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

const DEADLINE_MS = 30_000
function assertIntentScope(intent: RoutineMcpMutationIntent): void {
  const identity = peek<Identity>(keys.me)
  const account = activeAccount()
  if (accountGeneration() !== intent.accountGeneration || !identity ||
      identity.tenant.id !== intent.tenantId || identity.user.id !== intent.userId ||
      (identity.via === 'session' ? identity.user.id : null) !== intent.sourceUserId ||
      (account && (account.tenantId !== intent.tenantId || account.userId !== intent.userId))) {
    throw new AccountSwitchedError('Routine MCP decision identity changed')
  }
}
function deadline(): AbortSignal { return AbortSignal.timeout(DEADLINE_MS) }
const controller = createAcknowledgedActionMutationController<RoutineMcpMutationIntent, number>({
  resourceId: (intent) => intent.routineId,
  snapshot: (intent) => intent.request.action === 'approve' ? intent.request.approval.expectedRevision : intent.request.expectedRevision,
  mutate: async (intent) => {
    assertIntentScope(intent)
    const response = await decideRoutineMcp(intent.routineId, intent.request, { expectedSessionUserId: intent.sourceUserId, signal: deadline() })
    assertIntentScope(intent)
    if (response.requestId !== intent.request.requestId || typeof response.decisionId !== 'string' || !response.decisionId) throw new Error('The Routine MCP acknowledgement did not identify this decision.')
    invalidate(keys.schedules)
  },
  reconcile: async (intent) => {
    assertIntentScope(intent)
    await getRoutineMcpReview(intent.routineId, intent.sourceUserId, deadline(), intent)
    assertIntentScope(intent)
    // Reconciliation deliberately does not publish its GET response directly:
    // the cache's request generation owns reads and fences crossed responses.
    // Invalidate after the authoritative read so any mounted review re-reads
    // current policy without allowing an older in-flight GET to publish.
    invalidate(keys.scheduleMcpPermission(intent.routineId))
    // A later matching policy is not proof that this exact request id committed.
    // The key-bound POST response or explicit same-key Retry is the proof.
    return false
  },
  discardReconcileFailure: 'retain',
  describeFailure: (error): RevisionedMutationFailure => {
    if (error instanceof AccountSwitchedError) return { message: 'This MCP approval belongs to the previous account. Dismiss after recovery.', retryable: false }
    if (error instanceof ApiRequestError && [400, 404, 409, 422].includes(error.status)) return { message: error.message, retryable: false }
    if (error instanceof ApiRequestError && [401, 403].includes(error.status)) return { message: 'You no longer have permission to approve MCP tools for this routine. Dismiss after an authoritative check.', retryable: false }
    return { message: 'Couldn’t confirm whether the MCP decision was saved. Retry the same request, or Dismiss after an authoritative check.', retryable: true }
  },
  setStatus: publishRoutineMcpMutationStatus,
  mintIdempotencyKey: (intent) => intent.request.requestId,
})
export const enqueueRoutineMcpMutationRuntime = controller.enqueue
export const retryRoutineMcpMutationRuntime = controller.retry
export const dismissRoutineMcpMutationRuntime = controller.discard
export const clearRoutineMcpMutations = controller.clearAll
