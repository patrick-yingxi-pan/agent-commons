/** Eager held-state facade for acknowledgement-owned review requirement. */
import { onAccountSwitch } from '../api'
import type { ContributionReviewRequirementIntent } from '../api/contributionReviewRequirementCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldRequirement {
  intent: ContributionReviewRequirementIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldRequirements = new Map<string, HeldRequirement>()
let accountGeneration = 0
export const publishContributionReviewRequirementStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionReviewRequirementMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionReviewRequirementMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldRequirements.clear()
  if (runtime) runtime.clearContributionReviewRequirements()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isContributionReviewRequirementHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldRequirements.has(contributionKey(projectId, contributionId))

export function enqueueContributionReviewRequirement(input: {
  tenantId: string
  projectId: string
  contributionId: string
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldRequirements.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionReviewRequirementIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionReviewRequirementRuntime(intent)
      : 'discarded' as const,
  )
  heldRequirements.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldRequirements.get(key)?.result !== result) return
    heldRequirements.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionReviewRequirement = (): void => { runtime?.retryContributionReviewRequirementRuntime() }
export const discardContributionReviewRequirement = (): void => { runtime?.discardContributionReviewRequirementRuntime() }
export const useContributionReviewRequirementStatus = statusStore.useStatus
