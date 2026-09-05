/** Eager held-state facade for acknowledgement-owned delegated judgment. */
import { onAccountSwitch } from '../api'
import type { DelegatedJudgmentIntent } from '../api/delegatedJudgmentCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldJudgment {
  intent: DelegatedJudgmentIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldJudgments = new Map<string, HeldJudgment>()
let accountGeneration = 0
export const publishDelegatedJudgmentStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./delegatedJudgmentMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./delegatedJudgmentMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldJudgments.clear()
  if (runtime) runtime.clearDelegatedJudgments()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldDelegatedJudgmentIntent = (
  projectId: string,
  contributionId: string,
): DelegatedJudgmentIntent | null =>
  heldJudgments.get(contributionKey(projectId, contributionId))?.intent ?? null

export const isDelegatedJudgmentHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldJudgments.has(contributionKey(projectId, contributionId))

export function enqueueDelegatedJudgment(
  input: Omit<DelegatedJudgmentIntent, 'intentId'>,
): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldJudgments.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: DelegatedJudgmentIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDelegatedJudgmentRuntime(intent)
      : 'discarded' as const,
  )
  heldJudgments.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldJudgments.get(key)?.result !== result) return
    heldJudgments.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryDelegatedJudgment = (): void => { runtime?.retryDelegatedJudgmentRuntime() }
export const discardDelegatedJudgment = (): void => { runtime?.discardDelegatedJudgmentRuntime() }
export const useDelegatedJudgmentStatus = statusStore.useStatus
