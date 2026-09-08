/** Acknowledged graph rows appear immediately before the complete registry
 * refetch. Both reads may contain the same opaque ID: project it once, keeping
 * graph-first ordering and metadata. Equal display names remain independent.
 * Inputs are already server-scoped; this is not an authorization filter. */
export function registryRows<T extends { id: string }>(
  acknowledged: readonly T[],
  registry: readonly T[],
): T[] {
  const byId = new Map<string, T>()
  for (const row of [...acknowledged, ...registry]) {
    if (!byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()]
}
