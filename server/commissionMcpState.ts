/** Pure one-effect receipt transitions, not a worker or persistence adapter.
 * The future host must reserve work/grant capacity and persist a new receipt
 * before I/O. No state here authorizes automatic replay or awards Agent credit. */
import { createHash } from 'node:crypto'
import type { CommissionMcpWork, CommissionMcpAttemptState } from '../contract/commissionMcp.ts'
import { OPEN_WORK_FIELD_MAX } from '../contract/coordination.ts'
import type { McpBoundToolCall, McpJsonValue, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import {
  CommissionMcpPolicyError, commissionMcpCallPermitted, commissionMcpInteger, parseCommissionMcpPolicy,
  type CommissionMcpConnectionReader, type CommissionMcpLiveReview, type StoredCommissionMcpPolicy,
} from './commissionMcpPolicy.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { mcpPermissionAllowsCall, mcpPermissionJsonText, sameMcpPermissionJson } from './mcpPermission.ts'
import { parseMcpToolResult } from './mcpToolResult.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'

export type StoredCommissionMcpAttempt = {
  id: string
  permission: StoredCommissionMcpPolicy
  work: CommissionMcpWork
  call: McpBoundToolCall
  startedAt: number
  /** Join integrity only, not a MAC or proof that a host committed admission. */
  intentHash: string
} & CommissionMcpAttemptState

const fail = (code: CommissionMcpPolicyError['code'] = 'invalid'): never => { throw new CommissionMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = (value: Record<string, McpJsonValue>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const text = (value: unknown, max: number, blank = false): value is string => typeof value === 'string' &&
  value.length <= max && value.trim() === value && (blank || value.length > 0)

function workFrom(value: McpJsonValue): CommissionMcpWork {
  if (!record(value) || !fields(value, ['itemId', 'subGoal', 'type', 'target', 'note']) ||
      !text(value.itemId, 200) || /[\u0000-\u001f\u007f-\u009f]/.test(value.itemId) ||
      !text(value.subGoal, OPEN_WORK_FIELD_MAX) || value.type !== 'mcp.mutate' ||
      !text(value.target, OPEN_WORK_FIELD_MAX) || !text(value.note, OPEN_WORK_FIELD_MAX, true)) return fail()
  return { itemId: value.itemId, subGoal: value.subGoal, type: 'mcp.mutate', target: value.target, note: value.note }
}

function detached(value: unknown): Record<string, McpJsonValue> {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 655_360, maxDepth: 40, maxNodes: 50_000 })
    return record(copy) ? copy : fail()
  } catch { return fail() }
}

/** Stable across owner, Commission and grant replacements: another worker or
 * renewed approval cannot mint a second effect identity for the same work. */
function attemptId(permission: StoredCommissionMcpPolicy, work: CommissionMcpWork): string {
  return `commission-mcp-${createHash('sha256').update(JSON.stringify([permission.projectId, work.itemId])).digest('hex')}`
}

function intentHash(permission: StoredCommissionMcpPolicy, work: CommissionMcpWork, call: McpBoundToolCall, startedAt: number): string {
  return createHash('sha256').update(mcpPermissionJsonText({ permission, work, call, startedAt })).digest('hex')
}

function exactResult(value: unknown): McpToolResult {
  const copy = snapshotMcpJson(value, { maxBytes: 262_144, maxDepth: 32, maxNodes: 16_384 })
  const result = parseMcpToolResult(copy, MCP_MODERN_VERSION)
  if (!sameMcpPermissionJson(copy, result)) return fail()
  return result
}

