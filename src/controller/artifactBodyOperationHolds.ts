import { useSyncExternalStore } from 'react'

/** Shared lease bit between version restore and the existing lifecycle/body
 * controllers. Kept in its own leaf module to avoid controller import cycles. */
const artifactHistoryRestoreHolds = new Set<string>()
const artifactPermanentDeletionHolds = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
const publish = () => { for (const listener of listeners) listener() }

export const isArtifactHistoryRestoreHeld = (artifactId: string): boolean => artifactHistoryRestoreHolds.has(artifactId)
export const isArtifactPermanentDeletionHeld = (artifactId: string): boolean => artifactPermanentDeletionHolds.has(artifactId)
export const useArtifactHistoryRestoreHeld = (artifactId: string): boolean => useSyncExternalStore(
  subscribe,
  () => isArtifactHistoryRestoreHeld(artifactId),
  () => false,
)
export const useArtifactPermanentDeletionHeld = (artifactId: string): boolean => useSyncExternalStore(
  subscribe,
  () => isArtifactPermanentDeletionHeld(artifactId),
  () => false,
)

export function holdArtifactHistoryRestore(artifactId: string): boolean {
  if (isArtifactPermanentDeletionHeld(artifactId)) return false
  if (!artifactHistoryRestoreHolds.has(artifactId)) {
    artifactHistoryRestoreHolds.add(artifactId)
    publish()
  }
  return true
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

/** Permanent deletion and historical restore are mutually exclusive even when
 *  their dialogs are open in different panes. The first accepted intent owns
 *  the artifact until acknowledgement or authoritative reconciliation. */
export function holdArtifactPermanentDeletion(artifactId: string): boolean {
  if (isArtifactHistoryRestoreHeld(artifactId)) return false
  if (!artifactPermanentDeletionHolds.has(artifactId)) {
    artifactPermanentDeletionHolds.add(artifactId)
    publish()
  }
  return true
}

export function releaseArtifactPermanentDeletion(artifactId: string): void {
  if (artifactPermanentDeletionHolds.delete(artifactId)) publish()
}

export function clearArtifactPermanentDeletionHolds(): void {
  if (artifactPermanentDeletionHolds.size) {
    artifactPermanentDeletionHolds.clear()
    publish()
  }
}
