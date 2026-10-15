/** One private request history, projected to its two people. The Store owns
 * authentication, live authority, durable transactions and physical workers. */
import { createHash } from 'node:crypto'
import { AGENT_REQUEST_CREATE_MAX_BYTES } from '../contract/agentRequests.ts'
import type { AgentRequestCreate } from '../contract/agentRequests.ts'
import type { AgentOwnership } from './agentOwnership.ts'
import type { McpConnectionState } from './mcpConnections.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { PROXY_ARGUMENT_DRAFT_MAX_BYTES } from './proxyArgumentDraftState.ts'
import { parseStoredProxyRequest, interruptProxyRequest, PROXY_RESULT_MAX_BYTES, PROXY_REPLY_MAX_BYTES,
  type ProxyActor, type StoredProxyRequest } from './proxyRequestState.ts'

export const MAX_PROXY_REQUESTS = 1_000
export const MAX_PROXY_ACTIVE_REQUESTS = 100
export const MAX_PROXY_HISTORY_BYTES = 64 * 1_048_576
export class ProxyRequestError extends Error {
  readonly code: 'invalid' | 'unavailable' | 'conflict' | 'limit'
  constructor(code: ProxyRequestError['code']) { super(`Agent request ${code}.`); this.code = code }
}
const invalid = (): never => { throw new ProxyRequestError('invalid') }
const id = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value)
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
/** Reserve terminal receipt/reply space before admitting intent. Another
 * request cannot consume the bytes needed to retain a late physical result. */
function reservedBytes(row: StoredProxyRequest): number {
  // Accepted prose can double in JSON (quotes, backslashes, CR/LF and tabs);
  // controls with six-byte JSON escapes are rejected by the state parser.
  const replyBytes = 2 * PROXY_REPLY_MAX_BYTES
  const draftHeadroom = PROXY_ARGUMENT_DRAFT_MAX_BYTES + 4_096
  const extra = row.status === 'waiting' && !row.executionBlockedByRestore
    ? 65_536 + PROXY_RESULT_MAX_BYTES + replyBytes + 8_192 +
      (row.argumentDraft?.status === 'pending' ? draftHeadroom : 0)
    : row.argumentDraft?.status === 'pending' ? draftHeadroom
    : row.execution?.status === 'pending' ? PROXY_RESULT_MAX_BYTES + replyBytes + 8_192
    : row.status === 'awaiting-reply' ? replyBytes + 4_096
    : row.status === 'waiting' ? 4_096 : 0
  return bytes(row) + 1 + extra
}
const active = (row: StoredProxyRequest) => ['waiting', 'running', 'awaiting-reply'].includes(row.status) ||
  row.execution?.status === 'pending' || row.argumentDraft?.status === 'pending'
const sameActor = (left: ProxyActor, right: ProxyActor) => left.tenantId === right.tenantId && left.userId === right.userId

export function proxyRequestId(actor: ProxyActor, key: unknown): string {
  if (!id(actor.tenantId) || !id(actor.userId) || typeof key !== 'string' ||
      !/^[\x21-\x7e]{1,200}$/.test(key)) return invalid()
  return `agent-request-${createHash('sha256').update(JSON.stringify(['agent-request-v1', actor.tenantId, actor.userId, key])).digest('hex').slice(0, 32)}`
}
export function parseProxyRequestCreate(value: unknown): AgentRequestCreate {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: AGENT_REQUEST_CREATE_MAX_BYTES, maxDepth: 2, maxNodes: 8 })
    if (!copy || typeof copy !== 'object' || Array.isArray(copy) ||
        Object.keys(copy).length !== 3 || Object.keys(copy).some(key => !['fromAgentId', 'toAgentId', 'task'].includes(key)) ||
        !id(copy.fromAgentId) || !id(copy.toAgentId) || typeof copy.task !== 'string') return invalid()
    // The state kernel supplies the single prose/lifecycle validator after
    // the host resolves the two exact parties. Do not trim a replay's intent.
    return { fromAgentId: copy.fromAgentId, toAgentId: copy.toAgentId, task: copy.task }
  } catch { return invalid() }
}
export function parseProxyRequests(value: unknown): StoredProxyRequest[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_PROXY_REQUESTS) return invalid()
  try {
    const copy = snapshotMcpJson(value, { maxBytes: MAX_PROXY_HISTORY_BYTES, maxDepth: 42, maxNodes: MAX_PROXY_REQUESTS * 32_768 })
    if (!Array.isArray(copy)) return invalid()
    const seen = new Set<string>()
    const rows = copy.map(value => {
      const row = parseStoredProxyRequest(value)
      if (seen.has(row.intent.id)) return invalid()
      seen.add(row.intent.id)
      return row
    })
    const counts = new Map<string, number>()
    if (2 + rows.reduce((size, row) => size + reservedBytes(row), 0) > MAX_PROXY_HISTORY_BYTES) return invalid()
    for (const row of rows.filter(active)) for (const party of [row.intent.owner, row.intent.requester]) {
      const key = JSON.stringify([party.tenantId, party.userId])
      const count = (counts.get(key) ?? 0) + 1
      if (count > MAX_PROXY_ACTIVE_REQUESTS) return invalid()
      counts.set(key, count)
    }
    return rows
  } catch { return invalid() }
}

