/** Eager held-state facade for acknowledgement-owned maintainer actions. */
import { onAccountSwitch } from '../api'
import {
  adminActionResourceId,
  type AdminActionIntent,
} from '../api/adminActionCommands.ts'
import type { AdminActionTarget } from '../api/adminActionRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldAdminAction {
  intent: AdminActionIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldAdminAction>()
let accountGeneration = 0
export const publishAdminActionStatus = statusStore.publish

type Runtime = typeof import('./adminActionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./adminActionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  if (runtime) runtime.clearAdminActions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueAdminAction(
  input: AdminActionTarget & { tenantId: string },
): Promise<RevisionedMutationOutcome> {
  const intent: AdminActionIntent = { ...input, intentId: crypto.randomUUID() }
  const resourceId = adminActionResourceId(intent)
  const existing = held.get(resourceId)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAdminActionRuntime(intent)
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

export const heldAdminAction = (target: AdminActionTarget): AdminActionIntent | undefined =>
  held.get(adminActionResourceId(target))?.intent

export const retryAdminAction = (): void => { runtime?.retryAdminActionRuntime() }
export const discardAdminAction = (): void => { runtime?.discardAdminActionRuntime() }
export const useAdminActionStatus = statusStore.useStatus
export { adminActionResourceId }
export type { AdminActionTarget }
