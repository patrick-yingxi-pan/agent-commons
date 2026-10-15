/** Pure D15 request/consent/reply state. This is NOT an executor or an access
 * grant. The host must resolve both people and Agents, check current authority
 * across waits, commit before I/O, and retain live capacity until settlement.
 * No caller of this module may infer dispatch permission from a restored row. */
import { createHash } from 'node:crypto'
import type { McpJsonValue, McpToolResult } from '../contract/mcpExecution.ts'
import type { AgentRequestApproval, AgentRequestExecution, AgentRequestStateView, AgentRequestStatus } from '../contract/agentRequests.ts'
import { AGENT_REQUEST_TASK_MAX_BYTES, AGENT_REQUEST_REPLY_MAX_BYTES } from '../contract/agentRequests.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { parseMcpToolResult, MCP_TOOL_RESULT_MODERN_VERSION } from './mcpToolResult.ts'

export interface ProxyActor { tenantId: string; userId: string }
export interface ProxyParty extends ProxyActor { agentId: string }
export interface ProxyIntent {
  id: string
  requester: ProxyParty
  owner: ProxyParty
  task: string
  createdAt: number
}
export type ProxyApproval = AgentRequestApproval
type ProxyExecutionOutcome =
  | { status: 'pending' }
  | { status: 'done'; finishedAt: number; summary: string; result: McpToolResult }
  | { status: 'failed'; finishedAt: number; summary: string; result?: McpToolResult }
  | { status: 'uncertain'; finishedAt: number; summary: string }
export type ProxyExecution = AgentRequestExecution
export type ProxyRequestStatus = AgentRequestStatus
export interface StoredProxyRequest {
  version: 1
  intent: ProxyIntent
  revision: number
  status: ProxyRequestStatus
  updatedAt: number
  execution?: ProxyExecution
  reply?: string
  cancelledAt?: number
  cancelledBy?: 'requester' | 'owner'
  executionBlockedByRestore?: true
}
/** The host additionally enforces live membership and publishes only hints. */
export type ProxyRequestView = AgentRequestStateView