/** History survives retirement and membership loss; a retained identity is
 * never current permission. Connection joins describe the frozen transport. */
export function validateProxyRequestJoins(rows: StoredProxyRequest[], ownership: AgentOwnership[], connections: McpConnectionState): boolean {
  const owners = new Map(ownership.map(row => [row.agentId, row]))
  if (owners.size !== ownership.length) return false
  for (const row of rows) {
    for (const party of [row.intent.requester, row.intent.owner]) {
      const bound = owners.get(party.agentId)
      if (!bound || bound.tenantId !== party.tenantId || bound.ownerUserId !== party.userId) return false
    }
    const anchors = [
      ...(row.execution ? [{ connectionId: row.execution.approval.call.connectionId,
        transport: row.execution.approval.transport }] : []),
      ...(row.argumentDraft ? [{ connectionId: row.argumentDraft.binding.connectionId,
        transport: row.argumentDraft.binding.transport }] : []),
    ]
    for (const anchor of anchors) {
      const found = [...connections.connections, ...connections.retired].filter(connection => connection.id === anchor.connectionId)
      if (found.length !== 1) return false
      const connection = found[0]!
      if (connection.tenantId !== row.intent.owner.tenantId ||
          (connection.ownerUserId !== undefined && connection.ownerUserId !== row.intent.owner.userId) ||
          (connection.transport === 'stdio' ? 'stdio' : 'http') !== anchor.transport) return false
    }
  }
  return true
}

export class ProxyRequestRegistry {
  private rows = new Map<string, StoredProxyRequest>()
  private sizes = new Map<string, number>()
  private totalBytes = 2
  snapshot(): StoredProxyRequest[] { return [...this.rows.values()].map(parseStoredProxyRequest) }
  get(id: string): StoredProxyRequest | undefined {
    const row = this.rows.get(id)
    return row && parseStoredProxyRequest(row)
  }
  forActor(actor: ProxyActor): StoredProxyRequest[] {
    return [...this.rows.values()].filter(row => sameActor(row.intent.owner, actor) || sameActor(row.intent.requester, actor))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.intent.id.localeCompare(b.intent.id)).map(parseStoredProxyRequest)
  }
  rehydrate(value: unknown): void {
    const rows = parseProxyRequests(value)
    this.rows = new Map(rows.map(row => [row.intent.id, row]))
    this.sizes = new Map(rows.map(row => [row.intent.id, reservedBytes(row)]))
    this.totalBytes = 2 + [...this.sizes.values()].reduce((a, b) => a + b, 0)
  }
  prepare(value: StoredProxyRequest): StoredProxyRequest {
    const row = parseStoredProxyRequest(value)
    const previous = this.rows.get(row.intent.id)
    if (previous) {
      if (JSON.stringify(previous.intent) !== JSON.stringify(row.intent) || row.revision !== previous.revision + 1 ||
          previous.executionBlockedByRestore !== row.executionBlockedByRestore) throw new ProxyRequestError('conflict')
    } else if (row.status !== 'waiting' || this.rows.size >= MAX_PROXY_REQUESTS) throw new ProxyRequestError('limit')
    if (this.totalBytes - (this.sizes.get(row.intent.id) ?? 0) + reservedBytes(row) > MAX_PROXY_HISTORY_BYTES) throw new ProxyRequestError('limit')
    if (!previous && active(row)) for (const party of [row.intent.owner, row.intent.requester]) {
      if ([...this.rows.values()].filter(candidate => active(candidate) &&
          (sameActor(candidate.intent.owner, party) || sameActor(candidate.intent.requester, party))).length >= MAX_PROXY_ACTIVE_REQUESTS) {
        throw new ProxyRequestError('limit')
      }
    }
    return row
  }
  put(value: StoredProxyRequest): void {
    const row = this.prepare(value), size = reservedBytes(row)
    this.totalBytes += size - (this.sizes.get(row.intent.id) ?? 0)
    this.rows.set(row.intent.id, row)
    this.sizes.set(row.intent.id, size)
  }
  /** Only after an old process/worker is gone. The Store commits before serving. */
  recover(at: number): boolean {
    let changed = false
    for (const row of [...this.rows.values()]) if (row.execution?.status === 'pending' || row.argumentDraft?.status === 'pending') {
      this.put(interruptProxyRequest(row, Math.max(at, row.updatedAt)))
      changed = true
    }
    return changed
  }
}
