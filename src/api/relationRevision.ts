import type { RelationGraph } from '../../contract/index.ts'

/** A mutation response is a full graph snapshot. Accept it only when it is at
 * least as new as the graph already projected by an ambient refetch. Missing
 * revisions are the legacy wire shape: compatible with each other, but never
 * allowed to overwrite a revisioned snapshot. */
export function shouldAcceptRelationGraph(
  current: RelationGraph | undefined,
  incoming: RelationGraph,
): boolean {
  if (!current) return true
  if (incoming.revision === undefined) return current.revision === undefined
  if (current.revision === undefined) return true
  return incoming.revision >= current.revision
}
