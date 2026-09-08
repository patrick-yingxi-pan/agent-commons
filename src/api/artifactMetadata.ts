import type {
  ArtifactItem,
  ArtifactMetadataPatch,
  UpdateArtifactMetadataRequest,
} from '../../contract/index.ts'
import { apiGet, apiPatch } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek } from './cache.ts'
import { keys, paths } from './keys.ts'

/** Merge only mutable metadata. A late acknowledgement must not rewind body,
 * source, filing, grant, or other fields carried by a newer registry row. */
export function mergeArtifactMetadata(current: ArtifactItem, incoming: ArtifactItem): ArtifactItem {
  const currentRevision = current.metadataRevision ?? 0
  const incomingRevision = incoming.metadataRevision ?? 0
  if (incomingRevision < currentRevision) return current
  return {
    ...current,
    name: incoming.name,
    metadataRevision: incomingRevision,
    editedAt: Math.max(current.editedAt, incoming.editedAt),
    saveOrigin: current.saveOrigin ?? incoming.saveOrigin,
  }
}

/** The canonical viewer-relative artifact row.  The detail read is deliberately
 * separate from the registry query so an open page can rebase a stale title. */
export async function getArtifactMetadata(id: string): Promise<ArtifactItem> {
  return apiGet<ArtifactItem>(paths.artifact(id))
}

/** Publish one server-acknowledged metadata row without optimistic renaming. */
export function acceptArtifactMetadata(incoming: ArtifactItem): ArtifactItem {
  const rows = peek<ArtifactItem[]>(keys.artifacts)
  if (rows) {
    mutate<ArtifactItem[]>(keys.artifacts, (currentRows) => {
      const current = currentRows?.find((row) => row.id === incoming.id)
      if (!current) return currentRows ?? []
      const merged = mergeArtifactMetadata(current, incoming)
      return currentRows!.map((row) => row.id === incoming.id ? merged : row)
    })
  }
  // Relation graph projections carry the same authored registry row; the event
  // stream will reconcile it, while this invalidation prevents a stale local
  // grouping from surviving the originating acknowledgement.
  invalidate(keys.relations)
  invalidate(keys.artifacts)
  invalidate(keys.commons)
  invalidate(keys.artifactContent)
  invalidatePrefix(keys.search())
  return incoming
}

export async function patchArtifactMetadata(
  id: string,
  patch: ArtifactMetadataPatch,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<ArtifactItem> {
  const body: UpdateArtifactMetadataRequest = { ...patch, expectedRevision }
  const updated = await apiPatch<ArtifactItem>(paths.artifact(id), body, { idempotencyKey })
  return acceptArtifactMetadata(updated)
}

/** Re-read the exact row after a conflict; no stale title is accepted. */
export async function reconcileArtifactMetadata(id: string): Promise<ArtifactItem> {
  const incoming = await getArtifactMetadata(id)
  const rows = peek<ArtifactItem[]>(keys.artifacts)
  if (!rows) invalidate(keys.artifacts)
  else acceptArtifactMetadata(incoming)
  return incoming
}
