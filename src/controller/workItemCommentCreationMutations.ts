/** Eager facade for acknowledgement-owned work-item commenting. */
import { WORK_ITEM_COMMENT_MAX } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { WorkItemCommentCreationIntent } from '../api/workItemCommentCreationCommands.ts'
import { workItemCommentCreationId } from '../api/workItemCommentCreationIdentity.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

export interface WorkItemCommentCreationResult {
  outcome: RevisionedMutationOutcome
  commentId: string
}

interface HeldComment {
  intent: WorkItemCommentCreationIntent
  result: Promise<WorkItemCommentCreationResult>
}

const statusStore = createMutationStatusStore()
const heldItems = new Map<string, HeldComment>()
let accountGeneration = 0
export const publishWorkItemCommentCreationStatus = statusStore.publish

const itemKey = (projectId: string, itemId: string): string => `${projectId}\0${itemId}`

type Runtime = typeof import('./workItemCommentCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./workItemCommentCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldItems.clear()
  if (runtime) runtime.clearWorkItemCommentCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldWorkItemCommentIntent = (
  projectId: string,
  itemId: string,
): WorkItemCommentCreationIntent | null => heldItems.get(itemKey(projectId, itemId))?.intent ?? null

export function enqueueWorkItemCommentCreation(input: {
  tenantId: string
  projectId: string
  itemId: string
  body: string
}): Promise<WorkItemCommentCreationResult> {
  const key = itemKey(input.projectId, input.itemId)
  const existing = heldItems.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: WorkItemCommentCreationIntent = {
    ...input,
    body: input.body.trim().slice(0, WORK_ITEM_COMMENT_MAX),
    intentId: crypto.randomUUID(),
  }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueWorkItemCommentCreationRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([
    outcome,
    workItemCommentCreationId(input.tenantId, input.projectId, input.itemId, intent.intentId),
  ]).then(([settled, commentId]) => ({ outcome: settled, commentId }))
  heldItems.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldItems.get(key)?.result !== result) return
    heldItems.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryWorkItemCommentCreation = (): void => { runtime?.retryWorkItemCommentCreationRuntime() }
export const discardWorkItemCommentCreation = (): void => { runtime?.discardWorkItemCommentCreationRuntime() }
export const useWorkItemCommentCreationStatus = statusStore.useStatus
