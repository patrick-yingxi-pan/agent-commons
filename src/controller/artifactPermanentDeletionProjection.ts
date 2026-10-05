import { useSyncExternalStore } from 'react'
import type { ArtifactItem } from '../../contract/cowork.ts'

// A deliberately tiny leaf for artifact-list/detail consumers. The full
// acknowledgement queue remains deferred; only its display-only held row
// crosses into the section/rail bundles.
const rows = new Map<string, ArtifactItem>()
const listeners = new Set<() => void>()
const EMPTY: readonly ArtifactItem[] = []
let snapshot: readonly ArtifactItem[] = []

function publish(): void {
  snapshot = [...rows.values()]
  for (const listener of listeners) listener()
}

export function holdArtifactPermanentDeletionRow(artifact: ArtifactItem): void {
  rows.set(artifact.id, artifact)
  publish()
}

export function releaseArtifactPermanentDeletionRow(artifactId: string): void {
  if (rows.delete(artifactId)) publish()
}

export function clearArtifactPermanentDeletionRows(): void {
  if (rows.size) {
    rows.clear()
    publish()
  }
}

export function heldArtifactPermanentDeletionRow(artifactId: string): ArtifactItem | undefined {
  return rows.get(artifactId)
}

export function heldArtifactPermanentDeletionRows(): readonly ArtifactItem[] {
  return snapshot
}

export function useArtifactPermanentDeletionRows(): readonly ArtifactItem[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => snapshot,
    () => EMPTY,
  )
}
