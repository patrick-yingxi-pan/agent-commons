import { artifactSearchFields, parseArtifactSearchTarget, type ArtifactSearchTarget } from '../../contract/artifactSearch.ts'
import type { ArtifactContent } from '../../contract/content.ts'

/** Positions are meaningful only in the exact searched revision. This is not
 * persistent block identity and never attempts to recover a moved match. */
export function artifactSearchReveal(body: ArtifactContent, revision: number, target: ArtifactSearchTarget) {
  if (!Number.isSafeInteger(target.revision) || !parseArtifactSearchTarget(`${target.revision}/${target.field}`)) return { kind: 'missing' as const }
  if (revision !== target.revision) return { kind: 'stale' as const }
  for (const field of artifactSearchFields(body)) {
    if (field.field === target.field) return { kind: 'ready' as const, field: field.field }
  }
  return { kind: 'missing' as const }
}
