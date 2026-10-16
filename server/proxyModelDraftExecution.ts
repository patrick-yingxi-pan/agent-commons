/** Shared physical worker for owner-initiated private model advice. Strategies
 * own input/output grammar; this host owns durable admission, usage, cancellation
 * and non-replay. No strategy receives a tool-execution or disclosure port. */
import { createHash } from 'node:crypto'
import type { Budget } from '../contract/index.ts'
import type { ProviderConfig } from './data/providers.ts'
import type { ModelUsageHandler } from './modelUsage.ts'
import { UsageRecordingError } from './modelUsage.ts'
import type { ProxyActor, ProxyParty, StoredProxyRequest } from './proxyRequestState.ts'
import { ProxyRequestError, ProxyRequestRegistry } from './proxyRequestRegistry.ts'
import { UsageRegistry, UsageReservationError } from './usageRegistry.ts'

export interface ProxyModelDraftSource<P> {
  prepared: P & { allowanceTokens: number }
  config: ProviderConfig
  budgets: (Budget | undefined)[]
}
export interface ProxyModelDraftPort<B, P, R, N, S extends ProxyModelDraftSource<P>> {
  registry: ProxyRequestRegistry
  usage: UsageRegistry
  ready(): boolean
  source(row: StoredProxyRequest, binding: B, notes: N): S | undefined
  otherWorkers(): ProxyParty[]
  generate(input: S['prepared'], config: ProviderConfig, signal: AbortSignal, usage: ModelUsageHandler): Promise<R>
  commit<T>(operation: () => T): T
  changed(id: string): void
  now(): number
  onError(error: unknown): void
}
interface DraftReceipt<B> { binding: B; inputHash: string; startedAt: number; status: string }
export interface ProxyModelDraftPlan<B, P, R, N, S extends ProxyModelDraftSource<P>> {
  parse(value: unknown): { expectedRevision: number; binding: B; notes: N }
  eligible(row: StoredProxyRequest): boolean
  live(row: StoredProxyRequest): boolean
  receipt(row: StoredProxyRequest): DraftReceipt<B> | undefined
  begin(row: StoredProxyRequest, actor: ProxyActor, revision: number, binding: B, hash: string, at: number): StoredProxyRequest
  settle(row: StoredProxyRequest, hash: string, outcome: { status: 'done'; value: R } | { status: 'failed' | 'uncertain' }, at: number): StoredProxyRequest
  validSource(source: S, binding: B): boolean
  validResult(source: S, binding: B, result: R, signal: AbortSignal): Promise<boolean>
  outputError(error: unknown): boolean
  reservationId(id: string): string
}
interface Worker<P, N, S extends ProxyModelDraftSource<P>> {
  row: StoredProxyRequest
  source: S
  notes: N
  controller: AbortController
  promise: Promise<void>
}
const inputHash = (prepared: unknown, binding: unknown) =>
  createHash('sha256').update(JSON.stringify({ prepared, binding })).digest('hex')

