/** Pure run-ledger transitions. A store must commit `created: true` before I/O,
 * recheck live authority at dispatch, and commit settlement before publication.
 * No caller may treat construction or represented replay as permission to send.
 * This module is not yet connected to Routine execution or snapshot storage. */
import { createHash } from 'node:crypto'
import type { RoutineMcpCallReceipt } from '../contract/routineMcp.ts'
import type { McpBoundToolCall, McpJsonValue, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { parseMcpToolResult } from './mcpToolResult.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import {
  RoutineMcpPolicyError, parseRoutineMcpPolicy, routineMcpCallPermitted,
  routineMcpInteger, routineMcpJsonText, sameRoutineMcpJson,
  type RoutineMcpConnectionReader, type StoredRoutineMcpPolicy,
} from './routineMcpPolicy.ts'

export interface StoredRoutineMcpRun {
  permission: StoredRoutineMcpPolicy
  /** Creation-time join commitment, including an empty ledger. Not a MAC or a
   * defense against someone authorized to rewrite the backing store. */
  permissionHash: string
  runId: string
  phase: 'active' | 'interrupted'
  calls: StoredRoutineMcpReceipt[]
}
/** Internal join integrity, excluded from the eventual public receipt. */
export type StoredRoutineMcpReceipt = RoutineMcpCallReceipt & { callHash: string }
const fail = (code: RoutineMcpPolicyError['code'] = 'invalid'): never => { throw new RoutineMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim() === value &&
  value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const stopsCalls = (call: RoutineMcpCallReceipt): boolean => call.status === 'pending' || call.status === 'uncertain' ||
  (call.status === 'failed' && call.result !== undefined)

function permissionHash(permission: StoredRoutineMcpPolicy, runId: string): string {
  return createHash('sha256').update(routineMcpJsonText({ permission, runId })).digest('hex')
}

function exactResult(value: unknown): McpToolResult {
  const copy = snapshotMcpJson(value, { maxBytes: 262_144, maxDepth: 32, maxNodes: 16_384 })
  const result = parseMcpToolResult(copy, MCP_MODERN_VERSION)
  if (!sameRoutineMcpJson(copy, result)) return fail()
  return result
}

function callHash(permission: StoredRoutineMcpPolicy, runId: string, id: string, call: McpBoundToolCall): string {
  return createHash('sha256').update(routineMcpJsonText({ permission, runId, id, call })).digest('hex')
}

function receiptFrom(value: McpJsonValue, permission: StoredRoutineMcpPolicy, runId: string): StoredRoutineMcpReceipt {
  if (!record(value) || typeof value.id !== 'string' || !/^routine-mcp-[a-f0-9]{64}$/.test(value.id) ||
      !routineMcpInteger(value.startedAt)) return fail()
  const approval = permission.policy.approval!
  const call = snapshotMcpBoundToolCall(value.call)
  if (!call || value.startedAt < approval.approvedAt || value.startedAt >= approval.expiresAt ||
      value.callHash !== callHash(permission, runId, value.id, call)) return fail()
  const tool = approval.tools.find(tool => tool.connectionId === call.connectionId && tool.connectionRevision === call.connectionRevision &&
    tool.toolName === call.toolName && tool.schemaHash === call.schemaHash)
  if (!tool || !Object.keys(tool.fixedArguments).every(key => Object.hasOwn(call.arguments, key) &&
      sameRoutineMcpJson(tool.fixedArguments[key], call.arguments[key]))) return fail()
  const base = { id: value.id, call, callHash: value.callHash as string, startedAt: value.startedAt }
  const keys = Object.keys(value)
  if (value.status === 'pending') {
    if (keys.length !== 5) return fail()
    return { ...base, status: 'pending' }
  }
  if (!routineMcpInteger(value.finishedAt) || value.finishedAt < value.startedAt ||
      keys.some(key => !['id', 'call', 'callHash', 'startedAt', 'status', 'finishedAt', 'result'].includes(key))) return fail()
  if (value.status === 'uncertain') {
    if (Object.hasOwn(value, 'result')) return fail()
    return { ...base, status: 'uncertain', finishedAt: value.finishedAt }
  }
  if (value.status !== 'done' && value.status !== 'failed') return fail()
  const result = Object.hasOwn(value, 'result') ? exactResult(value.result) : undefined
  if (value.status === 'done' ? !result || result.isError : result && !result.isError) return fail()
  return value.status === 'done'
    ? { ...base, status: 'done', finishedAt: value.finishedAt, result: result! }
    : { ...base, status: 'failed', finishedAt: value.finishedAt, ...(result ? { result } : {}) }
}

/** Full, bounded persisted-value admission. A malformed present ledger is
 * never silently reduced to an empty one (which would forgive call history). */
export function parseRoutineMcpRun(value: unknown): StoredRoutineMcpRun {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 8_388_608, maxDepth: 40, maxNodes: 450_000 })
    if (!record(copy) || Object.keys(copy).length !== 5 || !identity(copy.runId) ||
        !['active', 'interrupted'].includes(copy.phase as string) || !Array.isArray(copy.calls)) return fail()
    const permission = parseRoutineMcpPolicy(copy.permission)
    if (!permission.policy.approval || copy.permissionHash !== permissionHash(permission, copy.runId) ||
        copy.calls.length > permission.policy.approval.maxCallsPerRun) return fail()
    const calls = copy.calls.map(call => receiptFrom(call, permission, copy.runId as string))
    if (new Set(calls.map(call => call.id)).size !== calls.length ||
        calls.slice(0, -1).some(stopsCalls) ||
        (copy.phase === 'interrupted' && calls.some(call => call.status === 'pending'))) return fail()
    return { permission, permissionHash: copy.permissionHash as string, runId: copy.runId,
      phase: copy.phase as StoredRoutineMcpRun['phase'], calls }
  } catch { return fail() }
}