export function parseCommissionMcpAttempt(value: unknown): StoredCommissionMcpAttempt {
  try {
    const copy = detached(value)
    const permission = parseCommissionMcpPolicy(copy.permission)
    const approval = permission.policy.approval
    const work = workFrom(copy.work)
    const call = snapshotMcpBoundToolCall(copy.call)
    if (!approval || !call || work.target !== call.toolName || !commissionMcpInteger(copy.startedAt) ||
        copy.startedAt < approval.approvedAt || copy.startedAt >= approval.expiresAt ||
        !approval.tools.some(tool => mcpPermissionAllowsCall(tool, call)) ||
        copy.id !== attemptId(permission, work) || copy.intentHash !== intentHash(permission, work, call, copy.startedAt)) return fail()
    const base = { id: copy.id as string, permission, work, call, startedAt: copy.startedAt, intentHash: copy.intentHash as string }
    const keys = ['id', 'permission', 'work', 'call', 'startedAt', 'intentHash', 'status']
    if (copy.status === 'pending') return fields(copy, keys) ? { ...base, status: 'pending' } : fail()
    if (!commissionMcpInteger(copy.finishedAt) || copy.finishedAt < copy.startedAt) return fail()
    if (copy.status === 'uncertain') return fields(copy, [...keys, 'finishedAt'])
      ? { ...base, status: 'uncertain', finishedAt: copy.finishedAt } : fail()
    const hasResult = Object.hasOwn(copy, 'result')
    if (!fields(copy, [...keys, 'finishedAt', ...(hasResult ? ['result'] : [])]) ||
        (copy.status !== 'done' && copy.status !== 'failed')) return fail()
    const result = hasResult ? exactResult(copy.result) : undefined
    if (copy.status === 'done' ? !result || result.isError : result && !result.isError) return fail()
    return copy.status === 'done'
      ? { ...base, status: 'done', finishedAt: copy.finishedAt, result: result! }
      : { ...base, status: 'failed', finishedAt: copy.finishedAt, ...(result ? { result } : {}) }
  } catch { return fail() }
}

/** A represented exact attempt is receipt-only, even after revocation. Changed
 * arguments, work or permission conflict instead of becoming another call. */
export function reserveCommissionMcpAttempt(current: StoredCommissionMcpAttempt | undefined, input: {
  permission: StoredCommissionMcpPolicy
  work: CommissionMcpWork
  call: McpBoundToolCall
  live: StoredCommissionMcpPolicy | undefined
  review: CommissionMcpLiveReview
  now: number
  connection: CommissionMcpConnectionReader
}): { attempt: StoredCommissionMcpAttempt; created: boolean } {
  const permission = parseCommissionMcpPolicy(input.permission)
  const work = workFrom(detached(input.work))
  const call = snapshotMcpBoundToolCall(input.call) ?? fail()
  if (current !== undefined) {
    const represented = parseCommissionMcpAttempt(current)
    if (!sameMcpPermissionJson(represented.permission, permission) || !sameMcpPermissionJson(represented.work, work) ||
        !sameMcpPermissionJson(represented.call, call)) return fail('stale')
    return { attempt: represented, created: false }
  }
  if (work.target !== call.toolName || !commissionMcpCallPermitted(permission, input.live, input.review,
    call, input.now, input.connection)) return fail('denied')
  return { attempt: parseCommissionMcpAttempt({ id: attemptId(permission, work), permission, work, call,
    startedAt: input.now, intentHash: intentHash(permission, work, call, input.now), status: 'pending' }), created: true }
}

/** Invalid or inconsistent results become uncertainty, never no-effect proof.
 * Terminal receipts cannot be overwritten, including by late completion. */
export function settleCommissionMcpAttempt(value: StoredCommissionMcpAttempt, outcome: McpBoundExecutionOutcome, finishedAt: number): StoredCommissionMcpAttempt {
  const attempt = parseCommissionMcpAttempt(value)
  if (attempt.status !== 'pending' || !commissionMcpInteger(finishedAt) || finishedAt < attempt.startedAt) return fail()
  const uncertain: StoredCommissionMcpAttempt = { ...attempt, status: 'uncertain', finishedAt }
  try {
    const copy = detached(outcome)
    if (!['done', 'failed', 'uncertain'].includes(copy.status as string)) return uncertain
    if (copy.status === 'uncertain') return uncertain
    const hasResult = Object.hasOwn(copy, 'result')
    // Executor summaries are deliberately not retained: only code-owned state
    // and validated inert results belong in durable history.
    if (Object.keys(copy).some(key => !['status', 'summary', 'result'].includes(key))) return uncertain
    const result = hasResult ? exactResult(copy.result) : undefined
    if (copy.status === 'done' ? !result || result.isError : result && !result.isError) return uncertain
    return copy.status === 'done'
      ? { ...attempt, status: 'done', finishedAt, result: result! }
      : { ...attempt, status: 'failed', finishedAt, ...(result ? { result } : {}) }
  } catch { return uncertain }
}

/** This value must be committed before a future worker starts after restart.
 * No result, terminal receipt, or failed attempt permits automatic redispatch. */
export function interruptCommissionMcpAttempt(value: StoredCommissionMcpAttempt, at: number): StoredCommissionMcpAttempt {
  const attempt = parseCommissionMcpAttempt(value)
  if (!commissionMcpInteger(at)) return fail()
  return attempt.status === 'pending'
    ? { ...attempt, status: 'uncertain', finishedAt: Math.max(at, attempt.startedAt) }
    : attempt
}
