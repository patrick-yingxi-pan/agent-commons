/** Private Commission work admission. Policy revisions are append-only: the
 * latest is current authority and earlier revisions prove claim provenance.
 * The host commits every mutation before model/tool I/O. No timer or executor
 * lives here, and no legacy standing flag can create an approval. */
import { createHash } from 'node:crypto'
import type { CommissionMcpDecisionRequest } from '../contract/commissionMcpApi.ts'
import type { CommissionMcpApprovalIntent } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { mcpPermissionJsonText, sameMcpPermissionJson } from './mcpPermission.ts'
import {
  approveCommissionMcpPolicy, revokeCommissionMcpPolicy, parseCommissionMcpPolicy,
  CommissionMcpPolicyError, commissionMcpInteger,
  type CommissionMcpScope, type CommissionMcpLiveReview, type CommissionMcpConnectionReader,
  type StoredCommissionMcpPolicy,
} from './commissionMcpPolicy.ts'
import {
  parseCommissionMcpClaim, reserveCommissionMcpClaim, commissionMcpClaimId,
  beginCommissionMcpEffect, settleCommissionMcpEffect, closeCommissionMcpPreparation,
  interruptCommissionMcpClaim, type StoredCommissionMcpClaim,
} from './commissionMcpClaim.ts'

export const COMMISSION_MCP_MAX_REVISIONS = 256
export const COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION = 256
/** The row parser's bound is also the maximum complete claim receipt. Keep
 * this as admission liability while a claim is active, so an effect result or
 * interruption can replace that liability with its actual terminal bytes. */
