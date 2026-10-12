/** Cross-slice person/transport provenance for unattended Routine MCP work. Leaf parsers
 * own strict fields; these joins never infer a person from Routine tenancy. */
import type { McpConnectionState } from './mcpConnections.ts'
import type { RoutineMcpRegistryState, StoredRoutineMcpDecision } from './routineMcpRegistry.ts'
import type { StoredRoutineMcpOAuthAuthority, StoredRoutineMcpPolicy } from './routineMcpPolicy.ts'

const identityKey = (tenantId: string, id: string): string => JSON.stringify([tenantId, id])
const scopeKey = (scope: { tenantId: string; routineId: string }): string => identityKey(scope.tenantId, scope.routineId)

interface ConnectionIndex {
  identities: Map<string, McpConnectionState['retired'][number]>
  knownPersonIds: Set<string>
}

function indexConnections(connections: McpConnectionState): ConnectionIndex {
  const identities: ConnectionIndex['identities'] = new Map()
  const knownPersonIds = new Set<string>()
  const add = (row: McpConnectionState['retired'][number]) => {
    const id = row.id
    const key = identityKey(row.tenantId, id)
    // Leaf admission already disallows duplicates; retain the original
    // current-before-retired, first-row lookup semantics regardless.
    if (!identities.has(key)) identities.set(key, row)
    if (row.ownerUserId !== undefined || row.transport === 'stdio') knownPersonIds.add(id)
  }
  for (const row of connections.connections) add({ tenantId: row.tenantId, id: row.id,
    ...(row.ownerUserId === undefined ? {} : { ownerUserId: row.ownerUserId }),
    ...(row.transport === 'stdio' ? { transport: 'stdio' as const } : {}) })
  for (const row of connections.retired) add(row)
  return { identities, knownPersonIds }
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
  transport: 'http' | 'stdio',
): boolean {
  return !authority || authority.connectionIds.every(id => {
    const identity = connections.identities.get(identityKey(tenantId, id))
    return identity?.ownerUserId === authority.ownerUserId && (identity.transport ?? 'http') === transport
  })
}

const sameAuthorities = (left: Pick<StoredRoutineMcpPolicy, 'oauthAuthority' | 'localAuthority'>,
  right: Pick<StoredRoutineMcpPolicy, 'oauthAuthority' | 'localAuthority'>): boolean =>
  sameAuthority(left.oauthAuthority, right.oauthAuthority) && sameAuthority(left.localAuthority, right.localAuthority)
const hasPersonAuthority = (permission: Pick<StoredRoutineMcpPolicy, 'oauthAuthority' | 'localAuthority'>): boolean =>
  permission.oauthAuthority !== undefined || permission.localAuthority !== undefined
const validAuthorities = (permission: Pick<StoredRoutineMcpPolicy, 'tenantId' | 'oauthAuthority' | 'localAuthority'>,
  connections: ConnectionIndex): boolean =>
  validAuthority(permission.tenantId, permission.oauthAuthority, connections, 'http') &&
  validAuthority(permission.tenantId, permission.localAuthority, connections, 'stdio')

function validPermission(permission: StoredRoutineMcpPolicy, connections: ConnectionIndex): boolean {
  if (!validAuthorities(permission, connections)) return false
  const approval = permission.policy.approval
  if (!approval) return true
  const selectedOAuth = new Set<string>()
  const selectedLocal = new Set<string>()
  for (const tool of approval.tools) {
    const identity = connections.identities.get(identityKey(permission.tenantId, tool.connectionId))
    if (!identity) {
      if (connections.knownPersonIds.has(tool.connectionId)) return false
      continue
    }
    if (identity.transport === 'stdio') {
      if (!identity.ownerUserId || identity.ownerUserId !== permission.localAuthority?.ownerUserId) return false
      selectedLocal.add(tool.connectionId)
    } else if (identity.ownerUserId !== undefined) {
      if (identity.ownerUserId !== permission.oauthAuthority?.ownerUserId) return false
      selectedOAuth.add(tool.connectionId)
    }
  }
  for (const [selected, authority] of [[selectedOAuth, permission.oauthAuthority], [selectedLocal, permission.localAuthority]] as const) {
    if (selected.size === 0) { if (authority !== undefined) return false; continue }
    const expected = [...selected].sort()
    if (authority?.connectionIds.length !== expected.length || !authority.connectionIds.every((id, index) => id === expected[index])) return false
  }
  return true
}

function matchingApproval(permission: StoredRoutineMcpPolicy, history: DecisionHistory | undefined): boolean {
  const approval = history?.approvalsByRevision.get(permission.policy.revision) ?? []
  // Older tenant-only snapshots retain their original history requirements.
  if (!hasPersonAuthority(permission) && approval.length === 0) return true
  return approval.length === 1 && sameAuthorities(permission, approval[0]!)
}

/** The caller supplies already parsed registry and connection snapshots. A
 * retained decision can be cross-checked with matching policy/run revisions;
 * absence of all historical discriminators remains indistinguishable from
 * legacy state, rather than inventing authority during migration. */
export function validateRoutineMcpAuthorities(state: RoutineMcpRegistryState, connections: McpConnectionState,
  allowLocalPrograms = false): boolean {
  // Groundwork is not shipping authority: current snapshot/store callers must
  // keep rejecting local grants until person-scoped host integration is ready.
  if (allowLocalPrograms !== true && (state.policies.some(policy => policy.localAuthority !== undefined) ||
      state.runs.some(run => run.permission.localAuthority !== undefined) ||
      state.decisions.some(decision => decision.localAuthority !== undefined))) return false
  const connectionIndex = indexConnections(connections)
  const histories = indexDecisions(state.decisions)
  for (const decision of state.decisions) {
    if (!validAuthorities(decision, connectionIndex)) return false
    for (const authority of [decision.oauthAuthority, decision.localAuthority]) {
      if (authority && (decision.actorUserId === undefined ||
          (decision.action === 'approve' && decision.actorUserId !== authority.ownerUserId))) return false
    }
    if (decision.action === 'revoke') {
      const prior = priorApproval(histories.get(scopeKey(decision))!, decision.policyRevision)
      if (prior ? !sameAuthorities(prior, decision) : hasPersonAuthority(decision)) return false
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
    if (latest.length === 0 ? hasPersonAuthority(permission) :
      latest.some(decision => !sameAuthorities(decision, permission))) return false
  }
  for (const run of state.runs) {
    if (!validPermission(run.permission, connectionIndex) || !matchingApproval(run.permission, histories.get(scopeKey(run.permission)))) return false
  }
  return true
}
