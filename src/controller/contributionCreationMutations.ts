/** Tiny eager facade for acknowledgement-owned Contribution creation. */
import type { OpenContributionRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { contributionCreationId } from '../api/contributionCreationIdentity.ts'
import type { ContributionCreationIntent } from '../api/contributionCreationRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, number>()
let accountGeneration = 0
export const publishContributionCreationStatus = statusStore.publish

type Runtime = typeof import('./contributionCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  if (runtime) runtime.clearContributionCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isContributionCreationHeld = (projectId: string): boolean =>
  (heldProjects.get(projectId) ?? 0) > 0

export interface ContributionCreationResult {
  outcome: RevisionedMutationOutcome
  contributionId: string
}

export function enqueueContributionCreation(input: {
  tenantId: string
  projectId: string
  request: OpenContributionRequest
}): Promise<ContributionCreationResult> {
  const issuedGeneration = accountGeneration
  const intent: ContributionCreationIntent = { ...input, intentId: crypto.randomUUID() }
  heldProjects.set(input.projectId, (heldProjects.get(input.projectId) ?? 0) + 1)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionCreationRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([
    outcome,
    contributionCreationId(input.tenantId, input.projectId, intent.intentId),
  ]).then(([settled, contributionId]) => ({ outcome: settled, contributionId }))
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = Math.max(0, (heldProjects.get(input.projectId) ?? 0) - 1)
    if (remaining === 0) heldProjects.delete(input.projectId)
    else heldProjects.set(input.projectId, remaining)
    statusStore.refresh()
  })
  return result
}

export const retryContributionCreation = (): void => { runtime?.retryContributionCreationRuntime() }
export const discardContributionCreation = (): void => { runtime?.discardContributionCreationRuntime() }
export const useContributionCreationStatus = statusStore.useStatus
