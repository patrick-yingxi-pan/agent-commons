/** Eager held-state facade for acknowledgement-owned sub-goal release. */
import { onAccountSwitch } from '../api'
import type { ProjectSubGoalReleaseIntent } from '../api/projectSubGoalReleaseCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldRelease {
  intent: ProjectSubGoalReleaseIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldReleases = new Map<string, HeldRelease>()
let accountGeneration = 0
export const publishProjectSubGoalReleaseStatus = statusStore.publish

type Runtime = typeof import('./projectSubGoalReleaseMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./projectSubGoalReleaseMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldReleases.clear()
  if (runtime) runtime.clearProjectSubGoalReleases()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isProjectSubGoalReleaseHeld = (reservationId: string): boolean =>
  heldReleases.has(reservationId)

export const isProjectSubGoalReleaseScopeHeld = (projectId: string, subGoal: string): boolean =>
  [...heldReleases.values()].some((held) =>
    held.intent.projectId === projectId && held.intent.subGoal === subGoal,
  )

export function enqueueProjectSubGoalRelease(input: {
  tenantId: string
  projectId: string
  reservationId: string
  subGoal: string
}): Promise<RevisionedMutationOutcome> {
  const existing = heldReleases.get(input.reservationId)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ProjectSubGoalReleaseIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueProjectSubGoalReleaseRuntime(intent)
      : 'discarded' as const,
  )
  heldReleases.set(input.reservationId, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldReleases.get(input.reservationId)?.result !== result) return
    heldReleases.delete(input.reservationId)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryProjectSubGoalRelease = (): void => { runtime?.retryProjectSubGoalReleaseRuntime() }
export const discardProjectSubGoalRelease = (): void => { runtime?.discardProjectSubGoalReleaseRuntime() }
export const useProjectSubGoalReleaseStatus = statusStore.useStatus
