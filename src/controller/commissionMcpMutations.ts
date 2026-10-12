/** Eager, account-scoped hold for owner-reviewed Commission MCP decisions. */
import { accountGeneration, activeAccount, onAccountSwitch } from '../api/account.ts'
import { peek } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { captureSessionWriteSourceUserId } from '../api/commands.ts'
import type { Identity } from '../../contract/identity.ts'
import type { CommissionMcpDecisionRequest } from '../../contract/commissionMcpApi.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'
import {
  commissionMcpMutationStatus as status,
  heldCommissionMcpMutations as held,
  isCommissionMcpHeld,
  useCommissionMcpMutationStatus,
  type CommissionMcpHeldPresentation,
  type CommissionMcpMutationIntent,
  type HeldCommissionMcpMutation,
} from './commissionMcpMutationState.ts'
export { isCommissionMcpHeld, useCommissionMcpMutationStatus }
export type { CommissionMcpHeldPresentation, CommissionMcpMutationIntent } from './commissionMcpMutationState.ts'
let generation = 0
export const publishCommissionMcpMutationStatus = status.publish
const failures = createRuntimeLoadFailureTracker()
type Runtime = typeof import('./commissionMcpMutationRuntime.ts')
let runtime: Runtime | null = null
const load = createRetryableRuntimeLoader<Runtime>(() => import('./commissionMcpMutationRuntime.ts'), (module) => { runtime = module })

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}
function publishLoadFailure() {
  status.publish(failures.status(held.size, 'Couldn’t load the Commission MCP approval controller. Retry safely or Dismiss.'))
}
function activate(id: string, entry: HeldCommissionMcpMutation) {
  if (entry.loading || held.get(id) !== entry) return
  entry.loading = true
  status.publish({ busy: true, error: null, retryable: false, activeResourceId: id, pendingCount: held.size })
  void load().then((module) => {
    entry.loading = false
    if (entry.generation !== generation || held.get(id) !== entry) { entry.settle('discarded'); return }
    void module.enqueueCommissionMcpMutationRuntime(entry.intent).then(entry.settle)
  }, () => {
    entry.loading = false
    if (entry.generation !== generation || held.get(id) !== entry) return
    failures.fail(id)
    publishLoadFailure()
  })
}
onAccountSwitch(() => {
  generation += 1
  failures.clear()
  for (const entry of held.values()) entry.settle('discarded')
  held.clear()
  if (runtime) runtime.clearCommissionMcpMutations()
  else status.publish(IDLE_REVISIONED_MUTATION)
})

export function commissionMcpHeldDecision(id: string): CommissionMcpDecisionRequest | null {
  return held.get(id)?.intent.request ?? null
}
export function commissionMcpHeldPresentation(id: string): CommissionMcpHeldPresentation | null {
  return held.get(id)?.intent.presentation ?? null
}
export function enqueueCommissionMcpMutation(
  commissionId: string,
  request: CommissionMcpDecisionRequest,
  presentation?: CommissionMcpHeldPresentation,
): Promise<RevisionedMutationOutcome> | null {
  const sourceUserId = captureSessionWriteSourceUserId()
  if (sourceUserId === undefined) return null
  const identity = peek<Identity>(keys.me)
  if (!identity) return null
  const account = activeAccount()
  if (account && (account.userId !== identity.user.id || account.tenantId !== identity.tenant.id)) return null
  if ((identity.via === 'session' ? identity.user.id : null) !== sourceUserId) return null
  const prior = held.get(commissionId)
  if (prior) return prior.result
  const intent = deepFreeze(structuredClone({ commissionId, tenantId: identity.tenant.id, userId: identity.user.id,
    accountGeneration: accountGeneration(), request, ...(presentation ? { presentation } : {}), sourceUserId }))
  const issuedGeneration = generation
  let settle!: (value: RevisionedMutationOutcome) => void
  const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
  const entry: HeldCommissionMcpMutation = { intent, result, settle, generation: issuedGeneration, loading: false }
  held.set(commissionId, entry)
  status.refresh()
  if (!failures.active()) activate(commissionId, entry)
  void result.then(() => {
    if (issuedGeneration !== generation || held.get(commissionId) !== entry) return
    held.delete(commissionId)
    failures.remove(commissionId, held.keys())
    if (runtime) status.refresh()
    else publishLoadFailure()
  })
  return result
}
export function retryCommissionMcpMutation() {
  if (runtime) runtime.retryCommissionMcpMutationRuntime()
  else { failures.retry(); for (const [id, entry] of held) activate(id, entry) }
}
export function dismissCommissionMcpMutation() {
  if (runtime) runtime.dismissCommissionMcpMutationRuntime()
  else { const id = failures.active(); if (id) held.get(id)?.settle('discarded') }
}
export function clearCommissionMcpMutations() { runtime?.clearCommissionMcpMutations() }
