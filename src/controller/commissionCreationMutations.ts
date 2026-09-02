/** Tiny eager facade for acknowledgement-owned Contributor commissioning. */
import type { CreateCommissionRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { CommissionCreationIntent } from '../api/commissionCreationRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, number>()
let accountGeneration = 0
export const publishCommissionCreationStatus = statusStore.publish

type Runtime = typeof import('./commissionCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./commissionCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  if (runtime) runtime.clearCommissionCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isCommissionCreationHeld = (projectId: string): boolean =>
  (heldProjects.get(projectId) ?? 0) > 0

export function enqueueCommissionCreation(input: {
  tenantId: string
  request: CreateCommissionRequest
}): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: CommissionCreationIntent = { ...input, intentId: crypto.randomUUID() }
  const projectId = input.request.projectId
  heldProjects.set(projectId, (heldProjects.get(projectId) ?? 0) + 1)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueCommissionCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = Math.max(0, (heldProjects.get(projectId) ?? 0) - 1)
    if (remaining === 0) heldProjects.delete(projectId)
    else heldProjects.set(projectId, remaining)
    statusStore.refresh()
  })
  return outcome
}

export const retryCommissionCreation = (): void => { runtime?.retryCommissionCreationRuntime() }
export const discardCommissionCreation = (): void => { runtime?.discardCommissionCreationRuntime() }
export const useCommissionCreationStatus = statusStore.useStatus
