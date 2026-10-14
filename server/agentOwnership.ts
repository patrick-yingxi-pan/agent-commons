/** Private historical provenance, never a public Agent field or execution grant.
 * Only authenticated creation supplies a person. Legacy/shared Agents stay unbound. */
import type { Agent } from '../contract/workers.ts'
import { isAgentCreationId } from './agentCreationIdentity.ts'
import { snapshotMcpJson } from './mcpJson.ts'

export interface AgentOwnership {
  agentId: string
  tenantId: string
  ownerUserId: string
  /** Retained after deletion so history cannot be rebound to a new person. */
  retired?: true
}
export const MAX_AGENT_OWNERSHIP_ROWS = 100_000
const invalid = (): never => { throw new Error('Invalid private Agent ownership.') }
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value)

export function parseAgentOwnership(value: unknown): AgentOwnership[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_AGENT_OWNERSHIP_ROWS) return invalid()
  const copy = snapshotMcpJson(value, { maxBytes: 96 * 1_048_576, maxDepth: 3, maxNodes: 600_001 })
  if (!Array.isArray(copy)) return invalid()
  const seen = new Set<string>()
  return copy.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).some(key => !['agentId', 'tenantId', 'ownerUserId', 'retired'].includes(key)) ||
        !identifier(row.agentId) || !identifier(row.tenantId) || !identifier(row.ownerUserId) ||
        (Object.hasOwn(row, 'retired') && row.retired !== true) || seen.has(row.agentId)) return invalid()
    seen.add(row.agentId)
    return { agentId: row.agentId, tenantId: row.tenantId, ownerUserId: row.ownerUserId,
      ...(row.retired === true ? { retired: true as const } : {}) }
  })
}

/** Structural joins, not authentication or backup anti-tampering. Membership
 * withdrawal/deactivation must not erase historical ownership. Live permission
 * is rechecked separately by the host, including after asynchronous waits. */
export function validateAgentOwnershipJoins(rows: AgentOwnership[], source: {
  agents?: [string, Pick<Agent, 'id' | 'tenantId'>][]
  retiredAgentCreationIds?: string[]
  accountUsers?: [string, { id: string }][]
  accountTenants?: [string, { id: string }][]
}): boolean {
  if (rows.length === 0) return true
  const index = <T extends { id: string }>(entries: [string, T][]) => {
    const result = new Map<string, T>()
    for (const [id, row] of entries) {
      if (id !== row.id || result.has(id)) return invalid()
      result.set(id, row)
    }
    return result
  }
  const agents = index(source.agents ?? [])
  const users = index(source.accountUsers ?? [])
  const tenants = index(source.accountTenants ?? [])
  const retired = new Set(source.retiredAgentCreationIds ?? [])
  for (const row of rows) {
    if (!users.has(row.ownerUserId) || !tenants.has(row.tenantId)) return false
    const agent = agents.get(row.agentId)
    if (row.retired) {
      if (agent || (isAgentCreationId(row.agentId) && !retired.has(row.agentId))) return false
    } else if (!agent || agent.tenantId !== row.tenantId || retired.has(row.agentId)) return false
  }
  return true
}

export class AgentOwnershipRegistry {
  private rows = new Map<string, AgentOwnership>()
  snapshot(): AgentOwnership[] { return [...this.rows.values()].map(row => ({ ...row })) }
  rehydrate(value: unknown): void {
    const rows = parseAgentOwnership(value)
    this.rows = new Map(rows.map(row => [row.agentId, row]))
  }
  get(agentId: string): AgentOwnership | undefined {
    const row = this.rows.get(agentId)
    return row && { ...row }
  }
  prepare(input: Omit<AgentOwnership, 'retired'>): AgentOwnership {
    const [row] = parseAgentOwnership([input])
    if (!row || row.retired || this.rows.has(row.agentId) || this.rows.size >= MAX_AGENT_OWNERSHIP_ROWS) invalid()
    return row
  }
  bind(input: Omit<AgentOwnership, 'retired'>): void {
    const row = this.prepare(input)
    this.rows.set(row.agentId, row)
  }
  retire(agentId: string): void {
    const row = this.rows.get(agentId)
    if (row) this.rows.set(agentId, { ...row, retired: true })
  }
}
