import type { ArtifactItem } from './cowork.ts'
import type { StructuredArtifactBody } from './artifactAuthoring.ts'
import type { RelationGraph } from './api.ts'

/** Direct human/remote artifact authoring. Identity is never supplied in the
 * body: one required Idempotency-Key and the authenticated tenant derive it. */
export interface CreateArtifactRequest {
  name: string
  kind: 'doc' | 'sheet' | 'slide'
  body: string | StructuredArtifactBody
  /** Absent or null means Unfiled; a string must name an owned Project. */
  projectId?: string | null
}

/** Exact created row plus the revisioned graph projection that owns filing. */
export interface CreateArtifactResponse {
  artifact: ArtifactItem
  graph: RelationGraph
}

/** Opaque persisted identity schema shared by server admission and browser
 * reconciliation. The digest itself is derived in platform-specific modules. */
export const ARTIFACT_CREATION_ID_PREFIX = 'artifact-new-'
export const ARTIFACT_CREATION_ID_PATTERN = /^artifact-new-[a-f0-9]{24}$/

export function isArtifactCreationId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_CREATION_ID_PATTERN.test(value)
}
