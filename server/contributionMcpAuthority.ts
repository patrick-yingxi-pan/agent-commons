/** Private Contribution person authority joins. OAuth ownership comes only from
 * an exact live connection or its retained retirement identity; a tenant never
 * supplies a missing person. Legacy MCP calls retain their tenant-only shape. */
import type { McpConnectionState } from './mcpConnections.ts'
import type { StoredContribution, StoredContributionEvent } from './persistence/format.ts'

function connectionIdentity(connections: McpConnectionState, tenantId: string | undefined, connectionId: string) {
  return connections.connections.find(row => row.tenantId === tenantId && row.id === connectionId) ??
    connections.retired.find(row => row.tenantId === tenantId && row.id === connectionId)
}

function knownOAuthIdentity(connections: McpConnectionState, connectionId: string): boolean {
  return connections.connections.some(row => row.id === connectionId && row.authentication === 'device-oauth') ||
    connections.retired.some(row => row.id === connectionId && row.ownerUserId !== undefined)
}

/** Classify admitted proposal replay from its durable private stamp. Registry
 * loss can invalidate a restore, but can never turn OAuth into legacy replay. */
export function contributionMcpProposalOwner(event: StoredContributionEvent): string | undefined {
  return event.envelopeProposalOwnerUserId
}

function matchesConnectionOwner(
  connections: McpConnectionState,
  tenantId: string | undefined,
  connectionId: string,
  ownerUserId: string | undefined,
): boolean {
  const identity = connectionIdentity(connections, tenantId, connectionId)
  if (identity) return identity.ownerUserId === ownerUserId
  // Legacy tenant-only history may omit the connection slice. Person-bound
  // history must retain a live or retired identity, including across tenants.
  return ownerUserId === undefined && !knownOAuthIdentity(connections, connectionId)
}

function matchesProposalOwner(proposal: StoredContributionEvent | undefined, ownerUserId: string): boolean {
  return proposal?.principal?.kind === 'user' && proposal.principal.id === ownerUserId
}

/** Called after strict leaf admission. Historical proposal events participate
 * even after their current envelope has been replaced or has no attempts. */
export function validateContributionMcpAuthorities(
  contributions: StoredContribution[],
  connections: McpConnectionState,
): boolean {
  for (const contribution of contributions) {
    const proposals = (contribution.events ?? []).filter(event => event.kind === 'envelope-proposed')
    for (const proposal of proposals) {
      const proposalOwner = contributionMcpProposalOwner(proposal)
      if (proposalOwner !== undefined && !matchesProposalOwner(proposal, proposalOwner)) return false
      let hasOAuthSelection = false
      for (const line of proposal.envelopeProposalLines ?? []) {
        if (!line.mcp) continue
        const identity = connectionIdentity(connections, proposal.proposedByTenant, line.mcp.connectionId)
        if (!identity) {
          if (proposalOwner !== undefined || knownOAuthIdentity(connections, line.mcp.connectionId)) return false
          continue
        }
        if (identity.ownerUserId !== undefined) {
          hasOAuthSelection = true
          if (identity.ownerUserId !== proposalOwner) return false
        }
      }
      if (proposalOwner !== undefined && !hasOAuthSelection) return false
    }
    for (const line of contribution.envelope?.lines ?? []) {
      const authority = line.mcpAuthority
      if (!authority) continue
      if (!matchesConnectionOwner(connections, authority.tenantId, authority.call.connectionId, authority.ownerUserId)) return false
      if (authority.ownerUserId !== undefined) {
        const matches = proposals.filter(event => event.envelopeVersion === contribution.envelope!.version)
        if (matches.length !== 1 || contributionMcpProposalOwner(matches[0]) !== authority.ownerUserId ||
            !matchesProposalOwner(matches[0], authority.ownerUserId)) return false
      }
    }
    for (const attempt of contribution.effectAttempts ?? []) {
      if (!matchesConnectionOwner(connections, attempt.tenantId, attempt.call.connectionId, attempt.ownerUserId)) return false
      if (attempt.ownerUserId !== undefined) {
        const matches = proposals.filter(event => event.envelopeVersion === attempt.envelopeVersion)
        if (matches.length !== 1 || contributionMcpProposalOwner(matches[0]) !== attempt.ownerUserId ||
            !matchesProposalOwner(matches[0], attempt.ownerUserId)) return false
      }
    }
  }
  return true
}
