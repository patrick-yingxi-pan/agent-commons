/** Eager, account-scoped hold for owner-reviewed Routine MCP decisions. */
import { accountGeneration, activeAccount, onAccountSwitch } from '../api/account.ts'
import { peek } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { captureSessionWriteSourceUserId } from '../api/commands.ts'
import type { Identity } from '../../contract/identity.ts'
import type { RoutineMcpDecisionRequest } from '../../contract/routineMcpApi.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'

export interface RoutineMcpMutationIntent {
  routineId: string
  tenantId: string
  userId: string
  accountGeneration: number
  request: RoutineMcpDecisionRequest
  sourceUserId: string | null
}
interface Held { intent: RoutineMcpMutationIntent; result: Promise<RevisionedMutationOutcome>; settle: (value: RevisionedMutationOutcome) => void; generation: number; loading: boolean }
const status = createMutationStatusStore()
const held = new Map<string, Held>()
let generation = 0
export const publishRoutineMcpMutationStatus = status.publish
const failures = createRuntimeLoadFailureTracker()
type Runtime = typeof import('./routineMcpMutationRuntime.ts')
let runtime: Runtime | null = null
const load = createRetryableRuntimeLoader<Runtime>(() => import('./routineMcpMutationRuntime.ts'), (module) => { runtime = module })

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}
function publishLoadFailure() {
  status.publish(failures.status(held.size, 'Couldn’t load the Routine MCP approval controller. Retry safely or Dismiss.'))
}
function activate(id: string, entry: Held) {
  if (entry.loading || held.get(id) !== entry) return
  entry.loading = true
  status.publish({ busy: true, error: null, retryable: false, activeResourceId: id, pendingCount: held.size })
  void load().then((module) => {
    entry.loading = false
    if (entry.generation !== generation || held.get(id) !== entry) { entry.settle('discarded'); return }
    void module.enqueueRoutineMcpMutationRuntime(entry.intent).then(entry.settle)
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
  if (runtime) runtime.clearRoutineMcpMutations()
  else status.publish(IDLE_REVISIONED_MUTATION)
})

export const isRoutineMcpHeld = (id: string) => held.has(id)
export function routineMcpHeldDecision(id: string): RoutineMcpDecisionRequest | null {
  return held.get(id)?.intent.request ?? null
}
export function enqueueRoutineMcpMutation(routineId: string, request: RoutineMcpDecisionRequest): Promise<RevisionedMutationOutcome> | null {
  const sourceUserId = captureSessionWriteSourceUserId()
  if (sourceUserId === undefined) return null
  const identity = peek<Identity>(keys.me)
  if (!identity) return null
  const account = activeAccount()
  if (account && (account.userId !== identity.user.id || account.tenantId !== identity.tenant.id)) return null
  if ((identity.via === 'session' ? identity.user.id : null) !== sourceUserId) return null
  const prior = held.get(routineId)
  if (prior) return prior.result
  const intent = deepFreeze(structuredClone({ routineId, tenantId: identity.tenant.id, userId: identity.user.id, accountGeneration: accountGeneration(), request, sourceUserId }))
  const issuedGeneration = generation
  let settle!: (value: RevisionedMutationOutcome) => void
  const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
  const entry: Held = { intent, result, settle, generation: issuedGeneration, loading: false }
  held.set(routineId, entry)
  status.refresh()
  if (!failures.active()) activate(routineId, entry)
  void result.then(() => {
    if (issuedGeneration !== generation || held.get(routineId) !== entry) return
    held.delete(routineId)
    failures.remove(routineId, held.keys())
    if (runtime) status.refresh()
    else publishLoadFailure()
  })
  return result
}
export function retryRoutineMcpMutation() {
  if (runtime) runtime.retryRoutineMcpMutationRuntime()
  else { failures.retry(); for (const [id, entry] of held) activate(id, entry) }
}
export function dismissRoutineMcpMutation() {
  if (runtime) runtime.dismissRoutineMcpMutationRuntime()
  else { const id = failures.active(); if (id) held.get(id)?.settle('discarded') }
}
export function useRoutineMcpMutationStatus() { return status.useStatus() }
export function clearRoutineMcpMutations() { runtime?.clearRoutineMcpMutations() }
