/** Eager held-state facade for acknowledgement-owned Contribution landing. */
import { onAccountSwitch } from '../api'
import type { ContributionLandingIntent } from '../api/contributionLandingCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldLanding {
  intent: ContributionLandingIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldLandings = new Map<string, HeldLanding>()
let accountGeneration = 0
export const publishContributionLandingStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionLandingMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionLandingMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldLandings.clear()
  if (runtime) runtime.clearContributionLandings()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isContributionLandingHeld = (projectId: string, contributionId: string): boolean =>
  heldLandings.has(contributionKey(projectId, contributionId))

export function enqueueContributionLanding(input: {
  tenantId: string
  projectId: string
  contributionId: string
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldLandings.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionLandingIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionLandingRuntime(intent)
      : 'discarded' as const,
  )
  heldLandings.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldLandings.get(key)?.result !== result) return
    heldLandings.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionLanding = (): void => { runtime?.retryContributionLandingRuntime() }
export const discardContributionLanding = (): void => { runtime?.discardContributionLandingRuntime() }
export const useContributionLandingStatus = statusStore.useStatus
