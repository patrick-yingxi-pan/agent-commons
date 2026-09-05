/** Eager held-state facade for acknowledgement-owned crystallization. */
import { onAccountSwitch } from '../api'
import type { CrystallizeRequest } from '../../contract/index.ts'
import type { ContributionCrystallizationIntent } from '../api/contributionCrystallizationCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldCrystallization {
  intent: ContributionCrystallizationIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldCrystallizations = new Map<string, HeldCrystallization>()
let accountGeneration = 0
export const publishContributionCrystallizationStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionCrystallizationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionCrystallizationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCrystallizations.clear()
  if (runtime) runtime.clearContributionCrystallizations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldContributionCrystallizationIntent = (
  projectId: string,
  contributionId: string,
): ContributionCrystallizationIntent | null =>
  heldCrystallizations.get(contributionKey(projectId, contributionId))?.intent ?? null

export const isContributionCrystallizationHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldCrystallizations.has(contributionKey(projectId, contributionId))

export function enqueueContributionCrystallization(input: {
  tenantId: string
  projectId: string
  contributionId: string
  entries: CrystallizeRequest['entries']
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldCrystallizations.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionCrystallizationIntent = {
    ...input,
    entries: input.entries.map((entry) => ({ ...entry })),
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionCrystallizationRuntime(intent)
      : 'discarded' as const,
  )
  heldCrystallizations.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldCrystallizations.get(key)?.result !== result) return
    heldCrystallizations.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionCrystallization = (): void => { runtime?.retryContributionCrystallizationRuntime() }
export const discardContributionCrystallization = (): void => { runtime?.discardContributionCrystallizationRuntime() }
export const useContributionCrystallizationStatus = statusStore.useStatus
