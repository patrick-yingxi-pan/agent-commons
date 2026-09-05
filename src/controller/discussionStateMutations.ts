/** Eager held-state facade for acknowledgement-owned resolve/reopen. */
import type { Discussion } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import {
  discussionStateResourceId,
  type DiscussionStateIntent,
} from '../api/discussionStateRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldState {
  intent: DiscussionStateIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldStates = new Map<string, HeldState>()
let accountGeneration = 0
export const publishDiscussionStateStatus = statusStore.publish

type Runtime = typeof import('./discussionStateMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./discussionStateMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldStates.clear()
  if (runtime) runtime.clearDiscussionStates()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueDiscussionState(
  discussion: Discussion,
  state: Discussion['state'],
): Promise<RevisionedMutationOutcome> {
  const existing = heldStates.get(discussion.id)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const intent: DiscussionStateIntent = {
    discussionId: discussion.id,
    anchor: { ...discussion.anchor.ref },
    state,
    expectedStateRevision: discussion.stateRevision,
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDiscussionStateRuntime(intent)
      : 'discarded' as const,
  )
  heldStates.set(discussion.id, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldStates.get(discussion.id)?.result !== result) return
    heldStates.delete(discussion.id)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const heldDiscussionState = (discussionId: string): DiscussionStateIntent | undefined =>
  heldStates.get(discussionId)?.intent
export const isDiscussionStateHeld = (discussionId: string): boolean => heldStates.has(discussionId)

export const retryDiscussionState = (): void => { runtime?.retryDiscussionStateRuntime() }
export const discardDiscussionState = (): void => { runtime?.discardDiscussionStateRuntime() }
export const useDiscussionStateStatus = statusStore.useStatus
export { discussionStateResourceId }
