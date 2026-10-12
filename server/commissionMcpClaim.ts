/** Pure pre-model claim and one-effect state transitions. The host owns the
 * registry, durable reservation, capacity, scheduling and all external I/O. */
import { createHash } from 'node:crypto'
import type { CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpJsonValue, McpToolPermission } from '../contract/mcpExecution.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import {
  CommissionMcpPolicyError, commissionMcpCallPermitted, commissionMcpInteger, parseCommissionMcpPolicy,
  type CommissionMcpConnectionReader, type CommissionMcpLiveReview, type StoredCommissionMcpPolicy,
} from './commissionMcpPolicy.ts'
import {
  interruptCommissionMcpAttempt, parseCommissionMcpAttempt, parseCommissionMcpWork,
  reserveCommissionMcpAttempt, settleCommissionMcpAttempt, type StoredCommissionMcpAttempt,
} from './commissionMcpState.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { mcpPermissionAllowsCall, mcpPermissionJsonText, sameMcpPermissionJson, snapshotMcpToolPermissions } from './mcpPermission.ts'

export type StoredCommissionMcpClaim = {
  id: string
  permission: StoredCommissionMcpPolicy
  work: CommissionMcpWork
  tool: McpToolPermission
  startedAt: number
  /** Join integrity only; not a MAC or proof that a host committed admission. */
  intentHash: string
} & (
  | { phase: 'preparing' }
  | { phase: 'effect'; attempt: StoredCommissionMcpAttempt }
  | { phase: 'closed'; status: 'failed' | 'uncertain'; finishedAt: number }
)

type ClaimBase = Omit<Extract<StoredCommissionMcpClaim, { phase: 'preparing' }>, 'phase'>
const fail = (code: CommissionMcpPolicyError['code'] = 'invalid'): never => { throw new CommissionMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = (value: Record<string, McpJsonValue>, names: readonly string[]): boolean =>
  Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key))

function detached(value: unknown): Record<string, McpJsonValue> {
  try {
    // A claim repeats its policy and selected tool around an independently
    // bounded attempt, which itself retains policy, call, and result. Leave
    // room for their combined accepted bounds while keeping the durable row
    // below 1.5 MiB, 44 levels, and 150k JSON nodes.
    const copy = snapshotMcpJson(value, { maxBytes: 1_572_864, maxDepth: 44, maxNodes: 150_000 })
    return record(copy) ? copy : fail()
  } catch { return fail() }
}

function exactTool(value: unknown): McpToolPermission {
  return snapshotMcpToolPermissions([value], 1)?.[0] ?? fail()
}

function approvedTool(permission: StoredCommissionMcpPolicy, tool: McpToolPermission): boolean {
  return !!permission.policy.approval?.tools.some(candidate => sameMcpPermissionJson(candidate, tool))
}

function claimIntentHash(base: Omit<ClaimBase, 'id' | 'intentHash'>): string {
  return createHash('sha256').update(mcpPermissionJsonText([base.permission, base.work, base.tool, base.startedAt])).digest('hex')
}

export function commissionMcpClaimId(projectId: string, itemId: string): string {
  if (typeof projectId !== 'string' || !projectId || typeof itemId !== 'string' || !itemId) return fail()
  return `commission-work-${createHash('sha256').update(JSON.stringify([projectId, itemId])).digest('hex')}`
}

function parseBase(copy: Record<string, McpJsonValue>): ClaimBase {
  const permission = parseCommissionMcpPolicy(copy.permission)
  const work = parseCommissionMcpWork(copy.work)
  const tool = exactTool(copy.tool)
  const approval = permission.policy.approval
  if (!approval || !approvedTool(permission, tool) || tool.toolName !== work.target ||
      !commissionMcpInteger(copy.startedAt) || copy.startedAt < approval.approvedAt || copy.startedAt >= approval.expiresAt ||
      copy.id !== commissionMcpClaimId(permission.projectId, work.itemId) || typeof copy.intentHash !== 'string') return fail()
  const base = { id: copy.id, permission, work, tool, startedAt: copy.startedAt, intentHash: copy.intentHash }
  if (copy.intentHash !== claimIntentHash(base)) return fail()
  return base
}

/** Strict bounded detached parser for private claim rows. */
export function parseCommissionMcpClaim(value: unknown): StoredCommissionMcpClaim {
  try {
    const copy = detached(value)
    const base = parseBase(copy)
    if (copy.phase === 'preparing') return fields(copy, ['id', 'permission', 'work', 'tool', 'startedAt', 'intentHash', 'phase'])
      ? { ...base, phase: 'preparing' } : fail()
    if (copy.phase === 'effect') {
      if (!fields(copy, ['id', 'permission', 'work', 'tool', 'startedAt', 'intentHash', 'phase', 'attempt'])) return fail()
      const attempt = parseCommissionMcpAttempt(copy.attempt)
      if (!sameMcpPermissionJson(attempt.permission, base.permission) || !sameMcpPermissionJson(attempt.work, base.work) ||
          !mcpPermissionAllowsCall(base.tool, attempt.call) || attempt.call.toolName !== base.work.target ||
          attempt.startedAt < base.startedAt) return fail()
      return { ...base, phase: 'effect', attempt }
    }
    if (copy.phase === 'closed' && (copy.status === 'failed' || copy.status === 'uncertain') &&
        fields(copy, ['id', 'permission', 'work', 'tool', 'startedAt', 'intentHash', 'phase', 'status', 'finishedAt']) &&
        commissionMcpInteger(copy.finishedAt) && copy.finishedAt >= base.startedAt) {
      return { ...base, phase: 'closed', status: copy.status, finishedAt: copy.finishedAt }
    }
    return fail()
  } catch { return fail() }
}

