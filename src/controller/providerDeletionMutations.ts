/** Eager held-state facade for acknowledgement-owned Provider removal. */
import type { ModelProvider } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  acquireProviderMutation,
  isProviderDeletionHeld,
  releaseProviderMutation,
} from './providerMutationHolds.ts'

export const PROVIDER_DELETE_SCOPE =
  'This permanently removes the provider and its server-side connection. Conversations using it directly fall back to their Agent’s provider and lose their selected model. A Session relay disconnects immediately. Any credential stored on this device is erased after the server confirms removal. Repoint Agents first.'

const statusStore = createMutationStatusStore()
const heldSnapshots = new Map<string, ModelProvider>()
let accountGeneration = 0
export const publishProviderDeletionStatus = statusStore.publish

type Runtime = typeof import('./providerDeletionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./providerDeletionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSnapshots.clear()
  if (runtime) runtime.clearProviderDeletions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export { isProviderDeletionHeld }
export const heldProviderDeletions = (): ModelProvider[] => [...heldSnapshots.values()]

export function enqueueProviderDeletion(
  provider: ModelProvider,
): Promise<RevisionedMutationOutcome> | null {
  const lease = acquireProviderMutation('deletion', provider.id)
  if (!lease) return null
  const issuedGeneration = accountGeneration
  heldSnapshots.set(provider.id, provider)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueProviderDeletionRuntime(provider.id, {
          expectedDefinitionRevision: provider.definitionRevision ?? 0,
          expectedConnectionRevision: provider.connectionRevision ?? 0,
        })
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    releaseProviderMutation(lease)
    if (issuedGeneration !== accountGeneration) return
    heldSnapshots.delete(provider.id)
    statusStore.refresh()
  })
  return outcome
}

export const retryProviderDeletion = (): void => { runtime?.retryProviderDeletionRuntime() }
export const discardProviderDeletion = (): void => { runtime?.discardProviderDeletionRuntime() }
export const useProviderDeletionStatus = statusStore.useStatus
