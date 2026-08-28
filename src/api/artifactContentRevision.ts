import type { ArtifactContent } from '../../contract/index.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

/** An artifact body is one revisioned value: when the incoming body is current,
 * replace it whole; an older acknowledgement cannot rewind a newer projection. */
export function mergeArtifactContent(
  current: ArtifactContent,
  incoming: ArtifactContent,
): ArtifactContent {
  return shouldAcceptEntityRevision(current.revision, incoming.revision) ? incoming : current
}
