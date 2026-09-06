import { useSyncExternalStore } from 'react'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'

/** One external-store spine for acknowledgement controllers. Each caller owns
 * an isolated instance while subscription/publish mechanics compile once. */
export function createMutationStatusStore() {
  let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
  const listeners = new Set<() => void>()
  const publish = (next: RevisionedMutationStatus): void => {
    status = next
    for (const listener of listeners) listener()
  }
  const refresh = (): void => publish({ ...status })
  const useStatus = (): RevisionedMutationStatus => useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
  return { publish, refresh, useStatus }
}
