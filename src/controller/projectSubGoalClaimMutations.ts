/** Eager held-form facade for acknowledgement-owned Project claims. */
import { onAccountSwitch } from '../api'
import type { ProjectSubGoalClaimIntent } from '../api/projectSubGoalClaimCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface HeldClaim {
  intent: ProjectSubGoalClaimIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, HeldClaim>()
let accountGeneration = 0
export const publishProjectSubGoalClaimStatus = statusStore.publish

type Runtime = typeof import('./projectSubGoalClaimMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./projectSubGoalClaimMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  if (runtime) runtime.clearProjectSubGoalClaims()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldProjectSubGoalClaimIntent = (projectId: string): ProjectSubGoalClaimIntent | null =>
  heldProjects.get(projectId)?.intent ?? null

export const isProjectSubGoalClaimScopeHeld = (projectId: string, subGoal: string): boolean =>
  heldProjects.get(projectId)?.intent.subGoal === subGoal.trim()

export function enqueueProjectSubGoalClaim(input: {
  tenantId: string
  projectId: string
  holder: string
  holderLabel: string
  subGoal: string
}): Promise<RevisionedMutationOutcome> {
  const subGoal = input.subGoal.trim()
  const existing = heldProjects.get(input.projectId)
  if (existing) {
    return existing.intent.holder === input.holder && existing.intent.subGoal === subGoal
      ? existing.result
      : Promise.resolve('discarded')
  }

  const issuedGeneration = accountGeneration
  const intent: ProjectSubGoalClaimIntent = {
    ...input,
    holderLabel: input.holderLabel.trim(),
    subGoal,
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueProjectSubGoalClaimRuntime(intent)
      : 'discarded' as const,
  )
  heldProjects.set(input.projectId, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldProjects.get(input.projectId)?.result !== result) return
    heldProjects.delete(input.projectId)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryProjectSubGoalClaim = (): void => { runtime?.retryProjectSubGoalClaimRuntime() }
export const discardProjectSubGoalClaim = (): void => { runtime?.discardProjectSubGoalClaimRuntime() }
export const useProjectSubGoalClaimStatus = statusStore.useStatus
