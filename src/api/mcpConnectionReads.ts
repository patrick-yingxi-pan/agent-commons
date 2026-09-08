import type {
  McpConnectionListResponse,
  McpConnectionMutationResult,
  McpConnectionRemovalResult,
  McpConnectionView,
} from '../../contract/mcpConnections.ts'
import { apiGet } from './client.ts'
import { evict, invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { onAccountSwitch } from './account.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'
import { keys, paths } from './keys.ts'

export const MCP_READ_TIMEOUT_MS = 30_000
export function mcpHttpSignal(timeoutMs = MCP_READ_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

class McpConnectionStaleResponseError extends Error {
  readonly status = 404
  constructor() {
    super('The MCP connection response was older than the current local state.')
    this.name = 'McpConnectionStaleResponseError'
  }
}

const removedRevisions = new Map<string, number>()
const knownConnectionIds = new Set<string>()
const localListGeneration = { value: 0 }
const localPresenceGeneration = new Map<string, number>()
const localPresenceViews = new Map<string, McpConnectionView>()
const cleanupPendingActs = new Set<string>()

onAccountSwitch(() => {
  removedRevisions.clear()
  cleanupPendingActs.clear()
  localListGeneration.value = 0
  localPresenceGeneration.clear()
  localPresenceViews.clear()
  evict(keys.mcpConnections)
  for (const id of knownConnectionIds) evict(keys.mcpConnection(id))
  knownConnectionIds.clear()
})

function acceptsConnection(id: string, _incomingRevision: number): boolean {
  return !removedRevisions.has(id)
}

/** Return the newest accepted projection regardless of which read funnel last
 * supplied it. Detail, list, and an acknowledged write all feed this same
 * fence; consulting only one cache key lets a delayed response rewind the
 * other key when no list query has been mounted. */
function newestKnownConnection(id: string): McpConnectionView | undefined {
  const candidates = [
    peek<McpConnectionView>(keys.mcpConnection(id)),
    peek<McpConnectionListResponse>(keys.mcpConnections)?.connections.find((connection) => connection.id === id),
    localPresenceViews.get(id),
  ].filter((connection): connection is McpConnectionView => !!connection)
  return candidates.reduce<McpConnectionView | undefined>((newest, candidate) =>
    !newest || shouldAcceptEntityRevision(newest.revision, candidate.revision) ? candidate : newest,
  undefined)
}

function mergeConnectionList(incoming: McpConnectionListResponse, requestGeneration: number): McpConnectionListResponse {
  const current = peek<McpConnectionListResponse>(keys.mcpConnections)
  const incomingIds = new Set(incoming.connections.map((connection) => connection.id))
  const connections = incoming.connections.flatMap((connection) => {
    if (!acceptsConnection(connection.id, connection.revision)) return []
    const previous = newestKnownConnection(connection.id)
    const effective = previous && !shouldAcceptEntityRevision(previous.revision, connection.revision)
      ? previous
      : connection
    localPresenceViews.set(connection.id, effective)
    return [effective]
  })
  if (current) {
    for (const cached of current.connections) {
      if (!incomingIds.has(cached.id) &&
          (localPresenceGeneration.get(cached.id) ?? -1) > requestGeneration &&
          acceptsConnection(cached.id, cached.revision)) connections.push(cached)
    }
  }
  for (const [id, connection] of localPresenceViews) {
    if (!incomingIds.has(id) && !connections.some((candidate) => candidate.id === id) &&
        (localPresenceGeneration.get(id) ?? -1) > requestGeneration && acceptsConnection(id, connection.revision)) {
      connections.push(connection)
    }
  }
  return { ...incoming, connections }
}

function setConnectionList(incoming: McpConnectionListResponse, requestGeneration: number): McpConnectionListResponse {
  for (const connection of incoming.connections) knownConnectionIds.add(connection.id)
  const merged = mergeConnectionList(incoming, requestGeneration)
  setData(keys.mcpConnections, merged)
  return merged
}

export function rememberConnection(connection: McpConnectionView): boolean {
  knownConnectionIds.add(connection.id)
  if (!acceptsConnection(connection.id, connection.revision)) return false
  localListGeneration.value += 1
  localPresenceGeneration.set(connection.id, localListGeneration.value)
  const current = newestKnownConnection(connection.id)
  const accepted = !current || shouldAcceptEntityRevision(current.revision, connection.revision)
  const effective = accepted ? connection : current!
  localPresenceViews.set(connection.id, effective)
  mutate<McpConnectionListResponse>(keys.mcpConnections, (snapshot) => snapshot
    ? {
        ...snapshot,
        connections: snapshot.connections.some((candidate) => candidate.id === connection.id)
          ? snapshot.connections.map((candidate) => candidate.id === connection.id && shouldAcceptEntityRevision(candidate.revision, effective.revision) ? effective : candidate)
          : [...snapshot.connections, effective],
      }
    : snapshot as unknown as McpConnectionListResponse)
  if (accepted) mutate<McpConnectionView>(keys.mcpConnection(connection.id), () => effective)
  if (accepted) {
    invalidate(keys.savedContexts)
    invalidatePrefix(keys.connectorDetail(connection.id))
  }
  return accepted
}

export function rememberCredentialCleanup(
  status: McpConnectionMutationResult['credentialCleanup'] | McpConnectionRemovalResult['credentialCleanup'],
): void {
  mutate<McpConnectionListResponse>(keys.mcpConnections, (snapshot) => snapshot
    ? { ...snapshot, capabilities: { ...snapshot.capabilities, credentialCleanupPending: status === 'pending' } }
    : snapshot as unknown as McpConnectionListResponse)
}

export function markCleanupPending(idempotencyKey: string): void { cleanupPendingActs.add(idempotencyKey) }
export function markCleanupComplete(idempotencyKey: string): void { cleanupPendingActs.delete(idempotencyKey) }
export function cleanupIsKnownPending(idempotencyKey: string): boolean {
  return cleanupPendingActs.has(idempotencyKey)
}
export function cleanupIsUncertain(idempotencyKey: string, cause: unknown): boolean {
  const status = (cause as { status?: number } | undefined)?.status
  return cleanupPendingActs.has(idempotencyKey) || status === undefined || ![400, 401, 403, 404, 409].includes(status)
}

export function rememberRemoval(id: string, revision: number): void {
  knownConnectionIds.add(id)
  localListGeneration.value += 1
  localPresenceGeneration.delete(id)
  localPresenceViews.delete(id)
  removedRevisions.set(id, Math.max(removedRevisions.get(id) ?? -1, revision))
  mutate<McpConnectionListResponse>(keys.mcpConnections, (snapshot) => snapshot
    ? { ...snapshot, connections: snapshot.connections.filter((candidate) => candidate.id !== id) }
    : snapshot as unknown as McpConnectionListResponse)
  evict(keys.mcpConnection(id))
  invalidate(keys.savedContexts)
  invalidate(keys.connectorDetail(id))
}

export async function listMcpConnections(): Promise<McpConnectionListResponse> {
  const requestGeneration = localListGeneration.value
  const result = await apiGet<McpConnectionListResponse>(paths.mcpConnections, { signal: mcpHttpSignal() })
  return setConnectionList(result, requestGeneration)
}

export async function getMcpConnection(id: string): Promise<McpConnectionView> {
  const result = await apiGet<McpConnectionView>(paths.mcpConnection(id), { signal: mcpHttpSignal() })
  if (result.id !== id) throw new Error('The MCP connection read addressed a different connection.')
  if (!rememberConnection(result)) {
    const current = newestKnownConnection(id)
    if (current) return current
    throw new McpConnectionStaleResponseError()
  }
  return peek<McpConnectionView>(keys.mcpConnection(id)) ?? result
}
