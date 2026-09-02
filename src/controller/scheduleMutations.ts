/** App wiring for revision-checked routine definition edits. */
import { useSyncExternalStore } from 'react'
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
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'
import { isScheduleDeletionHeld } from './scheduleDeletionMutations'

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

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const heldResourceCounts = new Map<string, number>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

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
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => {
  heldResourceCounts.clear()
  controller.clearAll()
})

export const isScheduleMutationHeld = (id: string): boolean => (heldResourceCounts.get(id) ?? 0) > 0

export function enqueueScheduleMutation(
  scheduleId: string,
  patch: SchedulePatch,
): Promise<RevisionedMutationOutcome> {
  // The rendered surfaces hold these controls, and this final seam closes the
  // race for an already-open editor: a definition write cannot start after
  // permanent deletion owns the aggregate.
  if (isScheduleDeletionHeld(scheduleId)) return Promise.resolve('discarded')
  heldResourceCounts.set(scheduleId, (heldResourceCounts.get(scheduleId) ?? 0) + 1)
  const outcome = controller.enqueue(scheduleId, patch)
  void outcome.finally(() => {
    const remaining = (heldResourceCounts.get(scheduleId) ?? 1) - 1
    if (remaining > 0) heldResourceCounts.set(scheduleId, remaining)
    else heldResourceCounts.delete(scheduleId)
    publish(status)
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

export function useScheduleMutationStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}
