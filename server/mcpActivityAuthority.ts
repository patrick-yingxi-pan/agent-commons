/** Private per-activity person authority for person-owned OAuth/stdio MCP consent. This deliberately
 * lives beside persistence, not in the public Session/Message contract. */
import type { Session, ToolActivity } from '../contract/index.ts'
import type { McpConnectionState } from './mcpConnections.ts'

export interface McpActivityAuthority {
  sessionId: string
  activityId: string
  connectionId: string
  tenantId: string
  ownerUserId: string
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const shortText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)
const connectionId = (value: unknown): value is string =>
  typeof value === 'string' && /^mcp-connection-[a-f0-9]{32}$/.test(value)

export function parseMcpActivityAuthorities(value: unknown): McpActivityAuthority[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100_000) throw new Error('invalid MCP activity authorities')
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!object(entry) || Object.keys(entry).length !== 5 ||
        Object.keys(entry).some(key => !['sessionId', 'activityId', 'connectionId', 'tenantId', 'ownerUserId'].includes(key)) ||
        !shortText(entry.sessionId, 256) || !shortText(entry.activityId, 256) ||
        !connectionId(entry.connectionId) || !shortText(entry.tenantId, 256) || !shortText(entry.ownerUserId, 200)) {
      throw new Error('invalid MCP activity authority')
    }
    const row = entry as unknown as McpActivityAuthority
    const key = JSON.stringify([row.sessionId, row.activityId])
    if (seen.has(key)) throw new Error('duplicate MCP activity authority')
    seen.add(key)
    return { ...row }
  })
}

function activities(session: Session): ToolActivity[] {
  return [...(session.messages ?? []), ...(session.compactedMessages ?? [])]
    .flatMap(message => message.toolActivities ?? [])
}

/** Validate exact transcript joins. If a live or retired person-owned OAuth
 * or stdio connection is known, every matching MCP activity must have a
 * private owner anchor. */
export function validateMcpActivityAuthorities(
  authorities: McpActivityAuthority[],
  sessions: Session[],
  connections: McpConnectionState,
): boolean {
  const sessionsById = new Map<string, Session[]>()
  for (const session of sessions) sessionsById.set(session.id, [...(sessionsById.get(session.id) ?? []), session])
  const byActivity = new Map<string, McpActivityAuthority>()
  for (const authority of authorities) {
    const matches = sessionsById.get(authority.sessionId)
    if (!matches || matches.length !== 1) return false
    const session = matches[0]!
    const tenantId = authority.tenantId
    const found = activities(session).filter(activity => activity.id === authority.activityId)
    if (found.length !== 1) return false
    const activity = found[0]!
    if (!activity.mcp || activity.connectorId !== authority.connectionId || activity.kind !== 'action') return false
    const row = connections.connections.find(item => item.id === authority.connectionId && item.tenantId === tenantId)
    const retired = connections.retired.find(item => item.id === authority.connectionId && item.tenantId === tenantId)
    if (!row && !retired) return false
    if (row && ((row.transport !== 'stdio' && row.authentication !== 'device-oauth') ||
        row.ownerUserId !== authority.ownerUserId)) return false
    if (retired && retired.ownerUserId !== authority.ownerUserId) return false
    const key = JSON.stringify([authority.sessionId, authority.activityId])
    if (byActivity.has(key)) return false
    byActivity.set(key, authority)
  }

  const personOwnedIdentityById = (id: string) => [
    ...connections.connections.filter(item => item.id === id &&
      (item.transport === 'stdio' || item.authentication === 'device-oauth'))
      .map(item => ({ tenantId: item.tenantId, ownerUserId: item.ownerUserId })),
    ...connections.retired.filter(item => item.id === id &&
      (item.transport === 'stdio' || item.ownerUserId !== undefined))
      .map(item => ({ tenantId: item.tenantId, ownerUserId: item.ownerUserId! })),
  ]
  for (const session of sessions) {
    for (const activity of activities(session)) {
      if (!activity.mcp || !connectionId(activity.connectorId)) continue
      const identities = personOwnedIdentityById(activity.connectorId)
      if (identities.length === 0) continue
      if (identities.length !== 1) return false
      const authority = byActivity.get(JSON.stringify([session.id, activity.id]))
      if (!authority || authority.tenantId !== identities[0]!.tenantId || authority.ownerUserId !== identities[0]!.ownerUserId) return false
    }
  }
  return true
}
