import type { ArtifactItem } from '../../contract/index.ts'

/** The acknowledged graph gives owned creations immediate visibility before the
 * registry refetch. Both reads now include those same IDs: project each once,
 * retaining graph-first ordering/metadata and never coalescing equal names.
 * Inputs are already server-scoped; this is not an authorization filter. */
export function artifactRegistryRows(
  created: readonly ArtifactItem[],
  registry: readonly ArtifactItem[],
): ArtifactItem[] {
  const byId = new Map<string, ArtifactItem>()
  for (const row of [...created, ...registry]) {
    if (!byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()]
}
