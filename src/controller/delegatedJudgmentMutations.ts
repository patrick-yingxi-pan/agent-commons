/** Held-state facade for acknowledgement-owned delegated judgment. */
import { onAccountSwitch } from '../api/account.ts'
import type { DelegatedJudgmentIntent } from '../api/delegatedJudgmentCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'

type Runtime = typeof import('./delegatedJudgmentMutationRuntime.ts')
type AccountSwitchListener = (listener: () => void) => () => void

interface HeldJudgment {
  intent: DelegatedJudgmentIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (outcome: RevisionedMutationOutcome) => void
  issuedGeneration: number
  loading: boolean
  runtimeEnqueued: boolean
}

export function createDelegatedJudgmentMutationFacade(options: {
  loadRuntime: () => Promise<Runtime>
  subscribeAccountSwitch?: AccountSwitchListener
  onStatus?: (status: RevisionedMutationStatus) => void
}) {
  const statusStore = createMutationStatusStore()
  const held = new Map<string, HeldJudgment>()
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
  const contributionKey = (projectId: string, contributionId: string): string =>
    `${projectId}\0${contributionId}`
  const publishLoadFailure = (): void => publish(loadFailures.status(
    held.size,
    'Couldn’t load delegated judgment controls. No provider request was sent. Retry this exact request or Dismiss.',
  ))

  const release = (key: string, item: HeldJudgment): void => {
    if (item.issuedGeneration !== accountGeneration || held.get(key) !== item) return
    const releasingLoadFailure = loadFailures.active() === key
    held.delete(key)
    loadFailures.remove(key, held.keys())
    if (releasingLoadFailure) loadFailures.retry()
    activateWaiting()
  }

  const activateWaiting = (): void => {
    if (runtime) {
      for (const [key, item] of held) if (!item.loading && !item.runtimeEnqueued) activate(key, item)
      if (held.size === 0) statusStore.refresh()
      return
    }
    if (loadFailures.active()) {
      publishLoadFailure()
      return
    }
    if ([...held.values()].some((item) => item.loading)) return
    const next = held.entries().next().value as [string, HeldJudgment] | undefined
    if (next) activate(next[0], next[1])
    else statusStore.refresh()
  }

  const activate = (key: string, item: HeldJudgment): void => {
    if (item.loading || held.get(key) !== item) return
    item.loading = true
    publish({
      ...IDLE_REVISIONED_MUTATION,
      busy: true,
      activeResourceId: key,
      pendingCount: held.size,
    })
    void loadRuntime().then(
      (loaded) => {
        item.loading = false
        if (item.issuedGeneration !== accountGeneration || held.get(key) !== item) {
          item.settle('discarded')
          return
        }
        item.runtimeEnqueued = true
        void loaded.enqueueDelegatedJudgmentRuntime(item.intent).then(item.settle, () => {
          if (item.issuedGeneration !== accountGeneration || held.get(key) !== item) return
          publish({
            ...IDLE_REVISIONED_MUTATION,
            error: 'Couldn’t confirm delegated judgment delivery. The exact request remains held; Retry or Dismiss after checking current work.',
            retryable: true,
            activeResourceId: key,
            pendingCount: held.size,
          })
        })
        activateWaiting()
      },
      () => {
        item.loading = false
        if (item.issuedGeneration !== accountGeneration || held.get(key) !== item) return
        loadFailures.fail(key)
        publishLoadFailure()
      },
    )
  }

  const stopAccountSwitch = (options.subscribeAccountSwitch ?? onAccountSwitch)(() => {
    accountGeneration += 1
    loadFailures.clear()
    const abandoned = [...held.values()]
    held.clear()
    for (const item of abandoned) item.settle('discarded')
    if (runtime) runtime.clearDelegatedJudgments()
    else publish(IDLE_REVISIONED_MUTATION)
  })

  const enqueue = (input: Omit<DelegatedJudgmentIntent, 'intentId'>): Promise<RevisionedMutationOutcome> => {
    const key = contributionKey(input.projectId, input.contributionId)
    const existing = held.get(key)
    if (existing) return existing.result
    const issuedGeneration = accountGeneration
    const intent: DelegatedJudgmentIntent = {
      ...input,
      escalation: [...input.escalation],
      judgment: { ...input.judgment, reviewer: { ...input.judgment.reviewer } },
      intentId: crypto.randomUUID(),
    }
    let settle!: (outcome: RevisionedMutationOutcome) => void
    const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
    const item: HeldJudgment = { intent, result, settle, issuedGeneration, loading: false, runtimeEnqueued: false }
    held.set(key, item)
    void result.then(() => release(key, item))
    if (loadFailures.active()) publishLoadFailure()
    else activateWaiting()
    return result
  }

  const retry = (): void => {
    if (runtime) {
      runtime.retryDelegatedJudgmentRuntime()
      return
    }
    const key = loadFailures.active()
    loadFailures.retry()
    if (key) activate(key, held.get(key)!)
    else for (const [candidate, item] of held) if (item.loading) activate(candidate, item)
  }

  const discard = (): void => {
    if (runtime) {
      runtime.discardDelegatedJudgmentRuntime()
      return
    }
    const key = loadFailures.active()
    if (key) held.get(key)?.settle('discarded')
  }

  return {
    enqueue,
    prepare: async (): Promise<void> => { await loadRuntime() },
    retry,
    discard,
    heldIntent: (projectId: string, contributionId: string): DelegatedJudgmentIntent | null =>
      held.get(contributionKey(projectId, contributionId))?.intent ?? null,
    isHeld: (projectId: string, contributionId: string): boolean =>
      held.has(contributionKey(projectId, contributionId)),
    useStatus: statusStore.useStatus,
    publishStatus: publish,
    dispose: stopAccountSwitch,
  }
}

const facade = createDelegatedJudgmentMutationFacade({
  loadRuntime: () => import('./delegatedJudgmentMutationRuntime.ts'),
})

export const publishDelegatedJudgmentStatus = facade.publishStatus
export const heldDelegatedJudgmentIntent = facade.heldIntent
export const isDelegatedJudgmentHeld = facade.isHeld
export const enqueueDelegatedJudgment = facade.enqueue
export const prepareDelegatedJudgmentRuntime = facade.prepare
export const retryDelegatedJudgment = facade.retry
export const discardDelegatedJudgment = facade.discard
export const useDelegatedJudgmentStatus = facade.useStatus
