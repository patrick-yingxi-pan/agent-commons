/** Private Commission work admission. Policy revisions are append-only: the
 * latest is current authority and earlier revisions prove claim provenance.
 * The host commits every mutation before model/tool I/O. No timer or executor
 * lives here, and no legacy standing flag can create an approval. */
import type { CommissionMcpApprovalIntent } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { sameMcpPermissionJson } from './mcpPermission.ts'
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
}
export interface CommissionMcpRegistryContext extends CommissionMcpLiveReview {
  now: number
  connection: CommissionMcpConnectionReader
}
export const emptyCommissionMcpRegistry = (): CommissionMcpRegistryState => ({ policies: [], claims: [], retired: [] })
const fail = (code: CommissionMcpPolicyError['code'] = 'invalid'): never => { throw new CommissionMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => !!value && typeof value === 'object' && !Array.isArray(value)
const scopeKey = (scope: CommissionMcpScope): string => JSON.stringify([scope.tenantId, scope.ownerUserId, scope.commissionId])
const revisionKey = (row: StoredCommissionMcpPolicy): string => JSON.stringify([scopeKey(row), row.policy.revision])
const sameAssignment = (a: RetiredCommissionMcpScope | CommissionMcpScope, b: CommissionMcpScope): boolean =>
  a.tenantId === b.tenantId && a.commissionId === b.commissionId && a.projectId === b.projectId && a.agentId === b.agentId
export const commissionMcpClaimActive = (claim: StoredCommissionMcpClaim): boolean =>
  claim.phase === 'preparing' || (claim.phase === 'effect' && claim.attempt.status === 'pending')

/** Malformed present data never becomes an empty ledger. Historical grants are
 * exact, contiguous revisions; an approved claim consumes its slot forever. */
export function parseCommissionMcpRegistryState(value: unknown): CommissionMcpRegistryState {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 64 * 1024 * 1024, maxDepth: 48, maxNodes: 2_000_000 })
    if (!record(copy) || Object.keys(copy).length !== 3 || !Array.isArray(copy.policies) ||
        !Array.isArray(copy.claims) || !Array.isArray(copy.retired) ||
        copy.policies.length > 100_000 || copy.claims.length > 100_000 || copy.retired.length > 100_000) return fail()
    const policies = copy.policies.map(parseCommissionMcpPolicy)
    const claims = copy.claims.map(parseCommissionMcpClaim)
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
    return { policies, claims, retired }
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
    this.state = parseCommissionMcpRegistryState(initial)
  }
  snapshot(): CommissionMcpRegistryState { return parseCommissionMcpRegistryState(this.state) }
  replace(value: CommissionMcpRegistryState): void { this.state = parseCommissionMcpRegistryState(value) }
  isRetired(commissionId: string): boolean { return this.state.retired.some(row => row.commissionId === commissionId) }
  policy(scope: CommissionMcpScope): StoredCommissionMcpPolicy | undefined {
    const row = this.state.policies.filter(row => scopeKey(row) === scopeKey(scope))
      .sort((a, b) => b.policy.revision - a.policy.revision)[0]
    if (row && !sameAssignment(row, scope)) return fail('stale')
    return row && parseCommissionMcpPolicy(row)
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
    this.commit({ policies: [...this.state.policies, ...revoked], claims: this.state.claims.map(row =>
      row.permission.commissionId === commissionId ? interruptCommissionMcpClaim(row, at) : row),
    retired: [...this.state.retired, { tenantId: assignment.tenantId, commissionId, projectId: assignment.projectId,
      agentId: assignment.agentId, retiredAt: at }] })
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
  private commit(state: CommissionMcpRegistryState): void { this.state = parseCommissionMcpRegistryState(state) }
}
