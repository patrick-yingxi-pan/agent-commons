/** Optional owner-started model advice. This worker has no MCP execution door:
 * its only output is a private argument draft for a later human review. */
import { createHash } from 'node:crypto'
import type { AgentRequestArgumentDraftBinding } from '../contract/agentRequests.ts'
import type { Budget } from '../contract/index.ts'
import type { McpDiscoveredTool } from '../contract/mcpConnections.ts'
import type { McpJsonValue } from '../contract/mcpExecution.ts'
import type { ProviderConfig } from './data/providers.ts'
import type { ModelUsageHandler } from './modelUsage.ts'
import { UsageRecordingError } from './modelUsage.ts'
import { ProxyArgumentPreparationOutputError, type PreparedProxyArgumentInput } from './proxyArgumentPreparation.ts'
import { beginProxyArgumentDraft, settleProxyArgumentDraft, type ProxyActor, type ProxyParty, type StoredProxyRequest } from './proxyRequestState.ts'
import { proxyArgumentReservationId } from './proxyArgumentDraftState.ts'
import { ProxyRequestError, ProxyRequestRegistry } from './proxyRequestRegistry.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { validateMcpSchema } from './mcpSchema.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { UsageRegistry, UsageReservationError } from './usageRegistry.ts'

export interface ProxyArgumentSource {
  prepared: PreparedProxyArgumentInput
  config: ProviderConfig
  budgets: (Budget | undefined)[]
  tool: McpDiscoveredTool
}
export interface ProxyArgumentExecutionPort {
  registry: ProxyRequestRegistry
  usage: UsageRegistry
  ready(): boolean
  /** Exact live people, Agent, provider and already-inspected tool; no I/O. */
  source(row: StoredProxyRequest, binding: AgentRequestArgumentDraftBinding): ProxyArgumentSource | undefined
  otherWorkers(): ProxyParty[]
  generate(input: PreparedProxyArgumentInput, config: ProviderConfig, signal: AbortSignal, usage: ModelUsageHandler): Promise<{ toolName: string; arguments: Record<string, McpJsonValue> }>
  commit<T>(operation: () => T): T
  changed(id: string): void
  now(): number
  onError(error: unknown): void
}
interface Worker {
  row: StoredProxyRequest
  source: ProxyArgumentSource
  controller: AbortController
  promise: Promise<void>
}
const inputHash = (source: ProxyArgumentSource, binding: AgentRequestArgumentDraftBinding) =>
  createHash('sha256').update(JSON.stringify({ prepared: source.prepared, binding })).digest('hex')

export class ProxyArgumentExecution {
  private readonly port: ProxyArgumentExecutionPort
  private readonly workers = new Map<string, Worker>()
  private stopped = false
  private readonly timeoutMs: number
  constructor(port: ProxyArgumentExecutionPort, timeoutMs = 60_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid argument-draft deadline.')
    this.port = port; this.timeoutMs = timeoutMs
  }
  activeActors(): ProxyParty[] { return [...this.workers.values()].map(worker => ({ ...worker.row.intent.owner })) }