export class ProxyModelDraftExecution<B, P, R, N, S extends ProxyModelDraftSource<P>> {
  private readonly port: ProxyModelDraftPort<B, P, R, N, S>
  private readonly plan: ProxyModelDraftPlan<B, P, R, N, S>
  private readonly workers = new Map<string, Worker<P, N, S>>()
  private stopped = false
  private readonly timeoutMs: number
  constructor(port: ProxyModelDraftPort<B, P, R, N, S>, plan: ProxyModelDraftPlan<B, P, R, N, S>, timeoutMs = 60_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid model-draft deadline.')
    this.port = port; this.plan = plan; this.timeoutMs = timeoutMs
  }
  activeActors(): ProxyParty[] { return [...this.workers.values()].map(worker => ({ ...worker.row.intent.owner })) }
  start(id: string, actor: ProxyActor, value: unknown, authenticated: () => boolean): void {
    const p = this.port, plan = this.plan, row = p.registry.get(id)
    if (!row || row.intent.owner.userId !== actor.userId || row.intent.owner.tenantId !== actor.tenantId) throw new ProxyRequestError('unavailable')
    let input: ReturnType<typeof plan.parse>
    try { input = plan.parse(value) } catch { throw new ProxyRequestError('invalid') }
    if (row.revision !== input.expectedRevision || !plan.eligible(row)) throw new ProxyRequestError('conflict')
    let pending: StoredProxyRequest
    try { pending = plan.begin(row, actor, row.revision, input.binding, '0'.repeat(64), Math.max(p.now(), row.updatedAt)) }
    catch { throw new ProxyRequestError('invalid') }
    const binding = plan.receipt(pending)!.binding
    if (this.stopped || !p.ready() || authenticated() !== true) throw new ProxyRequestError('unavailable')
    const source = p.source(row, binding, input.notes)
    if (!source) throw new ProxyRequestError('unavailable')
    if (!plan.validSource(source, binding)) throw new ProxyRequestError('conflict')
    const active = [...this.activeActors(), ...p.otherWorkers()]
    if (active.length >= 4 || active.filter(owner => owner.tenantId === actor.tenantId).length >= 2 ||
        active.some(owner => owner.tenantId === actor.tenantId && owner.agentId === row.intent.owner.agentId)) throw new ProxyRequestError('limit')
    pending = plan.begin(row, actor, row.revision, binding, inputHash(source.prepared, binding), plan.receipt(pending)!.startedAt)
    p.registry.prepare(pending)
    const nextUsage = new UsageRegistry(p.now, () => actor.tenantId)
    nextUsage.rehydrate(p.usage.snapshot(), false)
    nextUsage.rehydrateReservations(p.usage.snapshotReservations())
    try { nextUsage.reserve(plan.reservationId(id), actor.tenantId, source.prepared.allowanceTokens, source.budgets) }
    catch (error) {
      if (error instanceof UsageReservationError) throw new ProxyRequestError(error.code === 'limit' ? 'limit' : 'conflict')
      throw error
    }
    let closed: () => void = () => {}
    const worker: Worker<P, N, S> = { row: pending, source: structuredClone(source), notes: structuredClone(input.notes),
      controller: new AbortController(), promise: new Promise<void>(resolve => { closed = resolve }) }
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
  private async perform(worker: Worker<P, N, S>, authenticated: () => boolean): Promise<void> {
    const p = this.port, plan = this.plan, id = worker.row.intent.id, draft = plan.receipt(worker.row)!, tenantId = worker.row.intent.owner.tenantId
    const reservationId = plan.reservationId(id)
    const current = (): boolean => {
      if (this.stopped || worker.controller.signal.aborted || !p.ready() || authenticated() !== true) return false
      const row = p.registry.get(id), receipt = row && plan.receipt(row)
      if (!row || !plan.live(row) || receipt?.status !== 'pending' || receipt.inputHash !== draft.inputHash) return false
      const source = p.source(row, draft.binding, worker.notes)
      return !!source && plan.validSource(source, draft.binding) && inputHash(source.prepared, draft.binding) === draft.inputHash &&
        JSON.stringify(source.config) === JSON.stringify(worker.source.config) &&
        p.usage.reservationWithinLimits(reservationId, tenantId, source.budgets)
    }
    let knownUsage = false
    const record: ModelUsageHandler = usage => {
      // Late usage is retained even after cancellation; it never grants a fresh
      // generation, usable suggestion, tool call or disclosure.
      p.commit(() => {
        p.usage.recordReserved(reservationId, tenantId, usage.inputTokens, usage.outputTokens)
        p.usage.settleReservation(reservationId, tenantId, true)
        p.changed(id)
      })
      knownUsage = true
    }
    let outcome: { status: 'done'; value: R } | { status: 'failed' | 'uncertain' } = { status: 'failed' }
    const timer = setTimeout(() => worker.controller.abort(), this.timeoutMs)
    try {
      // Before any dispatch, absence of spend is known locally. This closes
      // the unused hold; missing usage after dispatch is never treated as zero.
      if (!current()) record({ inputTokens: 0, outputTokens: 0 })
      else {
        const result = await p.generate(worker.source.prepared, worker.source.config, worker.controller.signal, record)
        if (knownUsage && current() && await plan.validResult(worker.source, draft.binding, result, worker.controller.signal) && current()) {
          outcome = { status: 'done', value: result }
        }
      }
    } catch (error) {
      if (error instanceof UsageRecordingError || !p.ready()) throw error
      outcome = { status: plan.outputError(error) ? 'failed' : 'uncertain' }
    } finally { clearTimeout(timer) }
    const row = p.registry.get(id), receipt = row && plan.receipt(row)
    if (!row || receipt?.status !== 'pending' || receipt.inputHash !== draft.inputHash) return
    if (!knownUsage) outcome = { status: 'uncertain' }
    const settled = plan.settle(row, draft.inputHash, outcome, Math.max(p.now(), row.updatedAt))
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
