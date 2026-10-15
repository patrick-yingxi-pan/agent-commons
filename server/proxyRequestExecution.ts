/** One explicit owner-approved call, with no queue or automatic retry. A live
 * slot belongs to the physical promise, not the visible request status. */
import type { AgentRequestApproval } from '../contract/agentRequests.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { beginProxyRequest, settleProxyRequest, type ProxyActor, type ProxyParty, type StoredProxyRequest } from './proxyRequestState.ts'
import { ProxyRequestError, ProxyRequestRegistry } from './proxyRequestRegistry.ts'

export interface ProxyRequestExecutionPort {
  registry: ProxyRequestRegistry
  ready(): boolean
  otherWorkers?(): ProxyParty[]
  /** Current exact people/Agents, visibility, reach, connection and transport. */
  permitted(row: StoredProxyRequest, approval: AgentRequestApproval): boolean
  execute(row: StoredProxyRequest, allowed: () => boolean, signal: AbortSignal): Promise<McpBoundExecutionOutcome>
  commit<T>(operation: () => T): T
  changed(id: string): void
  now(): number
  onError(error: unknown): void
}
interface Worker {
  row: StoredProxyRequest
  controller: AbortController
  promise: Promise<void>
}
const sameActor = (left: ProxyActor, right: ProxyActor) => left.userId === right.userId && left.tenantId === right.tenantId

export class ProxyRequestExecution {
  private readonly port: ProxyRequestExecutionPort
  private readonly workers = new Map<string, Worker>()
  private stopped = false
  constructor(port: ProxyRequestExecutionPort) { this.port = port }

  start(id: string, actor: ProxyActor, value: unknown, authenticated: () => boolean): void {
    const p = this.port, row = p.registry.get(id)
    if (!row || !sameActor(row.intent.owner, actor)) throw new ProxyRequestError('unavailable')
    let input: Record<string, unknown>
    try {
      const copy = snapshotMcpJson(value, { maxBytes: 66_000, maxDepth: 36, maxNodes: 8_208 })
      if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== 3 ||
          Object.keys(copy).some(key => !['action', 'expectedRevision', 'approval'].includes(key)) || copy.action !== 'run' ||
          !Number.isSafeInteger(copy.expectedRevision) || Number(copy.expectedRevision) < 1) throw new Error()
      input = copy
    } catch { throw new ProxyRequestError('invalid') }
    if (row.revision !== input.expectedRevision || row.status !== 'waiting' || row.executionBlockedByRestore || row.argumentDraft?.status === 'pending') throw new ProxyRequestError('conflict')
    let pending: StoredProxyRequest
    try { pending = beginProxyRequest(row, actor, row.revision, input.approval as AgentRequestApproval, Math.max(p.now(), row.updatedAt)) }
    catch { throw new ProxyRequestError('invalid') }
    if (this.stopped || !p.ready() || authenticated() !== true || !p.permitted(pending, pending.execution!.approval)) {
      throw new ProxyRequestError('unavailable')
    }
    const active = [...this.activeActors(), ...(p.otherWorkers?.() ?? [])]
    if (active.length >= 4 || active.filter(owner => owner.tenantId === actor.tenantId).length >= 2 ||
        active.some(owner => owner.tenantId === actor.tenantId && owner.agentId === row.intent.owner.agentId)) throw new ProxyRequestError('limit')
    p.registry.prepare(pending)
    let closed: () => void = () => {}
    const worker: Worker = { row: pending, controller: new AbortController(), promise: new Promise<void>(resolve => { closed = resolve }) }
    this.workers.set(id, worker)
    try { p.commit(() => { p.registry.put(pending); p.changed(id) }) }
    catch (error) { this.workers.delete(id); closed(); throw error }
    void Promise.resolve().then(() => this.perform(worker, authenticated))
      .catch(error => p.onError(error))
      .finally(() => { if (this.workers.get(id) === worker) this.workers.delete(id); closed() })
  }

  private async perform(worker: Worker, authenticated: () => boolean): Promise<void> {
    const p = this.port, frozen = worker.row, id = frozen.intent.id, execution = frozen.execution!
    const allowed = (): boolean => {
      if (this.stopped || worker.controller.signal.aborted || !p.ready() || authenticated() !== true) return false
      const row = p.registry.get(id)
      return !!row && row.status === 'running' && row.execution?.status === 'pending' &&
        row.execution.callHash === execution.callHash && p.permitted(row, execution.approval)
    }
    let outcome: McpBoundExecutionOutcome
    try {
      outcome = allowed() ? await p.execute(frozen, allowed, worker.controller.signal)
        : { status: 'failed', summary: 'Permission ended before dispatch.' }
    } catch { outcome = { status: 'uncertain', summary: 'No verified result was received.' } }
    const current = p.registry.get(id)
    if (!current || current.execution?.status !== 'pending' || current.execution.callHash !== execution.callHash) return
    const settled = settleProxyRequest(current, execution.callHash, outcome, Math.max(p.now(), current.updatedAt))
    // Late known results survive cancellation/revocation. They confer neither
    // renewed consent nor automatic disclosure, and are committed before hint.
    p.registry.prepare(settled)
    p.commit(() => { p.registry.put(settled); p.changed(id) })
  }

  cancel(id: string): void { this.workers.get(id)?.controller.abort() }
  activeActors(): ProxyParty[] { return [...this.workers.values()].map(worker => ({ ...worker.row.intent.owner })) }
  activeCount(): number { return this.workers.size }
  async stop(): Promise<void> {
    this.stopped = true
    for (const worker of this.workers.values()) worker.controller.abort()
    await Promise.allSettled([...this.workers.values()].map(worker => worker.promise))
  }
}
