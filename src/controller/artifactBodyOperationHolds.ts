import { useSyncExternalStore } from 'react'

/** Shared lease bit between version restore and the existing lifecycle/body
 * controllers. Kept in its own leaf module to avoid controller import cycles. */
const artifactHistoryRestoreHolds = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
const publish = () => { for (const listener of listeners) listener() }

export const isArtifactHistoryRestoreHeld = (artifactId: string): boolean => artifactHistoryRestoreHolds.has(artifactId)
export const useArtifactHistoryRestoreHeld = (artifactId: string): boolean => useSyncExternalStore(
  subscribe,
  () => isArtifactHistoryRestoreHeld(artifactId),
  () => false,
)

export function holdArtifactHistoryRestore(artifactId: string): void {
  if (!artifactHistoryRestoreHolds.has(artifactId)) {
    artifactHistoryRestoreHolds.add(artifactId)
    publish()
  }
}

export function releaseArtifactHistoryRestore(artifactId: string): void {
  if (artifactHistoryRestoreHolds.delete(artifactId)) publish()
}

export function clearArtifactHistoryRestoreHolds(): void {
  if (artifactHistoryRestoreHolds.size) {
    artifactHistoryRestoreHolds.clear()
    publish()
  }
}
