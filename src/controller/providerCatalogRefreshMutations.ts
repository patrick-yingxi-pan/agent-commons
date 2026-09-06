/** Eager, account-scoped facade for acknowledgement-owned Provider catalog refresh. */
import { onAccountSwitch } from '../api'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  acquireProviderMutation,
  releaseProviderMutation,
  type ProviderMutationLease,
} from './providerMutationHolds.ts'

export interface ProviderCatalogRefreshIntent {
  readonly tenantId: string
  readonly providerId: string
  readonly expectedRevision: number
  readonly intentId: string
}

interface HeldRefresh {
  outcome: Promise<RevisionedMutationOutcome>
  lease: ProviderMutationLease
}

const statusStore = createMutationStatusStore()
const heldRefreshes = new Map<string, HeldRefresh>()
let accountGeneration = 0
export const publishProviderCatalogRefreshStatus = statusStore.publish

type Runtime = typeof import('./providerCatalogRefreshMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./providerCatalogRefreshMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  for (const held of heldRefreshes.values()) releaseProviderMutation(held.lease)
  heldRefreshes.clear()
  if (runtime) runtime.clearProviderCatalogRefreshes()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isProviderCatalogRefreshHeld = (providerId: string): boolean =>
  heldRefreshes.has(providerId)

export function enqueueProviderCatalogRefresh(input: {
  tenantId: string
  providerId: string
  expectedRevision: number
}): Promise<RevisionedMutationOutcome> | null {
  const existing = heldRefreshes.get(input.providerId)
  if (existing) return existing.outcome
  const lease = acquireProviderMutation('connection', input.providerId)
  if (!lease) return null
  const intent: ProviderCatalogRefreshIntent = { ...input, intentId: crypto.randomUUID() }
  const issuedGeneration = accountGeneration
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueProviderCatalogRefreshRuntime(intent)
      : 'discarded' as const,
  )
  heldRefreshes.set(input.providerId, { outcome, lease })
  statusStore.refresh()
  void outcome.finally(() => {
    releaseProviderMutation(lease)
    if (issuedGeneration !== accountGeneration) return
    const held = heldRefreshes.get(input.providerId)
    if (held?.outcome === outcome) heldRefreshes.delete(input.providerId)
    statusStore.refresh()
  })
  return outcome
}

export const retryProviderCatalogRefresh = (): void => { runtime?.retryProviderCatalogRefreshRuntime() }
export const discardProviderCatalogRefresh = (): void => { runtime?.discardProviderCatalogRefreshRuntime() }
export const useProviderCatalogRefreshStatus = statusStore.useStatus
