/** Eager, tiny held-state facade for acknowledgement-gated routine deletion.
 * The low-frequency transport/FIFO runtime loads only after the first delete. */
import { useSyncExternalStore } from 'react'
import { onAccountSwitch } from '../api'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'

export const ROUTINE_DELETE_SCOPE =
  'This permanently removes the routine and its run conversations. Artifacts it created stay.'
export const ROUTINE_MUTATION_WAIT = 'Waiting for the current routine change to finish'

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const heldResourceCounts = new Map<string, number>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}
export const publishScheduleDeletionStatus = publish

type Runtime = typeof import('./scheduleDeletionRuntime')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
let accountGeneration = 0
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./scheduleDeletionRuntime').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldResourceCounts.clear()
  if (runtime) runtime.clearScheduleDeletions()
  else publish(IDLE_REVISIONED_MUTATION)
})

export const isScheduleDeletionHeld = (id: string): boolean => (heldResourceCounts.get(id) ?? 0) > 0

export function enqueueScheduleDeletion(
  id: string,
  expectedRevision: number,
): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  heldResourceCounts.set(id, (heldResourceCounts.get(id) ?? 0) + 1)
  // The runtime may still be downloading, so publish a fresh snapshot now:
  // every visible projection must hold before transport can begin.
  publish({ ...status })
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueScheduleDeletionRuntime(id, expectedRevision)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    const remaining = (heldResourceCounts.get(id) ?? 1) - 1
    if (remaining > 0) heldResourceCounts.set(id, remaining)
    else heldResourceCounts.delete(id)
    publish({ ...status })
  })
  return outcome
}

export const retryScheduleDeletion = (): void => { runtime?.retryScheduleDeletionRuntime() }
export const discardScheduleDeletion = (): void => { runtime?.discardScheduleDeletionRuntime() }

export function useScheduleDeletionStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}
