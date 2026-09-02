/** App wiring for revision-checked routine definition edits. */
import type { SchedulePatch, ScheduledTask } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  keys,
  onAccountSwitch,
  patchSchedule,
  peek,
  reconcileScheduleDefinition,
} from '../api'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { isScheduleDeletionHeld } from './scheduleDeletionMutations'
import { createMutationStatusStore } from './mutationStatusStore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That routine change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This routine changed elsewhere. The latest version is loaded—review it, then retry your change.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That routine change is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that routine. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many routine changes at once. Retry in a moment.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the routine change. Your request is still here—retry when the connection recovers.', retryable: true }
}

const statusStore = createMutationStatusStore()
const heldResourceCounts = new Map<string, number>()
let accountGeneration = 0

const cachedSchedule = (scheduleId: string): ScheduledTask | undefined =>
  peek<ScheduledTask[]>(keys.schedules)?.find((task) => task.id === scheduleId)

const reconcile = async (scheduleId: string): Promise<ScheduledTask> => {
  const task = await reconcileScheduleDefinition(scheduleId)
  if (!task) throw new ApiRequestError('not_found', 'That routine no longer exists.', 404)
  return task
}

const controller = createRevisionedMutationController<ScheduledTask, SchedulePatch>({
  snapshot: cachedSchedule,
  reconcile,
  revision: (task) => task.revision ?? 0,
  mutate: patchSchedule,
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => {
  accountGeneration += 1
  heldResourceCounts.clear()
  controller.clearAll()
})

export const isScheduleMutationHeld = (id: string): boolean => (heldResourceCounts.get(id) ?? 0) > 0

export function enqueueScheduleMutation(
  scheduleId: string,
  patch: SchedulePatch,
  expectedRevision?: number,
): Promise<RevisionedMutationOutcome> {
  // The rendered surfaces hold these controls, and this final seam closes the
  // race for an already-open editor: a definition write cannot start after
  // permanent deletion owns the aggregate.
  if (isScheduleDeletionHeld(scheduleId)) return Promise.resolve('discarded')
  const issuedGeneration = accountGeneration
  heldResourceCounts.set(scheduleId, (heldResourceCounts.get(scheduleId) ?? 0) + 1)
  const outcome = controller.enqueue(scheduleId, patch, expectedRevision)
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = (heldResourceCounts.get(scheduleId) ?? 1) - 1
    if (remaining > 0) heldResourceCounts.set(scheduleId, remaining)
    else heldResourceCounts.delete(scheduleId)
    statusStore.refresh()
  })
  return outcome
}

/** Intent-shaped conveniences used by the routine surfaces. Both still enter
 * the one acknowledgement-gated queue above. */
export const updateSchedule = enqueueScheduleMutation
export function toggleScheduleEnabled(
  scheduleId: string,
  enabled: boolean,
): Promise<RevisionedMutationOutcome> {
  return enqueueScheduleMutation(scheduleId, { enabled })
}

export const retryScheduleMutation = controller.retry
export const discardScheduleMutation = controller.discard

export const useScheduleMutationStatus = statusStore.useStatus
