/** Tiny eager facade for acknowledgement-gated manual routine execution. The
 * transport/FIFO runtime loads only after the first Run-now intent. */
import { onAccountSwitch } from '../api'
import { isScheduleDeletionHeld } from './scheduleDeletionMutations'
import { isScheduleMutationHeld } from './scheduleMutations'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore'

export const ROUTINE_RUN_ACTIVE = 'A run is already in progress'

const statusStore = createMutationStatusStore()
const heldResources = new Set<string>()
export const publishScheduleRunStatus = statusStore.publish

type Runtime = typeof import('./scheduleRunRuntime')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
let accountGeneration = 0
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./scheduleRunRuntime').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldResources.clear()
  if (runtime) runtime.clearScheduleRuns()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isScheduleRunHeld = (id: string): boolean => heldResources.has(id)

export function enqueueScheduleRun(id: string): Promise<RevisionedMutationOutcome> {
  if (isScheduleRunHeld(id) || isScheduleMutationHeld(id) || isScheduleDeletionHeld(id)) {
    return Promise.resolve('discarded')
  }
  const issuedGeneration = accountGeneration
  heldResources.add(id)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueScheduleRunRuntime(id)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldResources.delete(id)
    statusStore.refresh()
  })
  return outcome
}

export const retryScheduleRun = (): void => { runtime?.retryScheduleRunRuntime() }
export const discardScheduleRun = (): void => { runtime?.discardScheduleRunRuntime() }

export const useScheduleRunStatus = statusStore.useStatus