export const PROXY_TASK_MAX_BYTES = AGENT_REQUEST_TASK_MAX_BYTES
export const PROXY_REPLY_MAX_BYTES = AGENT_REQUEST_REPLY_MAX_BYTES
export const PROXY_RESULT_MAX_BYTES = 262_144
const SUMMARIES = {
  done: 'The MCP tool completed. Review a reply before sharing anything with the requester.',
  failed: 'The MCP call was refused before execution.',
  localFailed: 'The tool call was refused before execution. Starting the local program may already have had effects.',
  toolError: 'The MCP server returned a tool error. Its effects may have occurred.',
  uncertain: 'The MCP call may have had effects, but no valid saved result is available. It will not run again automatically.',
} as const
const invalid = (): never => { throw new Error('Invalid Agent request state or transition.') }
const record = (value: unknown): value is Record<string, McpJsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
const stamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value)
function prose(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length <= maxBytes && Buffer.from(value, 'utf8').toString('utf8') === value &&
    value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) &&
    Buffer.byteLength(value, 'utf8') <= maxBytes
}
function fields(value: Record<string, McpJsonValue>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid()
}
function detached(value: unknown): Record<string, McpJsonValue> {
  const copy = snapshotMcpJson(value, { maxBytes: 1_048_576, maxDepth: 40, maxNodes: 32_768 })
  return record(copy) ? copy : invalid()
}
function canonical(value: McpJsonValue): McpJsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  return record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
}
const json = (value: unknown): string => JSON.stringify(canonical(value as McpJsonValue))
function party(value: McpJsonValue): ProxyParty {
  if (!record(value)) return invalid()
  fields(value, ['tenantId', 'userId', 'agentId'])
  if (!identifier(value.tenantId) || !identifier(value.userId) || !identifier(value.agentId)) return invalid()
  return { tenantId: value.tenantId, userId: value.userId, agentId: value.agentId }
}
function intent(value: Record<string, McpJsonValue>): ProxyIntent {
  fields(value, ['id', 'requester', 'owner', 'task', 'createdAt'])
  if (typeof value.id !== 'string' || !/^agent-request-[a-f0-9]{32}$/.test(value.id) ||
      !prose(value.task, PROXY_TASK_MAX_BYTES) || !stamp(value.createdAt)) return invalid()
  const requester = party(value.requester)
  const owner = party(value.owner)
  if (requester.userId === owner.userId || requester.agentId === owner.agentId) return invalid()
  return { id: value.id, requester, owner, task: value.task, createdAt: value.createdAt }
}
function approval(value: McpJsonValue): ProxyApproval {
  if (!record(value)) return invalid()
  fields(value, value.transport === 'stdio' ? ['transport', 'localPrograms', 'call'] : ['transport', 'call'])
  const call = snapshotMcpBoundToolCall(value.call)
  if (!call) return invalid()
  if (value.transport === 'http') return { transport: 'http', call }
  if (value.transport === 'stdio' && value.localPrograms === true) return { transport: 'stdio', localPrograms: true, call }
  return invalid()
}
function callHash(source: ProxyIntent, approved: ProxyApproval, startedAt: number): string {
  return createHash('sha256').update(json({ domain: 'agent-request-call-v1', intent: source, approval: approved, startedAt })).digest('hex')
}
function exactResult(value: unknown): McpToolResult {
  const copy = snapshotMcpJson(value, { maxBytes: PROXY_RESULT_MAX_BYTES, maxDepth: 32, maxNodes: 16_384 })
  const parsed = parseMcpToolResult(copy, MCP_TOOL_RESULT_MODERN_VERSION)
  // A saved receipt is exact, not a chance to silently discard unknown fields.
  if (json(copy) !== json(parsed)) return invalid()
  return parsed
}
function execution(value: McpJsonValue, source: ProxyIntent): ProxyExecution {
  if (!record(value)) return invalid()
  fields(value, ['approval', 'callHash', 'startedAt', 'status'], ['finishedAt', 'summary', 'result'])
  const approved = approval(value.approval)
  if (!stamp(value.startedAt) || value.startedAt < source.createdAt || value.callHash !== callHash(source, approved, value.startedAt)) return invalid()
  const base = { approval: approved, callHash: value.callHash as string, startedAt: value.startedAt }
  if (value.status === 'pending') {
    fields(value, ['approval', 'callHash', 'startedAt', 'status'])
    return { ...base, status: 'pending' }
  }
  if (!stamp(value.finishedAt) || value.finishedAt < value.startedAt) return invalid()
  if (value.status === 'uncertain') {
    if (Object.hasOwn(value, 'result') || value.summary !== SUMMARIES.uncertain) return invalid()
    return { ...base, status: 'uncertain', finishedAt: value.finishedAt, summary: SUMMARIES.uncertain }
  }
  if (value.status !== 'done' && value.status !== 'failed') return invalid()
  const result = Object.hasOwn(value, 'result') ? exactResult(value.result) : undefined
  if (value.status === 'done' ? !result || result.isError : result && !result.isError) return invalid()
  const summary = value.status === 'done' ? SUMMARIES.done : result ? SUMMARIES.toolError :
    approved.transport === 'stdio' ? SUMMARIES.localFailed : SUMMARIES.failed
  if (value.summary !== summary) return invalid()
  return value.status === 'done'
    ? { ...base, status: 'done', finishedAt: value.finishedAt, summary, result: result! }
    : { ...base, status: 'failed', finishedAt: value.finishedAt, summary, ...(result ? { result } : {}) }
}

export function createProxyRequest(input: ProxyIntent): StoredProxyRequest {
  try {
    const source = intent(detached(input))
    return { version: 1, intent: source, revision: 1, status: 'waiting', updatedAt: source.createdAt }
  } catch { return invalid() }
}

/** Parse one detached private row, checking lifecycle coherence as well as
 * field types. A valid hash detects mixed receipts; it is NOT a signature. */