  start(id: string, actor: ProxyActor, value: unknown, authenticated: () => boolean): void {
    const p = this.port, row = p.registry.get(id)
    if (!row || row.intent.owner.userId !== actor.userId || row.intent.owner.tenantId !== actor.tenantId) throw new ProxyRequestError('unavailable')
    let input: Record<string, McpJsonValue>
    try {
      const copy = snapshotMcpJson(value, { maxBytes: 4_096, maxDepth: 3, maxNodes: 32 })
      if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== 3 ||
          Object.keys(copy).some(key => !['action', 'expectedRevision', 'binding'].includes(key)) || copy.action !== 'draft-arguments' ||
          !Number.isSafeInteger(copy.expectedRevision)) throw new Error()
      input = copy
    } catch { throw new ProxyRequestError('invalid') }
    if (row.revision !== input.expectedRevision || row.status !== 'waiting' || row.argumentDraft || row.executionBlockedByRestore) throw new ProxyRequestError('conflict')
    // The state parser validates the exact binding before a source lookup.
    let pending: StoredProxyRequest
    try { pending = beginProxyArgumentDraft(row, actor, row.revision, input.binding as unknown as AgentRequestArgumentDraftBinding, '0'.repeat(64), Math.max(p.now(), row.updatedAt)) }
    catch { throw new ProxyRequestError('invalid') }
    const binding = pending.argumentDraft!.binding
    if (this.stopped || !p.ready() || authenticated() !== true) throw new ProxyRequestError('unavailable')
    const source = p.source(row, binding)
    if (!source) throw new ProxyRequestError('unavailable')
    if (source.prepared.toolName !== binding.toolName || source.tool.name !== binding.toolName ||
        mcpToolSchemaHash(source.tool) !== binding.schemaHash) throw new ProxyRequestError('conflict')
    const active = [...this.activeActors(), ...p.otherWorkers()]
    if (active.length >= 4 || active.filter(owner => owner.tenantId === actor.tenantId).length >= 2 ||
        active.some(owner => owner.tenantId === actor.tenantId && owner.agentId === row.intent.owner.agentId)) throw new ProxyRequestError('limit')
    pending = beginProxyArgumentDraft(row, actor, row.revision, binding, inputHash(source, binding), pending.argumentDraft!.startedAt)
    p.registry.prepare(pending)
    const nextUsage = new UsageRegistry(p.now, () => actor.tenantId)
    nextUsage.rehydrate(p.usage.snapshot(), false)
    nextUsage.rehydrateReservations(p.usage.snapshotReservations())
    try { nextUsage.reserve(proxyArgumentReservationId(id), actor.tenantId, source.prepared.allowanceTokens, source.budgets) }
    catch (error) {
      if (error instanceof UsageReservationError) throw new ProxyRequestError(error.code === 'limit' ? 'limit' : 'conflict')
      throw error
    }
    let closed: () => void = () => {}
    const worker: Worker = { row: pending, source: structuredClone(source), controller: new AbortController(), promise: new Promise<void>(resolve => { closed = resolve }) }
    this.workers.set(id, worker)
    try {
      p.commit(() => {
        p.registry.put(pending)
        p.usage.rehydrate(nextUsage.snapshot(), false)
        p.usage.rehydrateReservations(nextUsage.snapshotReservations())
        p.changed(id)
      })
    } catch (error) { this.workers.delete(id); closed(); throw error }
    void Promise.resolve().then(() => this.perform(worker, authenticated))
      .catch(error => p.onError(error))
      .finally(() => { if (this.workers.get(id) === worker) this.workers.delete(id); closed() })
  }

  private async perform(worker: Worker, authenticated: () => boolean): Promise<void> {
    const p = this.port, id = worker.row.intent.id, draft = worker.row.argumentDraft!, tenantId = worker.row.intent.owner.tenantId
    const reservationId = proxyArgumentReservationId(id)
    const current = (): boolean => {
      if (this.stopped || worker.controller.signal.aborted || !p.ready() || authenticated() !== true) return false
      const row = p.registry.get(id)
      if (!row || row.status !== 'waiting' || row.argumentDraft?.status !== 'pending' || row.argumentDraft.inputHash !== draft.inputHash) return false
      const source = p.source(row, draft.binding)
      return !!source && inputHash(source, draft.binding) === draft.inputHash &&
        JSON.stringify(source.config) === JSON.stringify(worker.source.config) &&
        p.usage.reservationWithinLimits(reservationId, tenantId, source.budgets)
    }
    let knownUsage = false
    const record: ModelUsageHandler = usage => {
      // A late valid usage report is retained even after cancellation/revocation.
      // It cannot make a stale draft usable or trigger another provider call.
      p.commit(() => {
        p.usage.recordReserved(reservationId, tenantId, usage.inputTokens, usage.outputTokens)
        p.usage.settleReservation(reservationId, tenantId, true)
        p.changed(id)
      })
      knownUsage = true
    }
    let outcome: { status: 'done'; arguments: Record<string, McpJsonValue> } | { status: 'failed' | 'uncertain' } = { status: 'failed' }
    const timer = setTimeout(() => worker.controller.abort(), this.timeoutMs)
    try {
      if (!current()) record({ inputTokens: 0, outputTokens: 0 })
      else {
        const result = await p.generate(worker.source.prepared, worker.source.config, worker.controller.signal, record)
        if (knownUsage && current() && result.toolName === draft.binding.toolName) {
          const valid = await validateMcpSchema(worker.source.tool.inputSchema, { value: result.arguments }, { signal: worker.controller.signal })
          if (valid.ok && current()) outcome = { status: 'done', arguments: result.arguments }
        }
      }
    } catch (error) {
      if (error instanceof UsageRecordingError || !p.ready()) throw error
      outcome = { status: error instanceof ProxyArgumentPreparationOutputError ? 'failed' : 'uncertain' }
    } finally { clearTimeout(timer) }
    const row = p.registry.get(id)
    if (!row || row.argumentDraft?.status !== 'pending' || row.argumentDraft.inputHash !== draft.inputHash) return
    // No result without accounting can become a usable suggestion.
    if (!knownUsage) outcome = { status: 'uncertain' }
    const settled = settleProxyArgumentDraft(row, draft.inputHash, outcome, Math.max(p.now(), row.updatedAt))
    p.registry.prepare(settled)
    p.commit(() => {
      p.registry.put(settled)
      p.usage.settleReservation(reservationId, tenantId, knownUsage)
      p.changed(id)
    })
  }
  cancel(id: string): void { this.workers.get(id)?.controller.abort() }
  async stop(): Promise<void> {
    this.stopped = true
    for (const worker of this.workers.values()) worker.controller.abort()
    await Promise.allSettled([...this.workers.values()].map(worker => worker.promise))
  }
}
