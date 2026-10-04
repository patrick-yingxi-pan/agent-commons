import type { ArtifactItem } from '../types.ts'
import type { TrashedArtifact } from '../../contract/artifactLifecycle.ts'

/** Recovery rows are navigation-only projections, never additions to the live
 * relation registry used by project references, editors or model tools. While
 * acknowledgement is uncertain, both projections preserve the reviewed side. */
export function artifactTrashProjection(
  active: readonly ArtifactItem[],
  trash: readonly TrashedArtifact[],
  held: readonly ArtifactItem[],
): { active: ArtifactItem[]; trashed: ArtifactItem[] } {
  const ids = new Set(held.map(a => a.id))
  const reviewed = held.map(({ excerpt: _excerpt, ...artifact }) => artifact)
  return {
    active: [...active.filter(a => !ids.has(a.id)), ...reviewed.filter(a => (a.lifecycleRevision ?? 0) % 2 === 0)],
    trashed: [...trash.map(row => row.artifact).filter(a => !ids.has(a.id)), ...reviewed.filter(a => (a.lifecycleRevision ?? 0) % 2 === 1)],
  }
}
