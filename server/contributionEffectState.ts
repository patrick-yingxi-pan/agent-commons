/** Pure preparation and receipt transitions for real Contribution effects.
 * The store owns current Project authority, atomic cardinality reservation and
 * commit-before-I/O. A value constructed here alone proves none of those acts. */
import { createHash } from 'node:crypto'
import { CONTRIBUTION_EFFECT_RESULT_MAX_BYTES, type ContributionEffectRun, type ContributionEffectRunState } from '../contract/contributionExecution.ts'
import type { McpBoundToolCall, McpJsonValue, McpToolResult } from '../contract/mcpExecution.ts'
import { isContributionEffectExecutionId } from './contributionEffectExecutionIdentity.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { parseMcpToolResult } from './mcpToolResult.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'

export interface ContributionEffectIntent {
  id: string
  tenantId: string
  /** Private person owner for OAuth or stdio; absent for legacy HTTP authority. */
  ownerUserId?: string
  /** Registry-derived local-process identity; absent preserves historic HTTP hashes. */
  transport?: 'stdio'
  projectId: string
  contributionId: string
  envelopeVersion: number
  lineId: string
  actor: string
  connectionLabel: string
  call: McpBoundToolCall
  startedAt: number
}

export type StoredContributionEffectAttempt = ContributionEffectIntent & {
  callHash: string
} & ContributionEffectRunState

/** Receipt identities are append-only: admission closes at this bound instead
 * of pruning an old key that could otherwise become executable after restart. */
export const CONTRIBUTION_EFFECT_ATTEMPT_MAX = 100

const INTENT_FIELDS = ['id', 'tenantId', 'projectId', 'contributionId', 'envelopeVersion', 'lineId', 'actor', 'connectionLabel', 'call', 'startedAt']
const OPTIONAL_INTENT_FIELDS = ['ownerUserId', 'transport'] as const
const TERMINAL_FIELDS = ['callHash', 'status', 'finishedAt', 'summary', 'result']
const SUMMARIES = {
  done: 'The MCP tool completed.',
  failed: 'The MCP call was refused before execution.',
  localFailed: 'The tool call was refused before execution. Starting the local program may already have had effects.',
  toolError: 'The MCP server returned a tool error. Its effects may have occurred.',
  uncertain: 'The MCP server may have accepted this call, but no valid saved result is available. It will not be run again automatically.',
} as const
const invalid = (): never => { throw new Error('Invalid Contribution execution receipt.') }
const record = (value: unknown): value is Record<string, McpJsonValue> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
const ownerUserId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim().length > 0 && /^[\x20-\x7e]+$/.test(value)
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

function canonical(value: McpJsonValue): McpJsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
const sameJson = (a: McpJsonValue, b: McpJsonValue): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

function detached(value: unknown): Record<string, McpJsonValue> {
  const copy = snapshotMcpJson(value, { maxBytes: 327_680, maxDepth: 40, maxNodes: 24_576 })
  if (!record(copy)) return invalid()
  return copy
}

function invocation(value: McpJsonValue): McpBoundToolCall {
  return snapshotMcpBoundToolCall(value) ?? invalid()
}

function intentFrom(copy: Record<string, McpJsonValue>): ContributionEffectIntent {
  if (!text(copy.id) || !isContributionEffectExecutionId(copy.id) ||
      (Object.hasOwn(copy, 'ownerUserId') && !ownerUserId(copy.ownerUserId)) ||
      (Object.hasOwn(copy, 'transport') && copy.transport !== 'stdio') ||
      (copy.transport === 'stdio' && !Object.hasOwn(copy, 'ownerUserId')) ||
      !['tenantId', 'projectId', 'contributionId', 'lineId'].every((key) => text(copy[key])) ||
      !text(copy.actor, 2000) || !text(copy.connectionLabel, 2000) ||
      !timestamp(copy.startedAt) || !timestamp(copy.envelopeVersion) || copy.envelopeVersion < 1) return invalid()
  return { id: copy.id, tenantId: copy.tenantId as string, projectId: copy.projectId as string,
    ...(Object.hasOwn(copy, 'ownerUserId') ? { ownerUserId: copy.ownerUserId as string } : {}),
    ...(copy.transport === 'stdio' ? { transport: 'stdio' as const } : {}),
    contributionId: copy.contributionId as string, lineId: copy.lineId as string, actor: copy.actor,
    connectionLabel: copy.connectionLabel, envelopeVersion: copy.envelopeVersion,
    startedAt: copy.startedAt, call: invocation(copy.call) }
}

function callHash(intent: ContributionEffectIntent): string {
  return createHash('sha256').update(JSON.stringify(canonical({
    id: intent.id, tenantId: intent.tenantId, projectId: intent.projectId, contributionId: intent.contributionId,
    ...(intent.ownerUserId === undefined ? {} : { ownerUserId: intent.ownerUserId }),
    ...(intent.transport === undefined ? {} : { transport: intent.transport }),
    envelopeVersion: intent.envelopeVersion, lineId: intent.lineId, call: intent.call as unknown as McpJsonValue,
  }))).digest('hex')
}

function exactResult(value: unknown): McpToolResult {
  const copy = snapshotMcpJson(value, { maxBytes: CONTRIBUTION_EFFECT_RESULT_MAX_BYTES, maxDepth: 32, maxNodes: 16_384 })
  const result = parseMcpToolResult(copy, MCP_MODERN_VERSION)
  if (!sameJson(copy, result as unknown as McpJsonValue)) return invalid()
  return result
}