export function createRoutineMcpRun(permission: StoredRoutineMcpPolicy, runId: string): StoredRoutineMcpRun {
  const frozen = parseRoutineMcpPolicy(permission)
  if (!identity(runId)) return fail()
  return parseRoutineMcpRun({ permission: frozen, permissionHash: permissionHash(frozen, runId), runId, phase: 'active', calls: [] })
}

/** Keys are minted by the host for logical invocations, never taken from a
 * provider's reusable tool-call id. Scope and run identity cannot alias. */
function receiptId(run: StoredRoutineMcpRun, key: string): string {
  if (!identity(key)) return fail()
  return `routine-mcp-${createHash('sha256').update(JSON.stringify([
    run.permission.tenantId, run.permission.routineId, run.runId, key,
  ])).digest('hex')}`
}

export function reserveRoutineMcpCall(value: StoredRoutineMcpRun, input: {
  key: string
  call: McpBoundToolCall
  live: StoredRoutineMcpPolicy | undefined
  definitionRevision: number
  now: number
  connection: RoutineMcpConnectionReader
}): { run: StoredRoutineMcpRun; receipt: StoredRoutineMcpReceipt; created: boolean } {
  const run = parseRoutineMcpRun(value)
  const id = receiptId(run, input.key)
  const exact = snapshotMcpBoundToolCall(input.call)
  if (!exact) return fail()
  const represented = run.calls.find(call => call.id === id)
  if (represented) {
    if (!sameRoutineMcpJson(represented.call, exact)) return fail('stale')
    return { run, receipt: represented, created: false }
  }
  if (run.phase !== 'active' || run.calls.some(stopsCalls)) return fail('denied')
  if (run.calls.length >= run.permission.policy.approval!.maxCallsPerRun) return fail('limit')
  if (!routineMcpCallPermitted(run.permission, input.live, input.definitionRevision, exact, input.now, input.connection)) return fail('denied')
  const receipt: StoredRoutineMcpReceipt = { id, call: exact, callHash: callHash(run.permission, run.runId, id, exact),
    startedAt: input.now, status: 'pending' }
  run.calls.push(receipt)
  return { run, receipt, created: true }
}

/** All outcomes retain their reserved slot. Bad result data becomes uncertain,
 * never a known no-effect failure, and terminal receipts cannot be rewritten. */
export function settleRoutineMcpCall(
  value: StoredRoutineMcpRun, id: string, outcome: McpBoundExecutionOutcome, finishedAt: number,
): StoredRoutineMcpRun {
  const run = parseRoutineMcpRun(value)
  const index = run.calls.findIndex(call => call.id === id)
  const pending = run.calls[index]
  if (!pending || pending.status !== 'pending' || !routineMcpInteger(finishedAt) || finishedAt < pending.startedAt ||
      !outcome || !['done', 'failed', 'uncertain'].includes(outcome.status)) return fail()
  let terminal: StoredRoutineMcpReceipt = { ...pending, status: 'uncertain', finishedAt }
  if (outcome.status !== 'uncertain') {
    try {
      const result = outcome.result === undefined ? undefined : exactResult(outcome.result)
      if (outcome.status === 'done' ? !result || result.isError : result && !result.isError) return fail()
      terminal = outcome.status === 'done'
        ? { ...pending, status: 'done', finishedAt, result: result! }
        : { ...pending, status: 'failed', finishedAt, ...(result ? { result } : {}) }
    } catch { /* Unretainable or inconsistent output leaves execution uncertain. */ }
  }
  run.calls[index] = terminal
  return run
}

/** Recovery after process loss. The outer store must save this transition and
 * terminalize its running job before starting any scheduler/model work. Even
 * wholly settled prior calls prohibit restarting the model from its prompt. */
export function interruptRoutineMcpRun(value: StoredRoutineMcpRun, at: number): StoredRoutineMcpRun {
  const run = parseRoutineMcpRun(value)
  if (!routineMcpInteger(at)) return fail()
  if (!run.calls.length) return run
  run.phase = 'interrupted'
  run.calls = run.calls.map(call => call.status === 'pending'
    ? { ...call, status: 'uncertain', finishedAt: Math.max(call.startedAt, at) }
    : call)
  return run
}

/** Model retry replays its prompt, so it is safe only before the first durable
 * external-call reservation. A pre-submit failure still requires a new run. */
export function routineMcpRunMayRetry(value: StoredRoutineMcpRun): boolean {
  const run = parseRoutineMcpRun(value)
  return run.phase === 'active' && run.calls.length === 0
}
