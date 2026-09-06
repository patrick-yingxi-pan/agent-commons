import type { SavedContext, SavedContextsSnapshot } from '../../contract/index.ts'

const connectionRevision = (context: SavedContext): number => context.connectionRevision ?? 0

/** Accept only the connection/auth dimension of an acknowledgement. Usage and
 * descriptive fields have independent meaning and must not be rewound by a
 * delayed status response. */
export function mergeSavedContextConnection(
  current: SavedContext,
  incoming: SavedContext,
): SavedContext {
  if (connectionRevision(incoming) < connectionRevision(current)) return current
  return {
    ...current,
    status: incoming.status,
    connectionRevision: connectionRevision(incoming),
  }
}

const withDerivedConnectionIds = (contexts: SavedContext[]): SavedContextsSnapshot => ({
  contexts,
  connectedConnectorIds: contexts
    .filter((context) => context.kind === 'connector' && context.status === 'connected')
    .map((context) => context.id),
  connectedMcpIds: contexts
    .filter((context) => context.kind === 'mcp' && context.status === 'connected')
    .map((context) => context.id),
})

/** Reconcile one creation target without replacing sibling setup. An absent
 * target removes only that id; a represented target is added exactly once; and
 * a row already present keeps its descriptive/usage truth while the monotonic
 * connection dimension may advance. */
export function mergeSavedContextCreationSnapshot(
  current: SavedContextsSnapshot,
  id: string,
  incoming: SavedContext | undefined,
): SavedContextsSnapshot {
  const index = current.contexts.findIndex((context) => context.id === id)
  if (!incoming) {
    if (index < 0) return current
    return withDerivedConnectionIds(current.contexts.filter((context) => context.id !== id))
  }
  if (index < 0) return withDerivedConnectionIds([incoming, ...current.contexts])
  if (current.contexts[index]!.kind !== incoming.kind) return current
  const contexts = [...current.contexts]
  contexts[index] = mergeSavedContextConnection(contexts[index]!, incoming)
  return withDerivedConnectionIds(contexts)
}

/** Reconcile one addressed row without replacing unrelated setup or resurrecting
 * a row a newer remove acknowledgement already dropped from this cache. */
export function mergeSavedContextConnectionSnapshot(
  current: SavedContextsSnapshot,
  id: string,
  incoming: SavedContext | undefined,
): SavedContextsSnapshot {
  const index = current.contexts.findIndex((context) => context.id === id)
  if (index < 0) return current
  if (!incoming) return withDerivedConnectionIds(current.contexts.filter((context) => context.id !== id))
  const contexts = [...current.contexts]
  contexts[index] = mergeSavedContextConnection(contexts[index]!, incoming)
  return withDerivedConnectionIds(contexts)
}
