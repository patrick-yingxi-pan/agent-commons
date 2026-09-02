/** Tiny eager facade for acknowledgement-gated routine creation. */
import { onAccountSwitch } from '../api'
import type { ScheduledTask } from '../../contract/index.ts'
import type { ScheduleCreationIntent } from '../api/scheduleCreationCommands'
import { scheduleCreationId } from '../api/scheduleCreationIdentity'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore'

export interface ScheduleCreationResult {
  outcome: RevisionedMutationOutcome
  taskId: string
}

const statusStore = createMutationStatusStore()
let heldCount = 0
let accountGeneration = 0
export const publishScheduleCreationStatus = statusStore.publish

type Runtime = typeof import('./scheduleCreationMutationRuntime')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./scheduleCreationMutationRuntime').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCount = 0
  if (runtime) runtime.clearScheduleCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isScheduleCreationHeld = (): boolean => heldCount > 0

export function enqueueScheduleCreation(input: {
  tenantId: string
  seed: Omit<ScheduledTask, 'id'>
}): Promise<ScheduleCreationResult> {
  const issuedGeneration = accountGeneration
  const intent: ScheduleCreationIntent = { ...input, intentId: crypto.randomUUID() }
  const taskId = scheduleCreationId(intent.tenantId, intent.intentId)
  heldCount += 1
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueScheduleCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldCount = Math.max(0, heldCount - 1)
    statusStore.refresh()
  })
  return Promise.all([outcome, taskId]).then(([settled, id]) => ({ outcome: settled, taskId: id }))
}

export const retryScheduleCreation = (): void => { runtime?.retryScheduleCreationRuntime() }
export const discardScheduleCreation = (): void => { runtime?.discardScheduleCreationRuntime() }
export const useScheduleCreationStatus = statusStore.useStatus