export function parseStoredProxyRequest(value: unknown): StoredProxyRequest {
  try {
    const copy = detached(value)
    fields(copy, ['version', 'intent', 'revision', 'status', 'updatedAt'], ['execution', 'reply', 'cancelledAt', 'cancelledBy', 'executionBlockedByRestore'])
    if (copy.version !== 1 || !record(copy.intent) || !stamp(copy.updatedAt)) return invalid()
    const source = intent(copy.intent)
    const run = Object.hasOwn(copy, 'execution') ? execution(copy.execution, source) : undefined
    if (Object.hasOwn(copy, 'executionBlockedByRestore') &&
        (copy.executionBlockedByRestore !== true || run || !['waiting', 'denied', 'cancelled'].includes(String(copy.status)))) return invalid()
    if (copy.updatedAt < source.createdAt || (run && copy.updatedAt < run.startedAt) ||
        (run && run.status !== 'pending' && copy.updatedAt < run.finishedAt)) return invalid()
    if (copy.status !== 'replied' && Object.hasOwn(copy, 'reply')) return invalid()
    if (copy.status !== 'cancelled' && (Object.hasOwn(copy, 'cancelledAt') || Object.hasOwn(copy, 'cancelledBy'))) return invalid()
    switch (copy.status) {
      case 'waiting':
        if (run || copy.revision !== 1 || copy.updatedAt !== source.createdAt) return invalid()
        break
      case 'running':
        if (!run || run.status !== 'pending' || copy.revision !== 2 || copy.updatedAt !== run.startedAt) return invalid()
        break
      case 'awaiting-reply':
        if (!run || run.status === 'pending' || copy.revision !== 3 || copy.updatedAt !== run.finishedAt) return invalid()
        break
      case 'replied':
        if (!run || run.status === 'pending' || copy.revision !== 4 || !prose(copy.reply, PROXY_REPLY_MAX_BYTES)) return invalid()
        break
      case 'denied':
        if (run || copy.revision !== 2) return invalid()
        break
      case 'cancelled':
        if (!stamp(copy.cancelledAt) || copy.cancelledAt < source.createdAt ||
            (copy.cancelledBy !== 'requester' && copy.cancelledBy !== 'owner') ||
            (run && copy.cancelledAt < run.startedAt) ||
            copy.updatedAt !== Math.max(copy.cancelledAt, run && run.status !== 'pending' ? run.finishedAt : 0) ||
            copy.revision !== (run ? run.status === 'pending' ? 3 : 4 : 2)) return invalid()
        break
      default: return invalid()
    }
    return {
      version: 1, intent: source, revision: copy.revision as number, status: copy.status, updatedAt: copy.updatedAt,
      ...(run ? { execution: run } : {}),
      ...(copy.status === 'replied' ? { reply: copy.reply as string } : {}),
      ...(copy.status === 'cancelled' ? { cancelledAt: copy.cancelledAt as number, cancelledBy: copy.cancelledBy as 'requester' | 'owner' } : {}),
      ...(copy.executionBlockedByRestore === true ? { executionBlockedByRestore: true } : {}),
    }
  } catch { return invalid() }
}

function role(row: StoredProxyRequest, value: ProxyActor): 'requester' | 'owner' | undefined {
  try {
    const actor = detached(value)
    fields(actor, ['tenantId', 'userId'])
    if (!identifier(actor.tenantId) || !identifier(actor.userId)) return undefined
    return (['requester', 'owner'] as const).find(key => row.intent[key].tenantId === actor.tenantId && row.intent[key].userId === actor.userId)
  } catch { return undefined }
}
function editable(value: StoredProxyRequest, actor: ProxyActor, revision: number, at: number, ownerOnly = false): StoredProxyRequest {
  const row = parseStoredProxyRequest(value)
  const who = role(row, actor)
  if (!who || (ownerOnly && who !== 'owner') || revision !== row.revision || !stamp(at) || at < row.updatedAt) return invalid()
  return row
}

/** Owner's explicit Run: host validates the current Agent and connection,
 * then must commit the returned pending row before one physical dispatch. */
export function beginProxyRequest(value: StoredProxyRequest, actor: ProxyActor, revision: number, input: ProxyApproval, at: number): StoredProxyRequest {
  const row = editable(value, actor, revision, at, true)
  if (row.status !== 'waiting' || row.executionBlockedByRestore) return invalid()
  let approved: ProxyApproval
  try { approved = approval(detached(input)) } catch { return invalid() }
  return parseStoredProxyRequest({ ...row, revision: 2, status: 'running', updatedAt: at,
    execution: { approval: approved, callHash: callHash(row.intent, approved, at), startedAt: at, status: 'pending' } })
}

/** Late known results remain owner-private even after Cancel or loss of current
 * authority. The host must match its frozen worker; no user may forge outcomes. */
