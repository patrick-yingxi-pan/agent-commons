/** Tiny eager facade for acknowledgement-owned Delegation creation. */
import type { CreateDelegationRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { DelegationCreationIntent } from '../api/delegationCreationRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, number>()
let accountGeneration = 0
export const publishDelegationCreationStatus = statusStore.publish

type Runtime = typeof import('./delegationCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./delegationCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  if (runtime) runtime.clearDelegationCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isDelegationCreationHeld = (projectId: string): boolean =>
  (heldProjects.get(projectId) ?? 0) > 0

export function enqueueDelegationCreation(input: {
  tenantId: string
  projectId: string
  request: CreateDelegationRequest
}): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: DelegationCreationIntent = { ...input, intentId: crypto.randomUUID() }
  heldProjects.set(input.projectId, (heldProjects.get(input.projectId) ?? 0) + 1)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDelegationCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = Math.max(0, (heldProjects.get(input.projectId) ?? 0) - 1)
    if (remaining === 0) heldProjects.delete(input.projectId)
    else heldProjects.set(input.projectId, remaining)
    statusStore.refresh()
  })
  return outcome
}

export const retryDelegationCreation = (): void => { runtime?.retryDelegationCreationRuntime() }
export const discardDelegationCreation = (): void => { runtime?.discardDelegationCreationRuntime() }
export const useDelegationCreationStatus = statusStore.useStatus
