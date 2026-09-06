/** Eager, account-scoped facade for write-only Provider connection changes. */
import { onAccountSwitch } from '../api'
import type { ProviderConnectionAttempt } from './providerConnectionCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  acquireProviderMutation,
  isProviderConnectionHeld,
  releaseProviderMutation,
  type ProviderMutationLease,
} from './providerMutationHolds.ts'

export interface ProviderConnectionIntent {
  readonly tenantId: string
  readonly providerId: string
  readonly attempt: ProviderConnectionAttempt
}

interface HeldConnection {
  outcome: Promise<RevisionedMutationOutcome>
  lease: ProviderMutationLease
}

const statusStore = createMutationStatusStore()
const heldConnections = new Map<string, HeldConnection>()
let accountGeneration = 0
export const publishProviderConnectionStatus = statusStore.publish

type Runtime = typeof import('./providerConnectionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./providerConnectionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  for (const held of heldConnections.values()) releaseProviderMutation(held.lease)
  heldConnections.clear()
  if (runtime) runtime.clearProviderConnections()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export { createProviderConnectionAttempt } from './providerConnectionCore.ts'
export { isProviderConnectionHeld }

export function enqueueProviderConnection(
  intent: ProviderConnectionIntent,
): Promise<RevisionedMutationOutcome> | null {
  const existing = heldConnections.get(intent.providerId)
  if (existing) return existing.outcome
  const lease = acquireProviderMutation('connection', intent.providerId)
  if (!lease) return null
  const issuedGeneration = accountGeneration
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueProviderConnectionRuntime(intent)
      : 'discarded' as const,
  )
  heldConnections.set(intent.providerId, { outcome, lease })
  statusStore.refresh()
  void outcome.finally(() => {
    releaseProviderMutation(lease)
    if (issuedGeneration !== accountGeneration) return
    const held = heldConnections.get(intent.providerId)
    if (held?.outcome === outcome) heldConnections.delete(intent.providerId)
    statusStore.refresh()
  })
  return outcome
}

export const retryProviderConnection = (): void => { runtime?.retryProviderConnectionRuntime() }
export const discardProviderConnection = (): void => { runtime?.discardProviderConnectionRuntime() }
export const useProviderConnectionStatus = statusStore.useStatus
