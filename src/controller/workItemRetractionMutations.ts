/** Eager held-state facade for acknowledgement-owned work-item retraction. */
import { onAccountSwitch } from '../api'
import type { WorkItemRetractionIntent } from '../api/workItemRetractionCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

export const WORK_ITEM_RETRACTION_SCOPE =
  'This permanently closes the item unresolved. It cannot be reopened; the item and its comments remain visible as history.'

interface HeldRetraction {
  intent: WorkItemRetractionIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldItems = new Map<string, HeldRetraction>()
let accountGeneration = 0
export const publishWorkItemRetractionStatus = statusStore.publish

const itemKey = (projectId: string, itemId: string): string => `${projectId}\0${itemId}`

type Runtime = typeof import('./workItemRetractionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./workItemRetractionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldItems.clear()
  if (runtime) runtime.clearWorkItemRetractions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isWorkItemRetractionHeld = (projectId: string, itemId: string): boolean =>
  heldItems.has(itemKey(projectId, itemId))

export function enqueueWorkItemRetraction(input: {
  tenantId: string
  projectId: string
  itemId: string
}): Promise<RevisionedMutationOutcome> {
  const key = itemKey(input.projectId, input.itemId)
  const existing = heldItems.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: WorkItemRetractionIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueWorkItemRetractionRuntime(intent)
      : 'discarded' as const,
  )
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

export const retryWorkItemRetraction = (): void => { runtime?.retryWorkItemRetractionRuntime() }
export const discardWorkItemRetraction = (): void => { runtime?.discardWorkItemRetractionRuntime() }
export const useWorkItemRetractionStatus = statusStore.useStatus
