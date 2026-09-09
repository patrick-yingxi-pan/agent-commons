import type { ArtifactContent, StructuredArtifactContentPatch, UpdateStructuredArtifactContentRequest } from '../../contract/index.ts'
import { apiPatch } from './client.ts'
import { paths } from './keys.ts'
import { acceptArtifactContent } from './commands.ts'

/** Same product content door and monotonic acknowledgement funnel as prose.
 * The controller supplies the reviewed revision and stable logical retry key. */
export async function patchStructuredArtifactContent(id: string, patch: StructuredArtifactContentPatch, expectedRevision: number, idempotencyKey: string): Promise<ArtifactContent> {
  const request: UpdateStructuredArtifactContentRequest = { ...patch, expectedRevision }
  const updated = await apiPatch<ArtifactContent>(paths.artifactContentEdit(id), request, { idempotencyKey })
  return acceptArtifactContent(id, updated)
}