function makeBase(permission: StoredCommissionMcpPolicy, work: CommissionMcpWork, tool: McpToolPermission, startedAt: number): ClaimBase {
  const base = { id: commissionMcpClaimId(permission.projectId, work.itemId), permission, work, tool, startedAt, intentHash: '' }
  return { ...base, intentHash: claimIntentHash(base) }
}

function fixedCall(tool: McpToolPermission): McpBoundToolCall {
  return { connectionId: tool.connectionId, connectionRevision: tool.connectionRevision,
    toolName: tool.toolName, schemaHash: tool.schemaHash, arguments: structuredClone(tool.fixedArguments) }
}

/** Creates one immutable Project/work identity before model generation. */
export function reserveCommissionMcpClaim(current: StoredCommissionMcpClaim | undefined, input: {
  permission: StoredCommissionMcpPolicy
  work: CommissionMcpWork
  tool: McpToolPermission
  live: StoredCommissionMcpPolicy | undefined
  review: CommissionMcpLiveReview
  now: number
  connection: CommissionMcpConnectionReader
}): { claim: StoredCommissionMcpClaim; created: boolean } {
  const permission = parseCommissionMcpPolicy(input.permission)
  const work = parseCommissionMcpWork(input.work)
  const tool = exactTool(input.tool)
  if (current !== undefined) {
    const represented = parseCommissionMcpClaim(current)
    if (represented.id !== commissionMcpClaimId(permission.projectId, work.itemId) ||
        !sameMcpPermissionJson(represented.permission, permission) || !sameMcpPermissionJson(represented.work, work) ||
        !sameMcpPermissionJson(represented.tool, tool)) return fail('stale')
    return { claim: parseCommissionMcpClaim(represented), created: false }
  }
  if (!approvedTool(permission, tool) || tool.toolName !== work.target || !commissionMcpInteger(input.now) ||
      !commissionMcpCallPermitted(permission, input.live, input.review, fixedCall(tool), input.now, input.connection)) return fail('denied')
  const base = makeBase(permission, work, tool, input.now)
  return { claim: parseCommissionMcpClaim({ ...base, phase: 'preparing' }), created: true }
}

/** A preparation can bind only the selected tool's exact fixed arguments. */
export function beginCommissionMcpEffect(claimValue: StoredCommissionMcpClaim, input: {
  call: McpBoundToolCall
  live: StoredCommissionMcpPolicy | undefined
  review: CommissionMcpLiveReview
  now: number
  connection: CommissionMcpConnectionReader
}): { claim: StoredCommissionMcpClaim; created: boolean } {
  const claim = parseCommissionMcpClaim(claimValue)
  const call = snapshotMcpBoundToolCall(input.call) ?? fail()
  if (claim.phase === 'effect') {
    if (!sameMcpPermissionJson(claim.attempt.call, call)) return fail('stale')
    return { claim: parseCommissionMcpClaim(claim), created: false }
  }
  if (claim.phase !== 'preparing') return fail('stale')
  if (call.toolName !== claim.work.target || !mcpPermissionAllowsCall(claim.tool, call)) return fail('stale')
  const reservation = reserveCommissionMcpAttempt(undefined, { permission: claim.permission, work: claim.work, call,
    live: input.live, review: input.review, now: input.now, connection: input.connection })
  if (reservation.attempt.startedAt < claim.startedAt) return fail('stale')
  return { claim: parseCommissionMcpClaim({ ...claim, phase: 'effect', attempt: reservation.attempt }), created: true }
}

export function settleCommissionMcpEffect(
  claimValue: StoredCommissionMcpClaim, outcome: McpBoundExecutionOutcome, finishedAt: number,
): StoredCommissionMcpClaim {
  const claim = parseCommissionMcpClaim(claimValue)
  if (claim.phase !== 'effect') return fail()
  return parseCommissionMcpClaim({ ...claim, attempt: settleCommissionMcpAttempt(claim.attempt, outcome, finishedAt) })
}

export function closeCommissionMcpPreparation(
  claimValue: StoredCommissionMcpClaim, status: 'failed' | 'uncertain', finishedAt: number,
): StoredCommissionMcpClaim {
  const claim = parseCommissionMcpClaim(claimValue)
  if (claim.phase !== 'preparing' || !commissionMcpInteger(finishedAt) || finishedAt < claim.startedAt) return fail()
  return parseCommissionMcpClaim({ ...claim, phase: 'closed', status, finishedAt })
}

export function interruptCommissionMcpClaim(claimValue: StoredCommissionMcpClaim, at: number): StoredCommissionMcpClaim {
  const claim = parseCommissionMcpClaim(claimValue)
  if (!commissionMcpInteger(at)) return fail()
  if (claim.phase === 'preparing') return closeCommissionMcpPreparation(claim, 'uncertain', Math.max(at, claim.startedAt))
  if (claim.phase === 'effect' && claim.attempt.status === 'pending') {
    return parseCommissionMcpClaim({ ...claim, attempt: interruptCommissionMcpAttempt(claim.attempt, at) })
  }
  return parseCommissionMcpClaim(claim)
}
