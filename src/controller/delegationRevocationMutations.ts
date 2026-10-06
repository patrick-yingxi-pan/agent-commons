/** Eager held-state facade for acknowledgement-owned Delegation revocation. */
import type { Delegation } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { IDLE_REVISIONED_MUTATION } from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

const statusStore = createMutationStatusStore()
const heldSnapshots = new Map<string, Delegation>()
let accountGeneration = 0
export const publishDelegationRevocationStatus = statusStore.publish

type Runtime = typeof import('./delegationRevocationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./delegationRevocationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSnapshots.clear()
  if (runtime) runtime.clearDelegationRevocations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isDelegationRevocationHeld = (delegationId: string): boolean =>
  heldSnapshots.has(delegationId)

/** Keep a row visible when SSE observes the committed absence before the
 * originating response or reconciliation settles. */
export const heldDelegationRevocations = (projectId: string): Delegation[] =>
  [...heldSnapshots.values()].filter((delegation) => delegation.projectId === projectId)

export function enqueueDelegationRevocation(
  delegation: Delegation,
): Promise<RevisionedMutationOutcome> {
  if (heldSnapshots.has(delegation.id)) return Promise.resolve('discarded')
  const issuedGeneration = accountGeneration
  heldSnapshots.set(delegation.id, delegation)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDelegationRevocationRuntime(
        delegation.id,
        delegation.projectId,
        delegation.createdAt,
        delegation.revision ?? 0,
      )
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldSnapshots.delete(delegation.id)
    statusStore.refresh()
  })
  return outcome
}

export const retryDelegationRevocation = (): void => { runtime?.retryDelegationRevocationRuntime() }
export const discardDelegationRevocation = (): void => { runtime?.discardDelegationRevocationRuntime() }
export const useDelegationRevocationStatus = statusStore.useStatus