export function createContributionEffectAttempt(input: ContributionEffectIntent): StoredContributionEffectAttempt {
  try {
    const copy = detached(input)
    if (Object.keys(copy).length !== INTENT_FIELDS.length + OPTIONAL_INTENT_FIELDS.filter(key => Object.hasOwn(copy, key)).length ||
        Object.keys(copy).some((key) => !INTENT_FIELDS.includes(key) && !(OPTIONAL_INTENT_FIELDS as readonly string[]).includes(key))) return invalid()
    const intent = intentFrom(copy)
    return { ...intent, callHash: callHash(intent), status: 'pending' }
  } catch { return invalid() }
}

/** Strict persisted single-row admission. Legacy absence belongs to the outer
 * snapshot parser; present malformed data never becomes a fresh approval. */
export function parseStoredContributionEffectAttempt(value: unknown): StoredContributionEffectAttempt {
  try {
    const copy = detached(value)
    if (Object.keys(copy).some((key) => !INTENT_FIELDS.includes(key) && !(OPTIONAL_INTENT_FIELDS as readonly string[]).includes(key) && !TERMINAL_FIELDS.includes(key))) return invalid()
    const intent = intentFrom(copy)
    if (copy.callHash !== callHash(intent)) return invalid()
    const base = { ...intent, callHash: copy.callHash }
    if (copy.status === 'pending') {
      if (['finishedAt', 'summary', 'result'].some((key) => Object.hasOwn(copy, key))) return invalid()
      return { ...base, status: 'pending' }
    }
    if (!timestamp(copy.finishedAt) || copy.finishedAt < intent.startedAt) return invalid()
    if (copy.status === 'uncertain') {
      if (Object.hasOwn(copy, 'result') || copy.summary !== SUMMARIES.uncertain) return invalid()
      return { ...base, status: 'uncertain', finishedAt: copy.finishedAt, summary: SUMMARIES.uncertain }
    }
    if (copy.status !== 'done' && copy.status !== 'failed') return invalid()
    const result = Object.hasOwn(copy, 'result') ? exactResult(copy.result) : undefined
    if (copy.status === 'done' ? !result || result.isError : result && !result.isError) return invalid()
    const summary = copy.status === 'done' ? SUMMARIES.done : result ? SUMMARIES.toolError :
      intent.transport === 'stdio' ? SUMMARIES.localFailed : SUMMARIES.failed
    if (copy.summary !== summary) return invalid()
    return copy.status === 'done'
      ? { ...base, status: 'done', finishedAt: copy.finishedAt, summary, result: result! }
      : { ...base, status: 'failed', finishedAt: copy.finishedAt, summary, ...(result ? { result } : {}) }
  } catch { return invalid() }
}

/** The caller must commit the returned terminal row atomically with its ledger
 * effects. Never releases a possibly consumed slot on invalid/oversized output. */
export function settleContributionEffectAttempt(
  value: StoredContributionEffectAttempt,
  outcome: McpBoundExecutionOutcome,
  finishedAt: number,
): StoredContributionEffectAttempt {
  const run = parseStoredContributionEffectAttempt(value)
  if (run.status !== 'pending' || !timestamp(finishedAt) || finishedAt < run.startedAt) return invalid()
  if (!outcome || !['done', 'failed', 'uncertain'].includes(outcome.status)) return invalid()
  if (outcome.status !== 'uncertain') {
    try {
      const result = outcome.result === undefined ? undefined : exactResult(outcome.result)
      if (outcome.status === 'done' ? !result || result.isError : result && !result.isError) throw new Error()
      return outcome.status === 'done'
        ? { ...run, status: 'done', finishedAt, summary: SUMMARIES.done, result: result! }
        : { ...run, status: 'failed', finishedAt, summary: result ? SUMMARIES.toolError :
          run.transport === 'stdio' ? SUMMARIES.localFailed : SUMMARIES.failed,
          ...(result ? { result } : {}) }
    } catch { /* A received but unretainable result never proves no effect. */ }
  }
  return { ...run, status: 'uncertain', finishedAt, summary: SUMMARIES.uncertain }
}

export function interruptContributionEffectAttempt(value: StoredContributionEffectAttempt, at: number): StoredContributionEffectAttempt {
  const run = parseStoredContributionEffectAttempt(value)
  return run.status === 'pending'
    ? settleContributionEffectAttempt(run, { status: 'uncertain', summary: '' }, at)
    : run
}

export function publicContributionEffectRun(value: StoredContributionEffectAttempt): ContributionEffectRun {
  const run = parseStoredContributionEffectAttempt(value)
  const base = { id: run.id, envelopeVersion: run.envelopeVersion, lineId: run.lineId, actor: run.actor,
    connectionLabel: run.connectionLabel, ...(run.transport === undefined ? {} : { transport: run.transport }),
    toolName: run.call.toolName, arguments: run.call.arguments, startedAt: run.startedAt }
  if (run.status === 'pending') return { ...base, status: 'pending' }
  const terminal = { ...base, finishedAt: run.finishedAt, summary: run.summary }
  if (run.status === 'done') return { ...terminal, status: 'done', result: run.result }
  if (run.status === 'failed') return { ...terminal, status: 'failed', ...(run.result ? { result: run.result } : {}) }
  return { ...terminal, status: 'uncertain' }
}

/** Tool errors may follow partial effects. Only known pre-submission failures
 * release capacity; pending, uncertain and all returned results reserve it. */
export function contributionEffectConsumesSlot(value: StoredContributionEffectAttempt): boolean {
  const run = parseStoredContributionEffectAttempt(value)
  return run.status !== 'failed' || run.result !== undefined
}

export function sameContributionEffectIntent(value: StoredContributionEffectAttempt, input: ContributionEffectIntent): boolean {
  try {
    const run = parseStoredContributionEffectAttempt(value)
    const candidate = createContributionEffectAttempt(input)
    return run.id === candidate.id && run.callHash === candidate.callHash
  } catch { return false }
}