export const COMMISSION_MCP_MAX_CLAIM_BYTES = 1_572_864
const COMMISSION_MCP_REGISTRY_MAX_BYTES = 64 * 1024 * 1024
const COMMISSION_MCP_REGISTRY_MAX_NODES = 2_000_000
const MAX_POLICY_ROW_BYTES = 262_144
const MAX_POLICY_ROW_NODES = 20_000
// Identity fields are each at most 200 UTF-16 code units; JSON escaping can
// expand controls by six bytes per code unit. This deliberately overstates a
// decision or retirement row.
const MAX_DECISION_ROW_BYTES = 8_192
const MAX_RETIRED_ROW_BYTES = 8_192
const MAX_SMALL_ROW_NODES = 32
export interface RetiredCommissionMcpScope {
  tenantId: string
  commissionId: string
  projectId: string
  agentId: string
  retiredAt: number
}
export interface CommissionMcpRegistryState {
  policies: StoredCommissionMcpPolicy[]
  claims: StoredCommissionMcpClaim[]
  retired: RetiredCommissionMcpScope[]
  /** Optional only for snapshots written before keyed decisions existed. */
  decisions?: StoredCommissionMcpDecision[]
  /** Exact global claim identities made permanently ineligible by explicit restore. */
  blockedWork?: string[]
}
export interface StoredCommissionMcpDecision extends CommissionMcpScope {
  decisionId: string
  requestHash: string
  policyRevision: number
  action: 'approve' | 'revoke'
}
export interface CommissionMcpRegistryContext extends CommissionMcpLiveReview {
  now: number
  connection: CommissionMcpConnectionReader
  /** Host admission gate for a fresh model/role/budget-dependent approval. */
  approvalAllowed?: boolean
}
export const emptyCommissionMcpRegistry = (): CommissionMcpRegistryState => ({ policies: [], claims: [], retired: [] })
const fail = (code: CommissionMcpPolicyError['code'] = 'invalid'): never => { throw new CommissionMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => !!value && typeof value === 'object' && !Array.isArray(value)
const scopeKey = (scope: CommissionMcpScope): string => JSON.stringify([scope.tenantId, scope.ownerUserId, scope.commissionId])
const decisionScopeKey = (scope: CommissionMcpScope): string => JSON.stringify([scope.tenantId, scope.ownerUserId, scope.commissionId, scope.projectId, scope.agentId])
const revisionKey = (row: StoredCommissionMcpPolicy): string => JSON.stringify([scopeKey(row), row.policy.revision])
const sameAssignment = (a: RetiredCommissionMcpScope | CommissionMcpScope, b: CommissionMcpScope): boolean =>
  a.tenantId === b.tenantId && a.commissionId === b.commissionId && a.projectId === b.projectId && a.agentId === b.agentId
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const decisionHash = (value: unknown): string => createHash('sha256').update(mcpPermissionJsonText(value)).digest('hex')
const decisionId = (scope: CommissionMcpScope, requestId: string): string =>
  `commission-mcp-decision-${decisionHash([scope, requestId])}`
export const commissionMcpClaimActive = (claim: StoredCommissionMcpClaim): boolean =>
  claim.phase === 'preparing' || (claim.phase === 'effect' && claim.attempt.status === 'pending')

/** Conservative UTF-8 capacity liability for all transitions that must remain
 * possible after admission. Claims reserve their whole bounded terminal row;
 * each currently approved scope reserves a full revoke row and, where the
 * decision ledger still permits it, one bounded revoke receipt; each live
 * Commission reserves its retirement anchor. */
export function commissionMcpRegistryCapacity(state: CommissionMcpRegistryState): {
  bytes: number; reservedBytes: number; availableBytes: number
  nodes: number; reservedNodes: number; availableNodes: number
} {
  const json = JSON.stringify(state)
  const bytes = Buffer.byteLength(json, 'utf8')
  const nodes = countJsonNodes(state)
  const active = state.claims.filter(commissionMcpClaimActive)
  let liability = 0
  let nodeLiability = 0
  for (const claim of active) {
    liability += Math.max(0, COMMISSION_MCP_MAX_CLAIM_BYTES - Buffer.byteLength(JSON.stringify(claim), 'utf8'))
    nodeLiability += Math.max(0, 150_000 - countJsonNodes(claim))
  }
  const scopes = new Map<string, StoredCommissionMcpPolicy>()
  for (const row of state.policies) {
    const key = scopeKey(row)
    const current = scopes.get(key)
    if (!current || row.policy.revision > current.policy.revision) scopes.set(key, row)
  }
  const decisionCounts = new Map<string, number>()
  for (const row of state.decisions ?? []) {
    const key = scopeKey(row)
    decisionCounts.set(key, (decisionCounts.get(key) ?? 0) + 1)
  }
  const retired = new Set(state.retired.map(row => row.commissionId))
  for (const [key, policy] of scopes) {
    if (policy.policy.approval) {
      liability += MAX_POLICY_ROW_BYTES
      nodeLiability += MAX_POLICY_ROW_NODES
      if ((decisionCounts.get(key) ?? 0) < COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION) {
        liability += MAX_DECISION_ROW_BYTES
        nodeLiability += MAX_SMALL_ROW_NODES
      }
    }
    if (!retired.has(policy.commissionId)) {
      liability += MAX_RETIRED_ROW_BYTES
      nodeLiability += MAX_SMALL_ROW_NODES
    }
  }
  return {
    bytes, reservedBytes: liability, availableBytes: COMMISSION_MCP_REGISTRY_MAX_BYTES - bytes - liability,
    nodes, reservedNodes: nodeLiability, availableNodes: COMMISSION_MCP_REGISTRY_MAX_NODES - nodes - nodeLiability,
  }
}

function countJsonNodes(value: unknown): number {
  let count = 0
  const pending = [value]
  while (pending.length) {
    const next = pending.pop()
    count += 1
    if (next !== null && typeof next === 'object') {
      for (const child of Array.isArray(next) ? next : Object.values(next)) pending.push(child)
    }
  }
  return count
}

function assertRegistryHeadroom(state: CommissionMcpRegistryState): void {
  const capacity = commissionMcpRegistryCapacity(state)
  if (capacity.availableBytes < 0 || capacity.availableNodes < 0) fail('limit')
}

/** Malformed present data never becomes an empty ledger. Historical grants are
 * exact, contiguous revisions; an approved claim consumes its slot forever. */
export function parseCommissionMcpRegistryState(value: unknown): CommissionMcpRegistryState {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: COMMISSION_MCP_REGISTRY_MAX_BYTES, maxDepth: 48, maxNodes: 2_000_000 })
    const hasDecisions = record(copy) && Object.hasOwn(copy, 'decisions')
    const hasBlockedWork = record(copy) && Object.hasOwn(copy, 'blockedWork')
    const expectedKeys = 3 + Number(hasDecisions) + Number(hasBlockedWork)
    if (!record(copy) || Object.keys(copy).length !== expectedKeys ||
        Object.keys(copy).some(key => !['policies', 'claims', 'retired', 'decisions', 'blockedWork'].includes(key)) || !Array.isArray(copy.policies) ||
        !Array.isArray(copy.claims) || !Array.isArray(copy.retired) ||
        (hasDecisions && !Array.isArray(copy.decisions)) ||
        (hasBlockedWork && (!Array.isArray(copy.blockedWork) || (copy.blockedWork as McpJsonValue[]).length > 100_000)) ||
        copy.policies.length > 100_000 || copy.claims.length > 100_000 || copy.retired.length > 100_000 ||
        (hasDecisions && (copy.decisions as McpJsonValue[]).length > 25_600_000)) return fail()
    const policies = copy.policies.map(parseCommissionMcpPolicy)
    const claims = copy.claims.map(parseCommissionMcpClaim)
    const blockedWork = hasBlockedWork ? (copy.blockedWork as McpJsonValue[]).map(id => {
      if (typeof id !== 'string' || !/^commission-work-[a-f0-9]{64}$/.test(id)) return fail()
      return id
    }) : undefined
    if (blockedWork && new Set(blockedWork).size !== blockedWork.length) return fail()
    const decisions = (hasDecisions ? copy.decisions as McpJsonValue[] : []).map(value => {
      if (!record(value) || Object.keys(value).length !== 9 ||
          !['decisionId', 'tenantId', 'ownerUserId', 'projectId', 'commissionId', 'agentId', 'requestHash', 'policyRevision', 'action']
            .every(key => Object.hasOwn(value, key)) ||
          !identity(value.tenantId) || !identity(value.ownerUserId) || !identity(value.projectId) ||
          !identity(value.commissionId) || !identity(value.agentId) ||
          typeof value.decisionId !== 'string' || !/^commission-mcp-decision-[a-f0-9]{64}$/.test(value.decisionId) ||
          typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash) ||
          !commissionMcpInteger(value.policyRevision) || value.policyRevision < 1 ||
          (value.action !== 'approve' && value.action !== 'revoke')) return fail()
      return { decisionId: value.decisionId, tenantId: value.tenantId, ownerUserId: value.ownerUserId,
        projectId: value.projectId, commissionId: value.commissionId, agentId: value.agentId,
        requestHash: value.requestHash, policyRevision: value.policyRevision, action: value.action } as StoredCommissionMcpDecision
    })
    const byScope = new Map<string, StoredCommissionMcpPolicy[]>()
    const assignments = new Map<string, StoredCommissionMcpPolicy>()
    const byRevision = new Map<string, StoredCommissionMcpPolicy>()
    for (const policy of policies) {
      const assignment = assignments.get(policy.commissionId)
      if (assignment && !sameAssignment(assignment, policy)) return fail()
      assignments.set(policy.commissionId, policy)
      const key = scopeKey(policy)
      const history = byScope.get(key) ?? []
      history.push(policy)
      byScope.set(key, history)
      if (byRevision.has(revisionKey(policy))) return fail()
      byRevision.set(revisionKey(policy), policy)
    }
    const decisionsPerCommission = new Map<string, number>()
    const decisionIds = new Set<string>()
    for (const decision of decisions) {
      const policy = byRevision.get(JSON.stringify([scopeKey(decision), decision.policyRevision]))
      if (!policy || !sameAssignment(policy, decision) || decisionIds.has(decision.decisionId)) return fail()
      if ((decision.action === 'approve') !== (policy.policy.approval !== null)) return fail()
      decisionIds.add(decision.decisionId)
      const key = scopeKey(decision)
      const count = (decisionsPerCommission.get(key) ?? 0) + 1
      if (count > COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION) return fail('limit')
      decisionsPerCommission.set(key, count)
    }
    const current = new Map<string, StoredCommissionMcpPolicy>()
    for (const [key, unsorted] of byScope) {
      const history = [...unsorted].sort((a, b) => a.policy.revision - b.policy.revision)
      if (history.length > COMMISSION_MCP_MAX_REVISIONS) return fail('limit')
      for (const [index, row] of history.entries()) {
        if (row.policy.revision !== index + 1 ||
            (row.policy.approval === null && !history[index - 1]?.policy.approval)) return fail()
      }
      const latest = history.at(-1)!
      if (history.length === COMMISSION_MCP_MAX_REVISIONS && latest.policy.approval !== null) return fail('limit')
      current.set(key, latest)
    }
    const retired: RetiredCommissionMcpScope[] = copy.retired.map(value => {
      if (!record(value) || Object.keys(value).length !== 5 || !commissionMcpInteger(value.retiredAt)) return fail()
      const assignment = assignments.get(value.commissionId as string)
      if (!assignment || !sameAssignment(value as unknown as RetiredCommissionMcpScope, assignment)) return fail()
      if (Object.keys(value).some(key => !['tenantId', 'commissionId', 'projectId', 'agentId', 'retiredAt'].includes(key))) return fail()
      return { tenantId: assignment.tenantId, commissionId: assignment.commissionId,
        projectId: assignment.projectId, agentId: assignment.agentId, retiredAt: value.retiredAt }
    })
    if (new Set(retired.map(row => row.commissionId)).size !== retired.length) return fail()
    const retiredIds = new Set(retired.map(row => row.commissionId))
    if ([...current.values()].some(row => retiredIds.has(row.commissionId) && row.policy.approval !== null)) return fail()
    if ([...decisionsPerCommission].some(([key, count]) => count === COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION &&
        [...current.values()].some(row => scopeKey(row) === key && row.policy.approval !== null))) return fail()
    const counts = new Map<string, number>()
    const claimIds = new Set<string>()
    const activeTenants = new Map<string, number>()
    const activeAgents = new Set<string>()
    let activeCount = 0
    for (const claim of claims) {
      const key = revisionKey(claim.permission)
      const approved = byRevision.get(key)
      if (!approved || !sameMcpPermissionJson(approved, claim.permission) || claimIds.has(claim.id) ||
          (retiredIds.has(claim.permission.commissionId) && commissionMcpClaimActive(claim))) return fail()
      claimIds.add(claim.id)
      const count = (counts.get(key) ?? 0) + 1
      if (count > approved.policy.approval!.maxWorkItems) return fail('limit')
      counts.set(key, count)
      if (commissionMcpClaimActive(claim)) {
        const tenant = claim.permission.tenantId
        const agent = JSON.stringify([tenant, claim.permission.agentId])
        const inTenant = (activeTenants.get(tenant) ?? 0) + 1
        if (++activeCount > 4 || inTenant > 2 || activeAgents.has(agent)) return fail('limit')
        activeTenants.set(tenant, inTenant)
        activeAgents.add(agent)
      }
    }
    return { policies, claims, retired, decisions, ...(blockedWork === undefined ? {} : { blockedWork }) }
  } catch (error) {
    if (error instanceof CommissionMcpPolicyError) throw error
    return fail()
  }
}

