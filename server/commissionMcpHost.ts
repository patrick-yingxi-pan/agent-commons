/** Person-private Commission review/decisions over live host facts. The store
 * supplies authenticated scope and canonical projections; this module owns no
 * global store, transport, timer, or credential resolution. */
import type { CommissionMcpDecisionRequest, CommissionMcpDecisionResponse, CommissionMcpReview } from '../contract/commissionMcpApi.ts'
import type { DispatchBinding } from '../contract/dispatchExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { CommissionMcpPolicyError, commissionMcpToolPermitted, type CommissionMcpScope } from './commissionMcpPolicy.ts'
import { CommissionMcpRegistry } from './commissionMcpRegistry.ts'
import { commissionMcpReviewFacts, publicCommissionMcpClaim } from './commissionMcpReview.ts'
import { snapshotMcpJson } from './mcpJson.ts'

export type CommissionMcpModelSelection = Pick<DispatchBinding, 'providerId' | 'modelId'>
export type CommissionMcpLiveSource = Parameters<typeof commissionMcpReviewFacts>[0] & {
  scope: CommissionMcpScope
  tools: CommissionMcpReview['tools']
  blockedReason: string | null
}
export interface CommissionMcpHostPort {
  registry: CommissionMcpRegistry
  source(id: string, tenantId: string, userId: string, model?: CommissionMcpModelSelection): CommissionMcpLiveSource | undefined
  connection(id: string, tenantId: string, userId: string): McpConnectionView | undefined
  commit<T>(operation: () => T): T
  changed(commissionId: string, projectId: string): void
  now(): number
  /** Deployment-owned capability; absent is HTTP-only. Never request-owned. */
  allowLocalPrograms?(): boolean
}

export class CommissionMcpHost {
  private readonly port: CommissionMcpHostPort
  constructor(port: CommissionMcpHostPort) { this.port = port }

  review(id: string, tenantId: string, userId: string, model?: CommissionMcpModelSelection): CommissionMcpReview | undefined {
    const base = this.port.source(id, tenantId, userId)
    if (!base) return undefined
    const stored = this.port.registry.policy(base.scope)
    const selected = model ?? stored?.policy.approval?.execution
    const source = selected ? this.port.source(id, tenantId, userId, selected) : base
    if (!source) return undefined
    const facts = commissionMcpReviewFacts(source)
    const policy = stored?.policy ?? { version: 1 as const, revision: 0, approval: null }
    const approval = policy.approval
    const claims = this.port.registry.snapshot().claims.filter(claim =>
      claim.permission.tenantId === base.scope.tenantId && claim.permission.ownerUserId === userId &&
      claim.permission.commissionId === id)
    const count = claims.filter(claim => claim.permission.policy.revision === policy.revision).length
    const now = this.port.now()
    const active = !source.blockedReason && !!approval && count < approval.maxWorkItems &&
      approval.configurationRevision === (source.commission.configurationRevision ?? 0) &&
      approval.reviewHash === facts.reviewHash && now >= approval.approvedAt && now < approval.expiresAt &&
      approval.tools.every(tool => source.tools.some(available => available.connectionId === tool.connectionId &&
        available.connectionRevision === tool.connectionRevision && available.tool.name === tool.toolName &&
        available.schemaHash === tool.schemaHash) &&
        (() => { const view = this.port.connection(tool.connectionId, base.scope.tenantId, userId)
          return commissionMcpToolPermitted(stored!, tool, view, this.port.allowLocalPrograms?.() === true) })())
    return structuredClone({ commissionId: id, projectId: source.project.id,
      configurationRevision: source.commission.configurationRevision ?? 0, ...facts,
      execution: source.execution, policy, active, blockedReason: source.blockedReason,
      tools: source.tools, claims: claims.map(publicCommissionMcpClaim) })
  }

  decide(id: string, tenantId: string, value: CommissionMcpDecisionRequest, userId: string): CommissionMcpDecisionResponse | undefined {
    const base = this.port.source(id, tenantId, userId)
    if (!base) return undefined
    let request: CommissionMcpDecisionRequest
    try { request = snapshotMcpJson(value, { maxBytes: 300_000, maxDepth: 44, maxNodes: 24_000 }) as unknown as CommissionMcpDecisionRequest }
    catch { throw new CommissionMcpPolicyError('invalid') }
    const selection = request?.action === 'approve' ? request.approval?.execution : undefined
    const review = this.review(id, tenantId, userId, selection)
    if (!review) return undefined
    return this.port.commit(() => {
      const decision = this.port.registry.decide(base.scope, request, {
        configurationRevision: review.configurationRevision, reviewHash: review.reviewHash, now: this.port.now(),
        approvalAllowed: !review.blockedReason && !!review.execution,
        allowLocalPrograms: this.port.allowLocalPrograms?.() === true,
        connection: (connectionId, owner, person) => {
          const connection = this.port.connection(connectionId, owner, person)
          if (!connection) return undefined
          // Filter every tool, not just the connection. A POST cannot select a
          // sibling tool that the Project/Agent/provider intersection hid.
          const admitted = review.tools.filter(tool => tool.connectionId === connectionId).map(tool => tool.tool.name)
          return { ...connection, executableTools: connection.executableTools?.filter(name => admitted.includes(name)) }
        },
      })
      if (!decision.replayed) this.port.changed(id, base.scope.projectId)
      return { commissionId: id, requestId: request.requestId, decisionId: decision.decisionId,
        review: this.review(id, tenantId, userId, selection)! }
    })
  }
}
