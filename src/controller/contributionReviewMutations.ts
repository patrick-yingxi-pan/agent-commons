/** Eager held-state facade for acknowledgement-owned Contribution review. */
import { onAccountSwitch } from '../api/account.ts'
import type { ContributionReviewIntent } from '../api/contributionReviewCommands.ts'
import type { ContributionReviewerBinding } from '../../contract/contributionReview.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome, type RevisionedMutationStatus } from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'

type Runtime = typeof import('./contributionReviewMutationRuntime.ts')
type AccountSwitchListener = (listener: () => void) => () => void

interface HeldReview {
  intent: ContributionReviewIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (outcome: RevisionedMutationOutcome) => void
  issuedGeneration: number
  loading: boolean
}

export function createContributionReviewMutationFacade(options: {
  loadRuntime: () => Promise<Runtime>
  subscribeAccountSwitch?: AccountSwitchListener
  onStatus?: (status: RevisionedMutationStatus) => void
}) {
  const statusStore = createMutationStatusStore()
  const heldReviews = new Map<string, HeldReview>()
  const loadFailures = createRuntimeLoadFailureTracker()
  let runtime: Runtime | null = null
  let accountGeneration = 0
  const publish = (status: RevisionedMutationStatus): void => {
    statusStore.publish(status)
    options.onStatus?.(status)
  }
  const loadRuntime = createRetryableRuntimeLoader<Runtime>(options.loadRuntime, (loaded) => {
    runtime = loaded
  })
  const publishLoadFailure = (): void => publish(loadFailures.status(
    heldReviews.size,
    'Couldn’t load the review controller. No request was sent. Retry this exact review or Dismiss.',
  ))
  const contributionKey = (projectId: string, contributionId: string): string =>
    `${projectId}\0${contributionId}`

  const release = (key: string, held: HeldReview): void => {
    if (held.issuedGeneration !== accountGeneration) return
    if (heldReviews.get(key) !== held) return
    heldReviews.delete(key)
    loadFailures.remove(key, heldReviews.keys())
    if (runtime) statusStore.refresh()
    else publishLoadFailure()
  }

  const activate = (key: string, held: HeldReview): void => {
    if (held.loading || heldReviews.get(key) !== held) return
    held.loading = true
    publish({
      busy: true,
      error: null,
      retryable: false,
      activeResourceId: key,
      pendingCount: heldReviews.size,
    })
    void loadRuntime().then(
      (loaded) => {
        held.loading = false
        if (held.issuedGeneration !== accountGeneration || heldReviews.get(key) !== held) {
          held.settle('discarded')
          return
        }
        void loaded.enqueueContributionReviewRuntime(held.intent).then(held.settle)
      },
      () => {
        held.loading = false
        if (held.issuedGeneration !== accountGeneration || heldReviews.get(key) !== held) return
        loadFailures.fail(key)
        publishLoadFailure()
      },
    )
  }

  const stopAccountSwitch = (options.subscribeAccountSwitch ?? onAccountSwitch)(() => {
    accountGeneration += 1
    loadFailures.clear()
    const abandoned = [...heldReviews.values()]
    heldReviews.clear()
    for (const held of abandoned) held.settle('discarded')
    if (runtime) runtime.clearContributionReviews()
    else publish(IDLE_REVISIONED_MUTATION)
  })

  const enqueue = (input: {
    tenantId: string
    projectId: string
    contributionId: string
    expectedVersion: number
    reviewer: ContributionReviewerBinding
    reviewerLabel: string
    providerLabel: string
    modelLabel: string
    budgetLabel: string
  }): Promise<RevisionedMutationOutcome> => {
    const key = contributionKey(input.projectId, input.contributionId)
    const existing = heldReviews.get(key)
    if (existing) return existing.result

    const issuedGeneration = accountGeneration
    const intent: ContributionReviewIntent = {
      ...input,
      reviewer: { ...input.reviewer },
      intentId: crypto.randomUUID(),
    }
    let settle!: (outcome: RevisionedMutationOutcome) => void
    const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
    const held: HeldReview = { intent, result, settle, issuedGeneration, loading: false }
    heldReviews.set(key, held)
    void result.then(() => release(key, held))
    if (loadFailures.active()) publishLoadFailure()
    else {
      statusStore.refresh()
      activate(key, held)
    }
    return result
  }

  const retry = (): void => {
    if (runtime) {
      runtime.retryContributionReviewRuntime()
      return
    }
    loadFailures.retry()
    for (const [key, held] of heldReviews) activate(key, held)
  }

  const discard = (): void => {
    if (runtime) {
      runtime.discardContributionReviewRuntime()
      return
    }
    const active = loadFailures.active()
    if (active) heldReviews.get(active)?.settle('discarded')
  }

  return {
    enqueue,
    prepare: async (): Promise<void> => { await loadRuntime() },
    retry,
    discard,
    heldIntent: (projectId: string, contributionId: string): ContributionReviewIntent | null =>
      heldReviews.get(contributionKey(projectId, contributionId))?.intent ?? null,
    isHeld: (projectId: string, contributionId: string): boolean =>
      heldReviews.has(contributionKey(projectId, contributionId)),
    useStatus: statusStore.useStatus,
    publishStatus: publish,
    dispose: stopAccountSwitch,
  }
}

const facade = createContributionReviewMutationFacade({
  loadRuntime: () => import('./contributionReviewMutationRuntime.ts'),
})

export const publishContributionReviewStatus = facade.publishStatus
export const heldContributionReviewIntent = facade.heldIntent
export const isContributionReviewHeld = facade.isHeld
export const enqueueContributionReview = facade.enqueue
export const prepareContributionReviewRuntime = facade.prepare
export const retryContributionReview = facade.retry
export const discardContributionReview = facade.discard
export const useContributionReviewStatus = facade.useStatus