/** All reads are detached; writes are private transitions, not arbitrary row
 * replacement. replace() is exclusively the strict startup/restore boundary. */
export class CommissionMcpRegistry {
  private state: CommissionMcpRegistryState
  constructor(initial: CommissionMcpRegistryState = emptyCommissionMcpRegistry()) {
    const parsed = parseCommissionMcpRegistryState(initial)
    assertRegistryHeadroom(parsed)
    this.state = { ...parsed, decisions: parsed.decisions ?? [] }
  }
  snapshot(): CommissionMcpRegistryState { return parseCommissionMcpRegistryState(this.state) }
  replace(value: CommissionMcpRegistryState): void {
    const parsed = parseCommissionMcpRegistryState(value)
    assertRegistryHeadroom(parsed)
    this.state = { ...parsed, decisions: parsed.decisions ?? [] }
  }
  isRetired(commissionId: string): boolean { return this.state.retired.some(row => row.commissionId === commissionId) }
  isWorkBlocked(projectId: string, itemId: string): boolean {
    return (this.state.blockedWork ?? []).includes(commissionMcpClaimId(projectId, itemId))
  }
  /** Explicit backup restore is a trust boundary: interrupt every live claim,
   * revoke every current grant, and permanently fence restored open work. */
  restoreBoundary(workIds: readonly string[], now: number): void {
    if (!commissionMcpInteger(now) || !Array.isArray(workIds) || workIds.some(id =>
      typeof id !== 'string' || !/^commission-work-[a-f0-9]{64}$/.test(id))) return fail()
    const blocked = [...new Set([...(this.state.blockedWork ?? []), ...workIds])].sort()
    const current = new Map<string, StoredCommissionMcpPolicy>()
    for (const policy of this.state.policies) {
      const key = scopeKey(policy)
      const prior = current.get(key)
      if (!prior || prior.policy.revision < policy.policy.revision) current.set(key, policy)
    }
    const revoked = [...current.values()].filter(row => row.policy.approval !== null)
      .map(row => revokeCommissionMcpPolicy(row, row.policy.revision))
    const next: CommissionMcpRegistryState = {
      ...this.state,
      policies: [...this.state.policies, ...revoked],
      claims: this.state.claims.map(row => interruptCommissionMcpClaim(row, now)),
      ...(blocked.length ? { blockedWork: blocked } : {}),
    }
    this.commit(next)
  }
  policy(scope: CommissionMcpScope): StoredCommissionMcpPolicy | undefined {
    const row = this.state.policies.filter(row => scopeKey(row) === scopeKey(scope))
      .sort((a, b) => b.policy.revision - a.policy.revision)[0]
    if (row && !sameAssignment(row, scope)) return fail('stale')
    return row && parseCommissionMcpPolicy(row)
  }
  decide(scope: CommissionMcpScope, request: CommissionMcpDecisionRequest, context: CommissionMcpRegistryContext):
    { decisionId: string; replayed: boolean; policyRevision: number } {
    const exactScope = this.checkedScope(scope)
    const exact = this.requestSnapshot(exactScope, request)
    const id = decisionId(exactScope, exact.requestId)
    const decisions = this.state.decisions ?? []
    const previous = decisions.find(row => row.decisionId === id)
    if (previous) {
      if (previous.requestHash !== exact.requestHash) return fail('stale')
      return { decisionId: id, replayed: true, policyRevision: previous.policyRevision }
    }
    if (exact.action === 'approve' && context.approvalAllowed === false) return fail('denied')
    const count = decisions.filter(row => scopeKey(row) === scopeKey(exactScope)).length
    if (count >= COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION ||
        (exact.action === 'approve' && count >= COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION - 1)) return fail('limit')
    if (this.isRetired(exactScope.commissionId)) return fail('unavailable')
    const current = this.policy(exactScope)
    let next: StoredCommissionMcpPolicy
    if (exact.action === 'approve') {
      if ((current?.policy.revision ?? 0) >= COMMISSION_MCP_MAX_REVISIONS - 1) return fail('limit')
      next = approveCommissionMcpPolicy(exactScope, current,
        { configurationRevision: context.configurationRevision, reviewHash: context.reviewHash }, exact.approval!, context.now, context.connection)
    } else {
      if (!current) return fail('unavailable')
      next = revokeCommissionMcpPolicy(current, exact.expectedRevision!)
    }
    const receipt: StoredCommissionMcpDecision = { ...exactScope, decisionId: id, requestHash: exact.requestHash,
      policyRevision: next.policy.revision, action: exact.action }
    this.commit({ ...this.state, policies: next.policy.revision === (current?.policy.revision ?? 0)
      ? this.state.policies : [...this.state.policies, next], decisions: [...decisions, receipt] })
    return { decisionId: id, replayed: false, policyRevision: next.policy.revision }
  }
  claim(projectId: string, itemId: string): StoredCommissionMcpClaim | undefined {
    const row = this.state.claims.find(row => row.id === commissionMcpClaimId(projectId, itemId))
    return row && parseCommissionMcpClaim(row)
  }
  approve(scope: CommissionMcpScope, intent: CommissionMcpApprovalIntent, context: CommissionMcpRegistryContext): StoredCommissionMcpPolicy {
    if (this.isRetired(scope.commissionId)) return fail('unavailable')
    const current = this.policy(scope)
    // Keep the final revision available for unconditional withdrawal.
    if ((current?.policy.revision ?? 0) >= COMMISSION_MCP_MAX_REVISIONS - 1) return fail('limit')
    const next = approveCommissionMcpPolicy(scope, current,
      { configurationRevision: context.configurationRevision, reviewHash: context.reviewHash }, intent, context.now, context.connection)
    this.commit({ ...this.state, policies: [...this.state.policies, next] })
    return parseCommissionMcpPolicy(next)
  }
  revoke(scope: CommissionMcpScope, expectedRevision: number): StoredCommissionMcpPolicy {
    const current = this.policy(scope) ?? fail('unavailable')
    const next = revokeCommissionMcpPolicy(current, expectedRevision)
    if (next.policy.revision !== current.policy.revision) this.commit({ ...this.state, policies: [...this.state.policies, next] })
    return parseCommissionMcpPolicy(next)
  }
  reserve(input: Omit<Parameters<typeof reserveCommissionMcpClaim>[1], 'live'>): { claim: StoredCommissionMcpClaim; created: boolean } {
    const previous = this.claim(input.permission.projectId, input.work.itemId)
    const reserved = reserveCommissionMcpClaim(previous, { ...input, live: this.policy(input.permission) })
    if (!reserved.created) return reserved
    if (this.isWorkBlocked(input.permission.projectId, input.work.itemId)) return fail('denied')
    if (this.isRetired(input.permission.commissionId)) return fail('unavailable')
    const key = revisionKey(reserved.claim.permission)
    const consumed = this.state.claims.filter(row => revisionKey(row.permission) === key).length
    if (consumed >= reserved.claim.permission.policy.approval!.maxWorkItems) return fail('limit')
    const active = this.state.claims.filter(commissionMcpClaimActive)
    if (active.length >= 4 || active.filter(row => row.permission.tenantId === input.permission.tenantId).length >= 2 ||
        active.some(row => row.permission.tenantId === input.permission.tenantId && row.permission.agentId === input.permission.agentId)) return fail('limit')
    this.commit({ ...this.state, claims: [...this.state.claims, reserved.claim] })
    return reserved
  }
  beginEffect(projectId: string, itemId: string, call: McpBoundToolCall, context: CommissionMcpRegistryContext): { claim: StoredCommissionMcpClaim; created: boolean } {
    const prior = this.claim(projectId, itemId) ?? fail('unavailable')
    const result = beginCommissionMcpEffect(prior, { call, live: this.policy(prior.permission),
      review: { configurationRevision: context.configurationRevision, reviewHash: context.reviewHash }, now: context.now, connection: context.connection })
    if (result.created) this.storeClaim(result.claim)
    return result
  }
  settleEffect(projectId: string, itemId: string, outcome: McpBoundExecutionOutcome, at: number): StoredCommissionMcpClaim {
    const next = settleCommissionMcpEffect(this.claim(projectId, itemId) ?? fail('unavailable'), outcome, at)
    this.storeClaim(next)
    return parseCommissionMcpClaim(next)
  }
  closePreparation(projectId: string, itemId: string, status: 'failed' | 'uncertain', at: number): StoredCommissionMcpClaim {
    const next = closeCommissionMcpPreparation(this.claim(projectId, itemId) ?? fail('unavailable'), status, at)
    this.storeClaim(next)
    return parseCommissionMcpClaim(next)
  }
  /** Deleting a Commission never erases the global work claim. Its retired
   * assignment is a historical join, never a substitute for current authority. */
  retireCommission(commissionId: string, at: number): boolean {
    if (!commissionMcpInteger(at)) return fail()
    const assignment = this.state.policies.find(row => row.commissionId === commissionId)
    if (!assignment || this.state.retired.some(row => row.commissionId === commissionId)) return false
    const scopes = new Map(this.state.policies.filter(row => row.commissionId === commissionId).map(row => [scopeKey(row), row]))
    const revoked = [...scopes.values()].map(row => this.policy(row)!).filter(row => row.policy.approval !== null)
      .map(row => revokeCommissionMcpPolicy(row, row.policy.revision))
    this.commit({ policies: [...this.state.policies, ...revoked], decisions: this.state.decisions ?? [], claims: this.state.claims.map(row =>
      row.permission.commissionId === commissionId ? interruptCommissionMcpClaim(row, at) : row),
    retired: [...this.state.retired, { tenantId: assignment.tenantId, commissionId, projectId: assignment.projectId,
      agentId: assignment.agentId, retiredAt: at }], ...(this.state.blockedWork === undefined ? {} : { blockedWork: this.state.blockedWork }) })
    return true
  }
  /** Must be durably committed before worker admission. A later completion
   * cannot overwrite this uncertainty or turn an old claim into fresh work. */
  recover(at: number): boolean {
    if (!commissionMcpInteger(at)) return fail()
    const pending = this.state.claims.filter(commissionMcpClaimActive)
    if (!pending.length) return false
    const scopes = new Map(pending.map(row => [scopeKey(row.permission), row.permission]))
    const revoked = [...scopes.values()].map(row => this.policy(row)!).filter(row => row.policy.approval !== null)
      .map(row => revokeCommissionMcpPolicy(row, row.policy.revision))
    this.commit({ ...this.state, policies: [...this.state.policies, ...revoked],
      claims: this.state.claims.map(row => interruptCommissionMcpClaim(row, at)) })
    return true
  }
  private storeClaim(claim: StoredCommissionMcpClaim): void {
    this.commit({ ...this.state, claims: this.state.claims.map(row => row.id === claim.id ? claim : row) })
  }
  private checkedScope(scope: CommissionMcpScope): CommissionMcpScope {
    const copy = snapshotMcpJson(scope, { maxBytes: 4096, maxDepth: 4, maxNodes: 24 })
    if (!record(copy) || Object.keys(copy).length !== 5 ||
        !['tenantId', 'ownerUserId', 'projectId', 'commissionId', 'agentId'].every(key => identity(copy[key]))) return fail()
    return { tenantId: copy.tenantId as string, ownerUserId: copy.ownerUserId as string,
      projectId: copy.projectId as string, commissionId: copy.commissionId as string, agentId: copy.agentId as string }
  }
  private requestSnapshot(scope: CommissionMcpScope, request: CommissionMcpDecisionRequest):
    { requestId: string; action: 'approve'; requestHash: string; approval: CommissionMcpApprovalIntent } |
    { requestId: string; action: 'revoke'; requestHash: string; expectedRevision: number } {
    const copy = snapshotMcpJson(request, { maxBytes: 300_000, maxDepth: 44, maxNodes: 24_000 })
    if (!record(copy) || !identity(copy.requestId) || (copy.action !== 'approve' && copy.action !== 'revoke')) return fail()
    if (copy.action === 'approve') {
      if (Object.keys(copy).length !== 3 || !Object.hasOwn(copy, 'approval') || !record(copy.approval)) return fail()
      return { requestId: copy.requestId, action: 'approve', requestHash: decisionHash({ scope, request: copy }),
        approval: copy.approval as unknown as CommissionMcpApprovalIntent }
    }
    if (Object.keys(copy).length !== 3 || !Object.hasOwn(copy, 'expectedRevision') || !commissionMcpInteger(copy.expectedRevision)) return fail()
    return { requestId: copy.requestId, action: 'revoke', requestHash: decisionHash({ scope, request: copy }),
      expectedRevision: copy.expectedRevision }
  }
  private commit(state: CommissionMcpRegistryState): void {
    assertRegistryHeadroom(state)
    this.state = parseCommissionMcpRegistryState(state)
  }
}
