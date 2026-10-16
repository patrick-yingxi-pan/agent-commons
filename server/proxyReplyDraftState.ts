/** Strict private receipt handling for one owner-started reply suggestion.
 * Owner notes are input-only and deliberately never enter the durable receipt. */
import type { AgentRequestReplyDraft, AgentRequestReplyDraftBinding } from '../contract/agentRequests.ts'
import { AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES, AGENT_REQUEST_REPLY_NOTES_MAX_BYTES } from '../contract/agentRequests.ts'
import { snapshotMcpJson } from './mcpJson.ts'

export const PROXY_REPLY_DRAFT_MAX_BYTES = AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES
export function proxyReplyReservationId(requestId: string): string { return `${requestId}:reply` }

const invalid = (): never => { throw new Error('Invalid Agent request reply draft.') }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const stamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
function detached(value: unknown): Record<string, unknown> {
  // A maximum prose value can double when JSON-escaped (quotes/backslashes);
  // leave metadata slack while keeping the persisted envelope tightly bounded.
  const copy = snapshotMcpJson(value, { maxBytes: 72 * 1_024, maxDepth: 8, maxNodes: 64 })
  return record(copy) ? copy : invalid()
}
function exactFields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid()
}
function identifier(value: unknown): value is string { return typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value) }
function text(value: unknown, maxBytes: number, allowEmpty: boolean): value is string {
  return typeof value === 'string' && Buffer.from(value, 'utf8').toString('utf8') === value &&
    (allowEmpty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) &&
    Buffer.byteLength(value, 'utf8') <= maxBytes
}

export function parseProxyReplyDraftBinding(value: unknown): AgentRequestReplyDraftBinding {
  try {
    const copy = detached(value)
    exactFields(copy, ['agentRevision', 'providerId', 'providerRevision', 'providerConnectionRevision', 'model'])
    if (!stamp(copy.agentRevision) || !stamp(copy.providerRevision) || !stamp(copy.providerConnectionRevision) ||
        !identifier(copy.providerId) || !identifier(copy.model)) return invalid()
    return { agentRevision: copy.agentRevision as number, providerId: copy.providerId as string,
      providerRevision: copy.providerRevision as number, providerConnectionRevision: copy.providerConnectionRevision as number,
      model: copy.model as string }
  } catch { return invalid() }
}

export function parseProxyReplyDraftNotes(value: unknown): string {
  if (!text(value, AGENT_REQUEST_REPLY_NOTES_MAX_BYTES, true)) return invalid()
  return value
}

export function parseProxyReplyDraft(value: unknown, createdAt = 0): AgentRequestReplyDraft {
  try {
    const copy = detached(value)
    exactFields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt'], ['finishedAt', 'text'])
    const binding = parseProxyReplyDraftBinding(copy.binding)
    if (typeof copy.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(copy.inputHash) ||
        !stamp(copy.startedAt) || copy.startedAt < createdAt) return invalid()
    const base = { binding, inputHash: copy.inputHash, startedAt: copy.startedAt as number }
    if (copy.status === 'pending') {
      exactFields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt'])
      if (copy.revision !== 1) return invalid()
      return { revision: 1, status: 'pending', ...base }
    }
    if (!stamp(copy.finishedAt) || (copy.finishedAt as number) < base.startedAt || copy.revision !== 2) return invalid()
    if (copy.status === 'done') {
      exactFields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt', 'finishedAt', 'text'])
      if (!text(copy.text, PROXY_REPLY_DRAFT_MAX_BYTES, false)) return invalid()
      return { revision: 2, status: 'done', ...base, finishedAt: copy.finishedAt as number, text: copy.text }
    }
    if (copy.status === 'failed' || copy.status === 'uncertain') {
      exactFields(copy, ['revision', 'status', 'binding', 'inputHash', 'startedAt', 'finishedAt'])
      return { revision: 2, status: copy.status, ...base, finishedAt: copy.finishedAt as number }
    }
    return invalid()
  } catch { return invalid() }
}

export function createPendingProxyReplyDraft(binding: AgentRequestReplyDraftBinding, inputHash: string,
  startedAt: number, createdAt: number): AgentRequestReplyDraft {
  return parseProxyReplyDraft({ revision: 1, status: 'pending', binding, inputHash, startedAt }, createdAt)
}

export function settleProxyReplyDraft(value: AgentRequestReplyDraft, inputHash: string,
  outcome: { status: 'done'; text: string } | { status: 'failed' | 'uncertain' },
  finishedAt: number, createdAt: number): AgentRequestReplyDraft {
  const pending = parseProxyReplyDraft(value, createdAt)
  if (pending.status !== 'pending' || pending.inputHash !== inputHash || !stamp(finishedAt) || finishedAt < pending.startedAt) return invalid()
  return parseProxyReplyDraft({ revision: 2, status: outcome.status, binding: pending.binding,
    inputHash: pending.inputHash, startedAt: pending.startedAt, finishedAt,
    ...(outcome.status === 'done' ? { text: outcome.text } : {}) }, createdAt)
}
