/** Cross-slice OAuth provenance for unattended Routine MCP work. Leaf parsers
 * own strict fields; these joins never infer a person from Routine tenancy. */
import type { McpConnectionState } from './mcpConnections.ts'
import type { RoutineMcpRegistryState, StoredRoutineMcpDecision } from './routineMcpRegistry.ts'
import type { StoredRoutineMcpOAuthAuthority, StoredRoutineMcpPolicy } from './routineMcpPolicy.ts'

const identityKey = (tenantId: string, id: string): string => JSON.stringify([tenantId, id])
const scopeKey = (scope: { tenantId: string; routineId: string }): string => identityKey(scope.tenantId, scope.routineId)

interface ConnectionIndex {
  identities: Map<string, McpConnectionState['retired'][number]>
  knownOAuthIds: Set<string>
}

function indexConnections(connections: McpConnectionState): ConnectionIndex {
  const identities: ConnectionIndex['identities'] = new Map()
  const knownOAuthIds = new Set<string>()
  const add = (row: McpConnectionState['retired'][number], oauth: boolean) => {
    const id = row.id
    const key = identityKey(row.tenantId, id)
    // Leaf admission already disallows duplicates; retain the original
    // current-before-retired, first-row lookup semantics regardless.
    if (!identities.has(key)) identities.set(key, row)
    if (oauth) knownOAuthIds.add(id)
  }
  for (const row of connections.connections) add(row, row.authentication === 'device-oauth')
  for (const row of connections.retired) add(row, row.ownerUserId !== undefined)
  return { identities, knownOAuthIds }
}

interface DecisionHistory {
  approvalsByRevision: Map<number, StoredRoutineMcpDecision[]>
  approvals: StoredRoutineMcpDecision[]
  latestRevision: number
  latest: StoredRoutineMcpDecision[]
}

function indexDecisions(decisions: StoredRoutineMcpDecision[]): Map<string, DecisionHistory> {
  const histories = new Map<string, DecisionHistory>()
  for (const decision of decisions) {
    const key = scopeKey(decision)
    let history = histories.get(key)
    if (!history) {
      history = { approvalsByRevision: new Map(), approvals: [], latestRevision: 0, latest: [] }
      histories.set(key, history)
    }
    if (decision.action === 'approve') {
      const approvals = history.approvalsByRevision.get(decision.policyRevision) ?? []
      approvals.push(decision)
      history.approvalsByRevision.set(decision.policyRevision, approvals)
      history.approvals.push(decision)
    }
    if (decision.policyRevision > history.latestRevision) {
      history.latestRevision = decision.policyRevision
      history.latest = [decision]
    } else if (decision.policyRevision === history.latestRevision) history.latest.push(decision)
  }
  // Sort detached buckets once, stably: historical equal-revision approvals
  // must still choose their first occurrence in the original input.
  for (const history of histories.values()) history.approvals.sort((a, b) => b.policyRevision - a.policyRevision)
  return histories
}

function priorApproval(history: DecisionHistory, revision: number): StoredRoutineMcpDecision | undefined {
  let first = 0
  let end = history.approvals.length
  while (first < end) {
    const middle = Math.floor((first + end) / 2)
    if (history.approvals[middle]!.policyRevision >= revision) first = middle + 1
    else end = middle
  }
  return history.approvals[first]
}

function sameAuthority(left: StoredRoutineMcpOAuthAuthority | undefined, right: StoredRoutineMcpOAuthAuthority | undefined): boolean {
  if (!left || !right) return left === right
  return left.ownerUserId === right.ownerUserId && left.connectionIds.length === right.connectionIds.length &&
    left.connectionIds.every((id, index) => id === right.connectionIds[index])
}

function validAuthority(
  tenantId: string,
  authority: StoredRoutineMcpOAuthAuthority | undefined,
  connections: ConnectionIndex,
): boolean {
  return !authority || authority.connectionIds.every(id =>
    connections.identities.get(identityKey(tenantId, id))?.ownerUserId === authority.ownerUserId)
}

function validPermission(permission: StoredRoutineMcpPolicy, connections: ConnectionIndex): boolean {
  if (!validAuthority(permission.tenantId, permission.oauthAuthority, connections)) return false
  const approval = permission.policy.approval
  if (!approval) return true
  const selectedOAuth = new Set<string>()
  for (const tool of approval.tools) {
    const identity = connections.identities.get(identityKey(permission.tenantId, tool.connectionId))
    if (!identity) {
      if (connections.knownOAuthIds.has(tool.connectionId)) return false
      continue
    }
    if (identity.ownerUserId !== undefined) {
      if (identity.ownerUserId !== permission.oauthAuthority?.ownerUserId) return false
      selectedOAuth.add(tool.connectionId)
    }
  }
  if (selectedOAuth.size === 0) return permission.oauthAuthority === undefined
  const expected = [...selectedOAuth].sort()
  return permission.oauthAuthority?.connectionIds.length === expected.length &&
    permission.oauthAuthority.connectionIds.every((id, index) => id === expected[index])
}

function matchingApproval(permission: StoredRoutineMcpPolicy, history: DecisionHistory | undefined): boolean {
  const approval = history?.approvalsByRevision.get(permission.policy.revision) ?? []
  // Older tenant-only snapshots retain their original history requirements.
  if (!permission.oauthAuthority && approval.length === 0) return true
  return approval.length === 1 && sameAuthority(permission.oauthAuthority, approval[0]!.oauthAuthority)
}

/** The caller supplies already parsed registry and connection snapshots. A
 * retained decision can be cross-checked with matching policy/run revisions;
 * absence of all historical discriminators remains indistinguishable from
 * legacy state, rather than inventing authority during migration. */
export function validateRoutineMcpAuthorities(state: RoutineMcpRegistryState, connections: McpConnectionState): boolean {
  const connectionIndex = indexConnections(connections)
  const histories = indexDecisions(state.decisions)
  for (const decision of state.decisions) {
    if (!validAuthority(decision.tenantId, decision.oauthAuthority, connectionIndex)) return false
    if (decision.oauthAuthority && (decision.actorUserId === undefined ||
        (decision.action === 'approve' && decision.actorUserId !== decision.oauthAuthority.ownerUserId))) return false
    if (decision.action === 'revoke') {
      const prior = priorApproval(histories.get(scopeKey(decision))!, decision.policyRevision)
      if (prior ? !sameAuthority(prior.oauthAuthority, decision.oauthAuthority) : decision.oauthAuthority !== undefined) return false
    }
  }
  for (const permission of state.policies) {
    if (!validPermission(permission, connectionIndex)) return false
    const history = histories.get(scopeKey(permission))
    if (permission.policy.approval) {
      if (!matchingApproval(permission, history)) return false
      continue
    }
    // Revocation removes executable tools but preserves the last person's exact
    // connection set, including automatic suspension without a new decision.
    const latest = history?.latest ?? []
    if (latest.length === 0 ? permission.oauthAuthority !== undefined :
      latest.some(decision => !sameAuthority(decision.oauthAuthority, permission.oauthAuthority))) return false
  }
  for (const run of state.runs) {
    if (!validPermission(run.permission, connectionIndex) || !matchingApproval(run.permission, histories.get(scopeKey(run.permission)))) return false
  }
  return true
}
