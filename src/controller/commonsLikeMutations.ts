/** Eager held-state facade for acknowledgement-owned Commons endorsement. */
import { onAccountSwitch } from '../api'
import {
  commonsLikeResourceId,
  type CommonsLikeIntent,
} from '../api/commonsLikeCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldLike {
  intent: CommonsLikeIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldLike>()
let accountGeneration = 0
export const publishCommonsLikeStatus = statusStore.publish

type Runtime = typeof import('./commonsLikeMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./commonsLikeMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  if (runtime) runtime.clearCommonsLikes()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueCommonsLike(input: {
  tenantId: string
  itemId: string
  liked: boolean
}): Promise<RevisionedMutationOutcome> {
  const intent: CommonsLikeIntent = { ...input, intentId: crypto.randomUUID() }
  const resourceId = commonsLikeResourceId(input.itemId)
  const existing = held.get(resourceId)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueCommonsLikeRuntime(intent)
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

export const heldCommonsLike = (itemId: string): CommonsLikeIntent | undefined =>
  held.get(commonsLikeResourceId(itemId))?.intent

export const retryCommonsLike = (): void => { runtime?.retryCommonsLikeRuntime() }
export const discardCommonsLike = (): void => { runtime?.discardCommonsLikeRuntime() }
export const useCommonsLikeStatus = statusStore.useStatus
export { commonsLikeResourceId }
