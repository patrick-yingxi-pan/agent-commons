import type {
  ArtifactDeletionPreview,
  ArtifactDeletionRequest,
  ArtifactDeletionResult,
} from '../../contract/artifactDeletion.ts'
import { parseArtifactDeletionPreview, parseArtifactDeletionResult } from '../../contract/artifactDeletion.ts'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { TrashedArtifact } from '../../contract/artifactLifecycle.ts'
import type { RelationGraph } from '../../contract/api.ts'
import { ApiRequestError, apiDelete, apiGet } from './client.ts'
import { acceptArtifactLifecycleAbsence, getArtifactLifecycle } from './artifactLifecycle.ts'
import { evictArtifactHistory } from './artifactHistory.ts'
import { mutate } from './cache.ts'
import { keys, paths } from './keys.ts'

function requirePreview(value: unknown, artifactId: string): ArtifactDeletionPreview {
  const preview = parseArtifactDeletionPreview(value)
  if (!preview || preview.artifactId !== artifactId || preview.lifecycleRevision % 2 !== 1) {
    throw new TypeError('Artifact deletion preview did not match the requested trashed artifact.')
  }
  return preview
}

function acceptArtifactDeletionAbsence(artifactId: string): void {
  mutate<ArtifactItem[]>(keys.artifacts, (rows) => (rows ?? []).filter((row) => row.id !== artifactId))
  mutate<TrashedArtifact[]>(keys.artifactTrash, (rows) => (rows ?? []).filter((row) => row.artifact.id !== artifactId))
  mutate<RelationGraph>(keys.relations, (graph) => {
    if (!graph) return graph!
    const artifactProject = { ...graph.artifactProject }
    const artifactSource = { ...graph.artifactSource }
    delete artifactProject[artifactId]
    delete artifactSource[artifactId]
    return {
      ...graph,
      extraArtifacts: graph.extraArtifacts.filter((row) => row.id !== artifactId),
      artifactProject,
      artifactSource,
    }
  })
  mutate<Record<string, unknown>>(keys.artifactContent, (content) => {
    if (!content || !(artifactId in content)) return content!
    const next = { ...content }
    delete next[artifactId]
    return next
  })
  evictArtifactHistory(artifactId)
  acceptArtifactLifecycleAbsence(artifactId)
}

/** Read the owner-only, revision-pinned preview. The review token remains in
 *  caller memory and is never inserted into a shared cache or a held projection. */
export async function readArtifactDeletionPreview(
  artifactId: string,
  sourceUserId: string | null,
): Promise<ArtifactDeletionPreview> {
  return requirePreview(
    await apiGet<unknown>(paths.artifactDeletionPreview(artifactId), { expectedSessionUserId: sourceUserId }),
    artifactId,
  )
}

/** Send one frozen reviewed deletion and one stable idempotency key. Only the
 *  exact result schema publishes absence into the client projections. */
export async function deleteArtifactPermanently(
  artifactId: string,
  request: ArtifactDeletionRequest,
  idempotencyKey: string,
  sourceUserId: string | null,
): Promise<ArtifactDeletionResult> {
  const value = await apiDelete<unknown>(paths.artifact(artifactId), request, {
    idempotencyKey,
    expectedSessionUserId: sourceUserId,
  })
  const result = parseArtifactDeletionResult(value)
  if (!result || result.artifactId !== artifactId) {
    throw new TypeError('Artifact deletion response did not acknowledge the requested artifact.')
  }
  acceptArtifactDeletionAbsence(artifactId)
  return result
}

/** Exact authoritative absence heals a lost response; a surviving preview is
 *  not treated as success, even if its counts or name look unchanged. */
export async function reconcileArtifactPermanentDeletion(
  artifactId: string,
  sourceUserId: string | null,
): Promise<boolean> {
  try {
    await getArtifactLifecycle(artifactId, sourceUserId)
    return false
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
    acceptArtifactDeletionAbsence(artifactId)
    return true
  }
}
