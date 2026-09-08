import type { ArtifactItem } from './cowork.ts'

export interface ArtifactMetadataPatch {
  name: string
}

export interface UpdateArtifactMetadataRequest extends ArtifactMetadataPatch {
  expectedRevision: number
}

export interface ArtifactMetadata {
  name: string
  revision: number
  editedAt: number
}

const MAX_ARTIFACT_NAME_CODE_POINTS = 240
const FORBIDDEN_NAME_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0001}]/u

/** Normalize only the boundary whitespace; filenames are not otherwise rewritten. */
export function normalizeArtifactName(value: unknown): string | undefined {
  if (typeof value !== 'string' || FORBIDDEN_NAME_CONTROLS.test(value)) return undefined
  const name = value.trim()
  if (!name || Array.from(name).length > MAX_ARTIFACT_NAME_CODE_POINTS) return undefined
  return name
}

/** Project mutable display metadata without changing the artifact's identity or source. */
export function projectArtifactMetadata(
  raw: ArtifactItem,
  metadata?: ArtifactMetadata,
): ArtifactItem {
  const projected = {
    ...raw,
    name: metadata?.name ?? raw.name,
    metadataRevision: metadata?.revision ?? raw.metadataRevision ?? 0,
    editedAt: Math.max(raw.editedAt, metadata?.editedAt ?? 0),
    saveOrigin: raw.saveOrigin ?? { name: raw.name, source: raw.source },
  }
  return projected
}
