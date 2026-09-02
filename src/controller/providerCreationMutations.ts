/** Tiny eager facade for acknowledgement-owned provider onboarding. */
import type { CreateProviderRequest, CreatedProvider } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { ProviderCreationIntent } from '../api/providerCreationRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

export interface ProviderCreationMutationResult {
  outcome: RevisionedMutationOutcome
  provider?: CreatedProvider
}

const statusStore = createMutationStatusStore()
let accountGeneration = 0
let heldCount = 0
export const publishProviderCreationStatus = statusStore.publish

type Runtime = typeof import('./providerCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./providerCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCount = 0
  if (runtime) runtime.clearProviderCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isProviderCreationHeld = (): boolean => heldCount > 0

export function enqueueProviderCreation(input: {
  tenantId: string
  request: CreateProviderRequest
  deviceSecret?: string
}): Promise<ProviderCreationMutationResult> {
  const issuedGeneration = accountGeneration
  const intent: ProviderCreationIntent = {
    ...input,
    intentId: crypto.randomUUID(),
  }
  heldCount += 1
  statusStore.refresh()
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueProviderCreationRuntime(intent)
      : { outcome: 'discarded' as const },
  )
  // Dismiss and account switching both release the visible intent, but neither
  // can prove a transport-aborted server request is no longer in flight. Keep
  // any uncertain provisional reference for startup reconciliation; only a
  // definitive HTTP refusal is allowed to delete it in the runtime.
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldCount = Math.max(0, heldCount - 1)
    statusStore.refresh()
  })
  return result
}

export const retryProviderCreation = (): void => { runtime?.retryProviderCreationRuntime() }
export const discardProviderCreation = (): void => { runtime?.discardProviderCreationRuntime() }
export const useProviderCreationStatus = statusStore.useStatus
