import { mcpConnectionContext } from '../../contract/mcpConnections.ts'
import { useSavedContexts } from '../api/hooks.ts'
import { useMcpConnectionHeldViews } from './mcpConnectionMutations.ts'

/** Render-only retained rows. They never widen the server's attachable IDs or
 * turn a held removal into connection authority. Page and rail share this view. */
export function useContextRegistryProjection() {
  const read = useSavedContexts()
  const held = useMcpConnectionHeldViews()
  if (held.length === 0) return read
  const data = read.data ?? { contexts: [], connectedConnectorIds: [], connectedMcpIds: [] }
  const liveIds = new Set(data.contexts.map(context => context.id))
  return { ...read, data: { ...data,
    contexts: [...data.contexts, ...held.filter(connection => !liveIds.has(connection.id)).map(mcpConnectionContext)],
  } }
}
