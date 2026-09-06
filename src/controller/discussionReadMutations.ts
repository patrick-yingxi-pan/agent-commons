/** Eager held-state facade for acknowledgement-owned DM read cursors. */
import { onAccountSwitch } from '../api'
import {
  discussionReadResourceId,
  type DiscussionReadIntent,
} from '../api/discussionReadCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldRead {
  intent: DiscussionReadIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldRead>()
let accountGeneration = 0
export const publishDiscussionReadStatus = statusStore.publish

type Runtime = typeof import('./discussionReadMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./discussionReadMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  if (runtime) runtime.clearDiscussionReads()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueDiscussionRead(input: {
  tenantId: string
  discussionId: string
  throughPostId: string
}): Promise<RevisionedMutationOutcome> {
  const intent: DiscussionReadIntent = { ...input, intentId: crypto.randomUUID() }
  const resourceId = discussionReadResourceId(input.discussionId, input.throughPostId)
  const existing = held.get(resourceId)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDiscussionReadRuntime(intent)
      : 'discarded' as const,
  )
  held.set(resourceId, { intent, result })
  statusStore.refresh()
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration || held.get(resourceId)?.result !== result) return
    held.delete(resourceId)
    statusStore.refresh()
  })
  return result
}

export const heldDiscussionRead = (
  discussionId: string,
  throughPostId: string,
): DiscussionReadIntent | undefined =>
  held.get(discussionReadResourceId(discussionId, throughPostId))?.intent

export const heldDiscussionReadFor = (discussionId: string): DiscussionReadIntent | undefined => {
  for (const entry of held.values()) {
    if (entry.intent.discussionId === discussionId) return entry.intent
  }
  return undefined
}

export const retryDiscussionRead = (): void => { runtime?.retryDiscussionReadRuntime() }
export const discardDiscussionRead = (): void => { runtime?.discardDiscussionReadRuntime() }
export const useDiscussionReadStatus = statusStore.useStatus
export { discussionReadResourceId }
