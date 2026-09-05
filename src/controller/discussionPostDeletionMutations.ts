/** Eager held-state facade for acknowledgement-owned discussion deletion. */
import type { DiscussionPost, SocialEntityRef } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import {
  discussionPostDeletionResourceId,
  type DiscussionPostDeletionIntent,
} from '../api/discussionPostDeletionRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface HeldDeletion {
  intent: DiscussionPostDeletionIntent
  result: Promise<RevisionedMutationOutcome>
}

const deletionKey = (discussionId: string, postId: string): string => `${discussionId}\0${postId}`
const statusStore = createMutationStatusStore()
const heldDeletions = new Map<string, HeldDeletion>()
let accountGeneration = 0
export const publishDiscussionPostDeletionStatus = statusStore.publish

type Runtime = typeof import('./discussionPostDeletionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./discussionPostDeletionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldDeletions.clear()
  if (runtime) runtime.clearDiscussionPostDeletions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueDiscussionPostDeletion(input: {
  discussionId: string
  anchor: SocialEntityRef
  post: DiscussionPost
  postIds: readonly string[]
  cascade: boolean
}): Promise<RevisionedMutationOutcome> {
  const key = deletionKey(input.discussionId, input.post.id)
  const existing = heldDeletions.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: DiscussionPostDeletionIntent = {
    ...input,
    anchor: { ...input.anchor },
    post: { ...input.post },
    postIds: [...input.postIds],
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDiscussionPostDeletionRuntime(intent)
      : 'discarded' as const,
  )
  heldDeletions.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldDeletions.get(key)?.result !== result) return
    heldDeletions.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const heldDiscussionPostDeletion = (
  discussionId: string,
  postId: string,
): DiscussionPostDeletionIntent | undefined => heldDeletions.get(deletionKey(discussionId, postId))?.intent

export const isDiscussionPostDeletionHeld = (discussionId: string): boolean =>
  [...heldDeletions.values()].some((held) => held.intent.discussionId === discussionId)

export { discussionPostDeletionResourceId }
export const retryDiscussionPostDeletion = (): void => { runtime?.retryDiscussionPostDeletionRuntime() }
export const discardDiscussionPostDeletion = (): void => { runtime?.discardDiscussionPostDeletionRuntime() }
export const useDiscussionPostDeletionStatus = statusStore.useStatus
