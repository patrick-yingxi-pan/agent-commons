/** One admitted Commission job, separate from queue policy and HTTP. No retry,
 * fallback, or reconstruction of a represented claim can start another call. */
import type { CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { ProviderConfig } from './data/providers.ts'
import type { ModelUsageHandler } from './modelUsage.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import type { CommissionMcpHostPort, CommissionMcpLiveSource } from './commissionMcpHost.ts'
import { CommissionMcpRegistry } from './commissionMcpRegistry.ts'
import { commissionMcpClaimId, type StoredCommissionMcpClaim } from './commissionMcpClaim.ts'
import { commissionMcpCallPermitted, CommissionMcpPolicyError, type CommissionMcpScope } from './commissionMcpPolicy.ts'
import { commissionMcpReviewFacts } from './commissionMcpReview.ts'
import { prepareCommissionMcpInput, type PreparedCommissionMcpInput } from './commissionMcpPreparation.ts'
import { sameMcpPermissionJson } from './mcpPermission.ts'
import { UsageRegistry } from './usageRegistry.ts'

export interface CommissionMcpLease { valid(): boolean; release(): void }
export interface CommissionMcpExecutionPort extends CommissionMcpHostPort {
  usage: UsageRegistry
  ready(): boolean
  /** Only current open mcp.mutate work; never a cached/public projection. */
  work(projectId: string, itemId: string): CommissionMcpWork | undefined
  capacity(scope: CommissionMcpScope): boolean
  budgetAvailable(source: CommissionMcpLiveSource, reservationId: string): boolean
  providerConfig(providerId: string): ProviderConfig
  /** Held across both asynchronous phases, under an execution-specific holder. */
  lease(source: CommissionMcpLiveSource, work: CommissionMcpWork): CommissionMcpLease
  generate(input: PreparedCommissionMcpInput, provider: ProviderConfig, signal: AbortSignal, usage: ModelUsageHandler): Promise<McpBoundToolCall>
  execute(tenantId: string, call: McpBoundToolCall, allowed: () => boolean, userId: string, signal?: AbortSignal): Promise<McpBoundExecutionOutcome>
  /** Called inside the same durable transition as a successful receipt, and
   * only when the exact work and live authority still match. */
  complete(claim: StoredCommissionMcpClaim): void
}

const denied = (): never => { throw new CommissionMcpPolicyError('denied') }
const fixedCall = (claim: StoredCommissionMcpClaim): McpBoundToolCall => ({
  connectionId: claim.tool.connectionId, connectionRevision: claim.tool.connectionRevision,
  toolName: claim.tool.toolName, schemaHash: claim.tool.schemaHash, arguments: claim.tool.fixedArguments,
})

export class CommissionMcpExecution {
  private readonly port: CommissionMcpExecutionPort
  private readonly preparationTimeoutMs: number
  constructor(port: CommissionMcpExecutionPort, preparationTimeoutMs = 60_000) {
    if (!Number.isSafeInteger(preparationTimeoutMs) || preparationTimeoutMs < 1 || preparationTimeoutMs > 60_000) {
      throw new Error('Invalid Commission preparation deadline.')
    }
    this.port = port
    this.preparationTimeoutMs = preparationTimeoutMs
  }

  async run(commissionId: string, tenantId: string, userId: string, itemId: string, signal?: AbortSignal): Promise<StoredCommissionMcpClaim> {
    const p = this.port
    if (!p.ready() || signal?.aborted) return denied()
    const base = p.source(commissionId, tenantId, userId) ?? denied()
    const prior = p.registry.claim(base.scope.projectId, itemId)
    // A represented global work identity is history, never a queue message.
    // Other people's private receipts remain inaccessible to this caller.
    if (prior) {
      if (!sameMcpPermissionJson(base.scope, this.scope(prior))) return denied()
      return prior
    }
    const permission = p.registry.policy(base.scope) ?? denied()
    const approval = permission.policy.approval ?? denied()
    const source = p.source(commissionId, tenantId, userId, approval.execution) ?? denied()
    const work = p.work(source.project.id, itemId) ?? denied()
    if (source.blockedReason || !p.capacity(base.scope)) return denied()
    const tool = approval.tools.find(tool => tool.toolName === work.target && source.tools.some(row =>
      row.connectionId === tool.connectionId && row.connectionRevision === tool.connectionRevision &&
      row.schemaHash === tool.schemaHash && row.tool.name === tool.toolName)) ?? denied()
    const schema = source.tools.find(row => row.connectionId === tool.connectionId && row.tool.name === tool.toolName)!.tool
    const prepared = prepareCommissionMcpInput({ agent: source.agent, project: source.project, work, tool: schema, permission: tool })
    const config = { ...p.providerConfig(approval.execution.providerId), model: approval.execution.modelId }

    // Preflight BOTH durable registries on detached state. A budget refusal must
    // not leave a claim, and a claim refusal must not leave a usage hold.
    const nextClaims = new CommissionMcpRegistry(p.registry.snapshot())
    const reservation = nextClaims.reserve({ permission, work, tool,
      review: { configurationRevision: source.commission.configurationRevision ?? 0, reviewHash: commissionMcpReviewFacts(source).reviewHash },
      now: p.now(), connection: p.connection, allowLocalPrograms: p.allowLocalPrograms?.() === true })
    const nextUsage = new UsageRegistry(p.now, () => base.scope.tenantId)
    nextUsage.rehydrate(p.usage.snapshot(), false)
    nextUsage.rehydrateReservations(p.usage.snapshotReservations())
    nextUsage.reserve(commissionMcpClaimId(source.project.id, itemId), base.scope.tenantId, prepared.allowanceTokens,
      [source.commission.grant, source.agent.budget, source.parentProvider?.plan, source.provider?.plan])
    const claim = reservation.claim
    const lease = p.lease(source, work)
    try {
      p.commit(() => {
        p.registry.replace(nextClaims.snapshot())
        p.usage.rehydrate(nextUsage.snapshot(), false)
        p.usage.rehydrateReservations(nextUsage.snapshotReservations())
        p.changed(commissionId, source.project.id)
      })
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, this.preparationTimeoutMs)
      let knownUsage = false
      let call: McpBoundToolCall
      try {
        if (signal?.aborted || !this.current(claim) || !lease.valid()) return this.close(claim, false)
        let rejectAbort: () => void = () => {}
        const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new Error('Commission preparation interrupted.')) })
        controller.signal.addEventListener('abort', rejectAbort, { once: true })
        try {
          call = await Promise.race([p.generate(prepared, config, controller.signal, usage => {
            // Late settled usage is still charged after timeout/deletion. It
            // never resurrects the claim or permits the late draft to execute.
            p.commit(() => {
              p.usage.recordReserved(claim.id, claim.permission.tenantId, usage.inputTokens, usage.outputTokens)
              p.usage.settleReservation(claim.id, claim.permission.tenantId, true)
              p.changed(commissionId, source.project.id)
            })
            knownUsage = true
          }), aborted])
        } finally { controller.signal.removeEventListener('abort', rejectAbort) }
      } catch (error) {
        if (!p.ready()) throw error
        return this.close(claim, knownUsage)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      if (!knownUsage || signal?.aborted || !this.current(claim) || !lease.valid()) return this.close(claim, knownUsage)
      try {
        const live = p.source(commissionId, tenantId, userId, approval.execution) ?? denied()
        p.commit(() => {
          p.registry.beginEffect(source.project.id, itemId, call, {
            configurationRevision: live.commission.configurationRevision ?? 0, reviewHash: commissionMcpReviewFacts(live).reviewHash,
            now: p.now(), connection: p.connection, allowLocalPrograms: p.allowLocalPrograms?.() === true,
          })
          p.changed(commissionId, source.project.id)
        })
      } catch (error) {
        if (!p.ready()) throw error
        return this.close(claim, true)
      }
      let outcome: McpBoundExecutionOutcome
      try {
        outcome = await p.execute(claim.permission.tenantId, call,
          () => !signal?.aborted && lease.valid() && this.current(claim, call), userId, signal)
      } catch (error) {
        if (!p.ready()) throw error
        outcome = { status: 'uncertain', summary: 'The external call did not return a verified result.' }
      }
      const represented = p.registry.claim(source.project.id, itemId)!
      if (represented.phase !== 'effect' || represented.attempt.status !== 'pending') return represented
      const publish = !signal?.aborted && lease.valid() && this.current(claim, call)
      return p.commit(() => {
        const settled = p.registry.settleEffect(source.project.id, itemId, outcome, Math.max(p.now(), claim.startedAt))
        if (publish && settled.phase === 'effect' && settled.attempt.status === 'done') p.complete(settled)
        if (settled.phase === 'effect' && (settled.attempt.status === 'failed' || settled.attempt.status === 'uncertain')) {
          this.withdrawClaimApproval(claim)
        }
        p.changed(commissionId, source.project.id)
        return settled
      })
    } finally { lease.release() }
  }

  private scope(claim: StoredCommissionMcpClaim): CommissionMcpScope {
    const { tenantId, ownerUserId, commissionId, projectId, agentId } = claim.permission
    return { tenantId, ownerUserId, commissionId, projectId, agentId }
  }

  private current(claim: StoredCommissionMcpClaim, call = fixedCall(claim)): boolean {
    const p = this.port
    if (!p.ready()) return false
    const { tenantId, ownerUserId, commissionId, projectId } = claim.permission
    const represented = p.registry.claim(projectId, claim.work.itemId)
    if (!represented || represented.intentHash !== claim.intentHash || represented.phase === 'closed' ||
      (represented.phase === 'effect' && represented.attempt.status !== 'pending')) return false
    const source = p.source(commissionId, tenantId, ownerUserId, claim.permission.policy.approval!.execution)
    const work = p.work(projectId, claim.work.itemId)
    if (!source || source.blockedReason || !work || !sameMcpPermissionJson(work, claim.work) || !p.budgetAvailable(source, claim.id) ||
      !source.tools.some(row => row.connectionId === call.connectionId && row.connectionRevision === call.connectionRevision &&
        row.schemaHash === call.schemaHash && row.tool.name === call.toolName)) return false
    return commissionMcpCallPermitted(claim.permission, p.registry.policy(this.scope(claim)), {
      configurationRevision: source.commission.configurationRevision ?? 0, reviewHash: commissionMcpReviewFacts(source).reviewHash,
    }, call, p.now(), p.connection, p.allowLocalPrograms?.() === true)
  }

  private close(claim: StoredCommissionMcpClaim, known: boolean): StoredCommissionMcpClaim {
    const p = this.port
    return p.commit(() => {
      p.usage.settleReservation(claim.id, claim.permission.tenantId, known)
      const current = p.registry.claim(claim.permission.projectId, claim.work.itemId)!
      const closed = current.phase === 'preparing' ? p.registry.closePreparation(claim.permission.projectId,
        claim.work.itemId, known ? 'failed' : 'uncertain', Math.max(p.now(), claim.startedAt)) : current
      if (closed.phase === 'closed') this.withdrawClaimApproval(claim)
      p.changed(claim.permission.commissionId, claim.permission.projectId)
      return closed
    })
  }

  /** A paid attempt that cannot be trusted must stop future work under this
   * approval. Compare the complete approval snapshot before revoking so a
   * replacement issued while the model or MCP call was in flight survives. */
  private withdrawClaimApproval(claim: StoredCommissionMcpClaim): void {
    const scope = this.scope(claim)
    const current = this.port.registry.policy(scope)
    if (current && sameMcpPermissionJson(current, claim.permission)) {
      this.port.registry.revoke(scope, claim.permission.policy.revision)
    }
  }
}
