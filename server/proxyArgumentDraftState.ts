/** Strict private receipt handling for optional owner-initiated MCP argument
 * drafting. Receipts record bounded arguments only; model input and credentials
 * are never persisted here. */
import type { AgentRequestArgumentDraft, AgentRequestArgumentDraftBinding } from '../contract/agentRequests.ts'
import { AGENT_REQUEST_ARGUMENT_DRAFT_MAX_BYTES } from '../contract/agentRequests.ts'
import type { McpJsonValue } from '../contract/mcpExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'

export const PROXY_ARGUMENT_DRAFT_MAX_BYTES = AGENT_REQUEST_ARGUMENT_DRAFT_MAX_BYTES

/** Stable private UsageRegistry join for the one optional draft reservation. */
export function proxyArgumentReservationId(requestId: string): string {
  return `${requestId}:arguments`
}

const invalid = (): never => { throw new Error('Invalid Agent request argument draft.') }
const record = (value: unknown): value is Record<string, McpJsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value)
const stamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
function detached(value: unknown): McpJsonValue {
  return snapshotMcpJson(value, { maxBytes: 64 * 1_024, maxDepth: 32, maxNodes: 8_192 })
}
function fields(value: Record<string, McpJsonValue>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid()
}

export function parseProxyArgumentDraftBinding(value: unknown): AgentRequestArgumentDraftBinding {
  try {
    const copy = detached(value)
    if (!record(copy)) return invalid()
    fields(copy, ['agentRevision', 'providerId', 'providerRevision', 'providerConnectionRevision', 'model',
      'connectionId', 'connectionRevision', 'toolName', 'schemaHash', 'transport'])
    if (!stamp(copy.agentRevision) || !stamp(copy.providerRevision) || !stamp(copy.providerConnectionRevision) ||
        !stamp(copy.connectionRevision) || !identifier(copy.providerId) || !identifier(copy.model) ||
        !identifier(copy.connectionId) || !identifier(copy.toolName) ||
        typeof copy.schemaHash !== 'string' || !/^[a-f0-9]{64}$/.test(copy.schemaHash) ||
        (copy.transport !== 'http' && copy.transport !== 'stdio')) return invalid()
    return {
      agentRevision: copy.agentRevision, providerId: copy.providerId,
      providerRevision: copy.providerRevision, providerConnectionRevision: copy.providerConnectionRevision,
      model: copy.model, connectionId: copy.connectionId, connectionRevision: copy.connectionRevision,
      toolName: copy.toolName, schemaHash: copy.schemaHash, transport: copy.transport,
    }
  } catch { return invalid() }
}

export function parseProxyArgumentDraft(value: unknown, createdAt = 0): AgentRequestArgumentDraft {
  try {
    const copy = detached(value)
    if (!record(copy)) return invalid()
    fields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt'], ['finishedAt', 'arguments'])
    const binding = parseProxyArgumentDraftBinding(copy.binding)
    if (typeof copy.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(copy.inputHash) ||
        !stamp(copy.startedAt) || copy.startedAt < createdAt) return invalid()
    const base = { binding, inputHash: copy.inputHash, startedAt: copy.startedAt }
    if (copy.status === 'pending') {
      fields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt'])
      if (copy.revision !== 1) return invalid()
      return { revision: 1, status: 'pending', ...base }
    }
    if (!stamp(copy.finishedAt) || copy.finishedAt < copy.startedAt || copy.revision !== 2) return invalid()
    if (copy.status === 'done') {
      fields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt', 'finishedAt', 'arguments'])
      const args = snapshotMcpJson(copy.arguments, { maxBytes: PROXY_ARGUMENT_DRAFT_MAX_BYTES, maxDepth: 32, maxNodes: 8_192 })
      if (!record(args) || Buffer.byteLength(JSON.stringify(args), 'utf8') > PROXY_ARGUMENT_DRAFT_MAX_BYTES) return invalid()
      return { revision: 2, status: 'done', ...base, finishedAt: copy.finishedAt, arguments: args }
    }
    if (copy.status === 'failed' || copy.status === 'uncertain') {
      fields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt', 'finishedAt'])
      return { revision: 2, status: copy.status, ...base, finishedAt: copy.finishedAt }
    }
    return invalid()
  } catch { return invalid() }
}

export function createPendingProxyArgumentDraft(
  binding: AgentRequestArgumentDraftBinding,
  inputHash: string,
  startedAt: number,
  createdAt: number,
): AgentRequestArgumentDraft {
  return parseProxyArgumentDraft({ revision: 1, status: 'pending', binding, inputHash, startedAt }, createdAt)
}

export function settleProxyArgumentDraft(
  value: AgentRequestArgumentDraft,
  inputHash: string,
  outcome: { status: 'done'; arguments: Record<string, McpJsonValue> } | { status: 'failed' | 'uncertain' },
  finishedAt: number,
  createdAt: number,
): AgentRequestArgumentDraft {
  const pending = parseProxyArgumentDraft(value, createdAt)
  if (pending.status !== 'pending' || pending.inputHash !== inputHash || !stamp(finishedAt) || finishedAt < pending.startedAt) return invalid()
  return parseProxyArgumentDraft({
    revision: 2, status: outcome.status, binding: pending.binding, inputHash: pending.inputHash,
    startedAt: pending.startedAt, finishedAt,
    ...(outcome.status === 'done' ? { arguments: outcome.arguments } : {}),
  }, createdAt)
}
