/** Durable joins, not live execution authority. Historical rows can outlive
 * membership, connection setup and the Commission itself; none can recreate
 * them. The host independently checks current membership and all execution
 * gates when a future worker admits or performs work. */
import type { Agent, Commission, OpenSubGoal } from '../contract/index.ts'
import type { McpConnectionState } from './mcpConnections.ts'
import { parseCommissionMcpRegistryState, type CommissionMcpRegistryState } from './commissionMcpRegistry.ts'
import { sameMcpPermissionJson } from './mcpPermission.ts'

export interface CommissionMcpJoinSources {
  commissions: readonly Commission[]
  agents: readonly Agent[]
  work: readonly OpenSubGoal[]
  connections: McpConnectionState
  /** Supplied by the runtime after seed/account reconciliation, not guessed by
   * the leaf format parser when a legacy canonical row lacks a tenant stamp. */
  defaultTenantId?: string
  projectIds?: ReadonlySet<string>
}

export function validateCommissionMcpRegistryJoins(value: CommissionMcpRegistryState, sources: CommissionMcpJoinSources): boolean {
  try {
    const state = parseCommissionMcpRegistryState(value)
    const commissions = new Map(sources.commissions.map(row => [row.id, row]))
    const agents = new Map(sources.agents.map(row => [row.id, row]))
    const work = new Map(sources.work.map(row => [JSON.stringify([row.projectId, row.id]), row]))
    if (commissions.size !== sources.commissions.length || agents.size !== sources.agents.length || work.size !== sources.work.length) return false
    const retired = new Map(state.retired.map(row => [row.commissionId, row]))
    const identities = new Map([...sources.connections.connections, ...sources.connections.retired]
      .map(row => [JSON.stringify([row.tenantId, row.id]), row]))
    for (const policy of state.policies) {
      const commission = commissions.get(policy.commissionId)
      const retirement = retired.get(policy.commissionId)
      if (retirement) {
        if (commission) return false
      } else {
        const agent = agents.get(policy.agentId)
        if (!commission || !agent || commission.agentId !== policy.agentId || commission.projectId !== policy.projectId) return false
        const owner = agent.tenantId ?? commission.tenantId ?? sources.defaultTenantId
        if (owner !== undefined && owner !== policy.tenantId) return false
        if (commission.tenantId !== undefined && commission.tenantId !== policy.tenantId) return false
      }
      if (sources.projectIds && !sources.projectIds.has(policy.projectId)) return false
      for (const tool of policy.policy.approval?.tools ?? []) {
        // Ownerless HTTP none/bearer connections remain tenant-owned; OAuth
        // identities must join the approver, including after disconnection or
        // removal. Stdio cannot be smuggled through a historical identity.
        const connection = identities.get(JSON.stringify([policy.tenantId, tool.connectionId]))
        if (!connection || connection.transport === 'stdio' ||
            (connection.ownerUserId !== undefined && connection.ownerUserId !== policy.ownerUserId)) return false
      }
    }
    for (const claim of state.claims) {
      const item = work.get(JSON.stringify([claim.permission.projectId, claim.work.itemId]))
      if (!item || !sameMcpPermissionJson(claim.work, { itemId: item.id, subGoal: item.subGoal,
        type: item.type, target: item.target, note: item.note ?? '' })) return false
    }
    return true
  } catch { return false }
}
