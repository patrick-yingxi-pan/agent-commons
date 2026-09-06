/** Eager held-state facade for acknowledgement-owned notification triage. */
import { onAccountSwitch } from '../api'
import {
  notificationReadResourceId,
  type NotificationReadIntent,
} from '../api/notificationReadCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldRead {
  intent: NotificationReadIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldRead>()
let accountGeneration = 0
export const publishNotificationReadStatus = statusStore.publish

type Runtime = typeof import('./notificationReadMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./notificationReadMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  if (runtime) runtime.clearNotificationReads()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueNotificationRead(input: {
  tenantId: string
  ids: readonly string[]
}): Promise<RevisionedMutationOutcome> {
  const ids = [...new Set(input.ids)].sort()
  if (ids.length === 0) return Promise.resolve('applied')
  const intent: NotificationReadIntent = {
    tenantId: input.tenantId,
    ids,
    intentId: crypto.randomUUID(),
  }
  const resourceId = notificationReadResourceId(ids)
  const existing = held.get(resourceId)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueNotificationReadRuntime(intent)
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

export const heldNotificationRead = (ids: readonly string[]): NotificationReadIntent | undefined =>
  held.get(notificationReadResourceId(ids))?.intent

export const heldNotificationReadFor = (id: string): NotificationReadIntent | undefined => {
  for (const entry of held.values()) {
    if (entry.intent.ids.includes(id)) return entry.intent
  }
  return undefined
}

export const retryNotificationRead = (): void => { runtime?.retryNotificationReadRuntime() }
export const discardNotificationRead = (): void => { runtime?.discardNotificationReadRuntime() }
export const useNotificationReadStatus = statusStore.useStatus
export { notificationReadResourceId }