export function settleProxyRequest(value: StoredProxyRequest, hash: string, outcome: McpBoundExecutionOutcome, at: number): StoredProxyRequest {
  const row = parseStoredProxyRequest(value)
  const run = row.execution
  if (!run || run.status !== 'pending' || hash !== run.callHash || !stamp(at) || at < row.updatedAt) return invalid()
  let terminal: ProxyExecutionOutcome = { status: 'uncertain', finishedAt: at, summary: SUMMARIES.uncertain }
  try {
    const received = detached(outcome)
    fields(received, ['status', 'summary'], ['result'])
    if (typeof received.summary !== 'string') return invalid()
    if (received.status === 'done' || received.status === 'failed') {
      const result = Object.hasOwn(received, 'result') ? exactResult(received.result) : undefined
      if (received.status === 'done' ? !result || result.isError : result && !result.isError) return invalid()
      terminal = received.status === 'done'
        ? { status: 'done', finishedAt: at, summary: SUMMARIES.done, result: result! }
        : { status: 'failed', finishedAt: at, summary: result ? SUMMARIES.toolError :
          run.approval.transport === 'stdio' ? SUMMARIES.localFailed : SUMMARIES.failed, ...(result ? { result } : {}) }
    }
  } catch { /* Invalid/unretainable outcomes are uncertainty, never no-effect evidence. */ }
  return parseStoredProxyRequest({ ...row, revision: row.revision + 1, updatedAt: at,
    status: row.status === 'cancelled' ? 'cancelled' : 'awaiting-reply', execution: { ...run, ...terminal } })
}

export function cancelProxyRequest(value: StoredProxyRequest, actor: ProxyActor, revision: number, at: number): StoredProxyRequest {
  const row = editable(value, actor, revision, at)
  if (!['waiting', 'running', 'awaiting-reply'].includes(row.status)) return invalid()
  return parseStoredProxyRequest({ ...row, revision: row.revision + 1, status: 'cancelled', updatedAt: at,
    cancelledAt: at, cancelledBy: role(row, actor)! })
}

export function denyProxyRequest(value: StoredProxyRequest, actor: ProxyActor, revision: number, at: number): StoredProxyRequest {
  const row = editable(value, actor, revision, at, true)
  if (row.status !== 'waiting') return invalid()
  return parseStoredProxyRequest({ ...row, revision: 2, status: 'denied', updatedAt: at })
}

/** Share exactly the owner's reviewed text, not the executor's result/summary.
 * This is intentional disclosure; automatic secret scanning cannot prove safety. */
export function shareProxyReply(value: StoredProxyRequest, actor: ProxyActor, revision: number, reply: string, at: number): StoredProxyRequest {
  const row = editable(value, actor, revision, at, true)
  if (row.status !== 'awaiting-reply' || !prose(reply, PROXY_REPLY_MAX_BYTES)) return invalid()
  return parseStoredProxyRequest({ ...row, revision: 4, status: 'replied', updatedAt: at, reply })
}

/** Recovery after the old worker is gone closes pending work, never queues it
 * again. For a still-live worker, cancel/abort and retain its pending receipt
 * and capacity until physical settlement instead of calling this prematurely. */
export function interruptProxyRequest(value: StoredProxyRequest, at: number): StoredProxyRequest {
  const row = parseStoredProxyRequest(value)
  return row.execution?.status === 'pending'
    ? settleProxyRequest(row, row.execution.callHash, { status: 'uncertain', summary: '' }, at)
    : row
}

export function proxyRequestView(value: StoredProxyRequest, actor: ProxyActor): ProxyRequestView | undefined {
  const row = parseStoredProxyRequest(value)
  const who = role(row, actor)
  if (!who) return undefined
  return {
    id: row.intent.id, fromAgentId: row.intent.requester.agentId, toAgentId: row.intent.owner.agentId,
    task: row.intent.task, createdAt: row.intent.createdAt, updatedAt: row.updatedAt,
    revision: row.revision, status: row.status,
    ...(row.reply === undefined ? {} : { reply: row.reply }),
    ...(who === 'owner' && row.execution ? { execution: row.execution } : {}),
    ...(row.executionBlockedByRestore ? { executionBlockedByRestore: true } : {}),
  }
}
