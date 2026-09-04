/** Eager held-state facade for acknowledgement-owned Contribution effects. */
import { onAccountSwitch } from '../api'
import type { ContributionEffectExecutionIntent } from '../api/contributionEffectExecutionCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldExecution {
  intent: ContributionEffectExecutionIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldExecutions = new Map<string, HeldExecution>()
let accountGeneration = 0
export const publishContributionEffectExecutionStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionEffectExecutionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionEffectExecutionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldExecutions.clear()
  if (runtime) runtime.clearContributionEffectExecutions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldContributionEffectExecutionIntent = (
  projectId: string,
  contributionId: string,
): ContributionEffectExecutionIntent | null =>
  heldExecutions.get(contributionKey(projectId, contributionId))?.intent ?? null

export const isContributionEffectExecutionHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldExecutions.has(contributionKey(projectId, contributionId))

export function enqueueContributionEffectExecution(input: {
  tenantId: string
  projectId: string
  contributionId: string
  lineId: string
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldExecutions.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionEffectExecutionIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionEffectExecutionRuntime(intent)
      : 'discarded' as const,
  )
  heldExecutions.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldExecutions.get(key)?.result !== result) return
    heldExecutions.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionEffectExecution = (): void => { runtime?.retryContributionEffectExecutionRuntime() }
export const discardContributionEffectExecution = (): void => { runtime?.discardContributionEffectExecutionRuntime() }
export const useContributionEffectExecutionStatus = statusStore.useStatus
