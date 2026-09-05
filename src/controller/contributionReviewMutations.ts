/** Eager held-state facade for acknowledgement-owned Contribution review. */
import { onAccountSwitch } from '../api'
import type { ContributionReviewIntent } from '../api/contributionReviewCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldReview {
  intent: ContributionReviewIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldReviews = new Map<string, HeldReview>()
let accountGeneration = 0
export const publishContributionReviewStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionReviewMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionReviewMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldReviews.clear()
  if (runtime) runtime.clearContributionReviews()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldContributionReviewIntent = (
  projectId: string,
  contributionId: string,
): ContributionReviewIntent | null =>
  heldReviews.get(contributionKey(projectId, contributionId))?.intent ?? null

export const isContributionReviewHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldReviews.has(contributionKey(projectId, contributionId))

export function enqueueContributionReview(input: {
  tenantId: string
  projectId: string
  contributionId: string
  reviewedVersion: number
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldReviews.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionReviewIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionReviewRuntime(intent)
      : 'discarded' as const,
  )
  heldReviews.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldReviews.get(key)?.result !== result) return
    heldReviews.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionReview = (): void => { runtime?.retryContributionReviewRuntime() }
export const discardContributionReview = (): void => { runtime?.discardContributionReviewRuntime() }
export const useContributionReviewStatus = statusStore.useStatus
