/** Integrated request-history operations. Authentication is supplied by the
 * route; every read/write rechecks the exact person's current membership. */
import type { AgentRequestSummary, AgentRequestView } from '../contract/agentRequests.ts'
import { AGENT_REQUEST_DECISION_MAX_BYTES } from '../contract/agentRequests.ts'
import type { Agent } from '../contract/workers.ts'
import type { AgentOwnership } from './agentOwnership.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { createProxyRequest, cancelProxyRequest, denyProxyRequest, shareProxyReply, proxyRequestView,
  type ProxyActor, type StoredProxyRequest } from './proxyRequestState.ts'
import { ProxyRequestRegistry, ProxyRequestError, proxyRequestId, parseProxyRequestCreate } from './proxyRequestRegistry.ts'

export interface ProxyRequestHostPort {
  registry: ProxyRequestRegistry
  agent(id: string): Agent | undefined
  ownership(id: string): AgentOwnership | undefined
  active(actor: ProxyActor): boolean
  visible(agent: Agent, tenantId: string): boolean
  commit<T>(operation: () => T): T
  changed(id: string): void
  now(): number
}

export class ProxyRequestHost {
  private readonly port: ProxyRequestHostPort
  constructor(port: ProxyRequestHostPort) { this.port = port }
  private project(row: StoredProxyRequest, actor: ProxyActor): AgentRequestView | undefined {
    if (!this.port.active(actor)) return undefined
    const view = proxyRequestView(row, actor)
    if (!view) return undefined
    const from = this.port.agent(row.intent.requester.agentId), to = this.port.agent(row.intent.owner.agentId)
    return { ...view, role: row.intent.owner.userId === actor.userId && row.intent.owner.tenantId === actor.tenantId ? 'owner' : 'requester',
      fromAgentLabel: from && this.port.visible(from, actor.tenantId) ? from.label : 'Requesting Agent',
      toAgentLabel: to && this.port.visible(to, actor.tenantId) ? to.label : 'Receiving Agent',
      fromAgentAvailable: !!from, toAgentAvailable: !!to }
  }
  read(id: string, actor: ProxyActor): AgentRequestView | undefined {
    const row = this.port.registry.get(id)
    return row && this.project(row, actor)
  }
  list(actor: ProxyActor): AgentRequestSummary[] {
    if (!this.port.active(actor)) return []
    return this.port.registry.forActor(actor).flatMap(row => {
      const view = this.project(row, actor)
      if (!view) return []
      const { execution: _execution, reply: _reply, ...summary } = view
      return [summary]
    })
  }
  /** Execution needs live authority on both sides; historical readability is
   * deliberately weaker and survives unpublication or Agent retirement. */
  executable(row: StoredProxyRequest): boolean {
    const { requester, owner } = row.intent
    const from = this.port.agent(requester.agentId), to = this.port.agent(owner.agentId)
    const fromOwner = this.port.ownership(requester.agentId), toOwner = this.port.ownership(owner.agentId)
    return !!from && !!to && !!fromOwner && !!toOwner && !fromOwner.retired && !toOwner.retired &&
      from.tenantId === requester.tenantId && to.tenantId === owner.tenantId &&
      fromOwner.tenantId === requester.tenantId && fromOwner.ownerUserId === requester.userId &&
      toOwner.tenantId === owner.tenantId && toOwner.ownerUserId === owner.userId &&
      this.port.active(requester) && this.port.active(owner) && this.port.visible(to, requester.tenantId)
  }
  create(actor: ProxyActor, key: unknown, value: unknown): AgentRequestView {
    if (!this.port.active(actor)) throw new ProxyRequestError('unavailable')
    const id = proxyRequestId(actor, key), input = parseProxyRequestCreate(value)
    const previous = this.port.registry.get(id)
    if (previous) {
      const view = this.project(previous, actor)
      if (!view || view.role !== 'requester') throw new ProxyRequestError('unavailable')
      if (previous.intent.requester.agentId !== input.fromAgentId || previous.intent.owner.agentId !== input.toAgentId || previous.intent.task !== input.task) {
        throw new ProxyRequestError('conflict')
      }
      return view
    }
    const from = this.port.agent(input.fromAgentId), to = this.port.agent(input.toAgentId)
    const requester = this.port.ownership(input.fromAgentId), owner = this.port.ownership(input.toAgentId)
    if (!from || !to || !requester || !owner || requester.retired || owner.retired ||
        requester.tenantId !== actor.tenantId || requester.ownerUserId !== actor.userId || from.tenantId !== requester.tenantId ||
        to.tenantId !== owner.tenantId || owner.ownerUserId === actor.userId ||
        !this.port.visible(to, actor.tenantId) || !this.port.active({ tenantId: owner.tenantId, userId: owner.ownerUserId })) {
      throw new ProxyRequestError('unavailable')
    }
    let row: StoredProxyRequest
    try {
      row = createProxyRequest({ id, requester: { ...actor, agentId: from.id },
        owner: { tenantId: owner.tenantId, userId: owner.ownerUserId, agentId: to.id }, task: input.task, createdAt: this.port.now() })
    } catch { throw new ProxyRequestError('invalid') }
    this.port.registry.prepare(row)
    this.port.commit(() => { this.port.registry.put(row); this.port.changed(id) })
    return this.project(row, actor)!
  }
  /** Human decisions use revision preconditions. Ambiguous transport recovers
   * via read(), never by repeating an effect. No execution is started here. */
  decide(id: string, actor: ProxyActor, value: unknown): AgentRequestView {
    const row = this.port.registry.get(id)
    if (!row || !this.project(row, actor)) throw new ProxyRequestError('unavailable')
    let input: Record<string, unknown>
    try {
      const copy = snapshotMcpJson(value, { maxBytes: AGENT_REQUEST_DECISION_MAX_BYTES, maxDepth: 2, maxNodes: 8 })
      if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error()
      input = copy
      const fields = input.action === 'share' ? ['action', 'expectedRevision', 'reply'] : ['action', 'expectedRevision']
      if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key)) ||
          !['deny', 'cancel', 'share'].includes(String(input.action)) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) throw new Error()
    } catch { throw new ProxyRequestError('invalid') }
    if (row.revision !== input.expectedRevision) throw new ProxyRequestError('conflict')
    let next: StoredProxyRequest
    try {
      const now = Math.max(this.port.now(), row.updatedAt)
      next = input.action === 'deny' ? denyProxyRequest(row, actor, row.revision, now) :
        input.action === 'cancel' ? cancelProxyRequest(row, actor, row.revision, now) :
        shareProxyReply(row, actor, row.revision, input.reply as string, now)
    } catch { throw new ProxyRequestError('conflict') }
    this.port.registry.prepare(next)
    this.port.commit(() => { this.port.registry.put(next); this.port.changed(id) })
    return this.project(next, actor)!
  }
}
