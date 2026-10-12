/** Private, detached Routine MCP policy and receipt registry.
 *
 * This module owns no Routine store or persistence I/O. Its state is an
 * additive private slice: callers must treat absence as the legacy empty
 * registry, validate joins against the canonical Routine rows, and commit each
 * returned snapshot atomically before acknowledging a mutation.
 */
import { createHash } from 'node:crypto'
import type { RoutineMcpApprovalIntent, RoutineMcpPolicy } from '../contract/routineMcp.ts'
import type { RoutineMcpDecisionRequest } from '../contract/routineMcpApi.ts'
export type { RoutineMcpDecisionRequest } from '../contract/routineMcpApi.ts'
import type { McpJsonValue } from '../contract/mcpExecution.ts'
import type { ScheduledTask } from '../contract/cowork.ts'
import {
  RoutineMcpPolicyError,
  approveRoutineMcpPolicy,
  parseRoutineMcpOAuthAuthority,
  parseRoutineMcpLocalAuthority,
  parseRoutineMcpPolicy,
  revokeRoutineMcpPolicy,
  routineMcpInteger,
  routineMcpOwnerUserId,
  routineMcpJsonText,
  sameRoutineMcpJson,
  type RoutineMcpConnectionReader,
  type RoutineMcpScope,
  type StoredRoutineMcpPolicy,
  type StoredRoutineMcpOAuthAuthority,
  type StoredRoutineMcpLocalAuthority,
} from './routineMcpPolicy.ts'
import {
  createRoutineMcpRun,
  parseRoutineMcpRun,
  type StoredRoutineMcpRun,
} from './routineMcpState.ts'
import { snapshotMcpJson } from './mcpJson.ts'

export const ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE = 256

/** Request keys are represented only by this opaque receipt and its digest. */
export interface StoredRoutineMcpDecision {
  decisionId: string
  tenantId: string
  routineId: string
  requestHash: string
  policyRevision: number
  action: 'approve' | 'revoke'
  /** Person-authority stamps require an exact private deciding actor. The
   * deciding manager may revoke another person's grant, never reuse it. */
  oauthAuthority?: StoredRoutineMcpOAuthAuthority
  localAuthority?: StoredRoutineMcpLocalAuthority
  actorUserId?: string
}

export interface RoutineMcpRegistryState {
  policies: StoredRoutineMcpPolicy[]
  runs: StoredRoutineMcpRun[]
  decisions: StoredRoutineMcpDecision[]
}

export interface RoutineMcpDecisionContext {
  definitionRevision: number
  reviewHash: string
  now: number
  connection: RoutineMcpConnectionReader
  actorUserId?: string
  /** Trusted host capability, never a request-body flag. Absent refuses local programs. */
  allowLocalPrograms?: boolean
}

const EMPTY: RoutineMcpRegistryState = { policies: [], runs: [], decisions: [] }
const fail = (code: RoutineMcpPolicyError['code'] = 'invalid'): never => { throw new RoutineMcpPolicyError(code) }
const isRecord = (value: unknown): value is Record<string, McpJsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim() === value &&
  value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const scopeKey = (scope: RoutineMcpScope): string => JSON.stringify([scope.tenantId, scope.routineId])
const revisionKey = (scope: RoutineMcpScope, revision: number): string => JSON.stringify([scope.tenantId, scope.routineId, revision])
const runKey = (tenantId: string, routineId: string, runId: string): string => JSON.stringify([tenantId, routineId, runId])
const sameAuthorities = (left: Pick<StoredRoutineMcpPolicy, 'oauthAuthority' | 'localAuthority'>,
  right: Pick<StoredRoutineMcpPolicy, 'oauthAuthority' | 'localAuthority'>): boolean =>
  sameRoutineMcpJson(left.oauthAuthority, right.oauthAuthority) && sameRoutineMcpJson(left.localAuthority, right.localAuthority)

function hash(value: unknown): string {
  return createHash('sha256').update(routineMcpJsonText(value)).digest('hex')
}

function requestSnapshot(scope: RoutineMcpScope, request: RoutineMcpDecisionRequest): {
  requestId: string
  action: 'approve' | 'revoke'
  requestHash: string
  approval?: RoutineMcpApprovalIntent
  expectedRevision?: number
} {
  const input = snapshotMcpJson(request, { maxBytes: 300_000, maxDepth: 44, maxNodes: 24_000 })
  if (!isRecord(input) || !identity(input.requestId) || (input.action !== 'approve' && input.action !== 'revoke')) return fail()
  if (input.action === 'approve') {
    if (Object.keys(input).length !== 3 || !Object.hasOwn(input, 'approval') || !isRecord(input.approval)) return fail()
    return {
      requestId: input.requestId,
      action: 'approve',
      requestHash: hash({ tenantId: scope.tenantId, routineId: scope.routineId, request: input }),
      approval: input.approval as unknown as RoutineMcpApprovalIntent,
    }
  }
  if (Object.keys(input).length !== 3 || !Object.hasOwn(input, 'expectedRevision') || !routineMcpInteger(input.expectedRevision)) return fail()
  return {
    requestId: input.requestId,
    action: 'revoke',
    requestHash: hash({ tenantId: scope.tenantId, routineId: scope.routineId, request: input }),
    expectedRevision: input.expectedRevision,
  }
}

function decisionId(scope: RoutineMcpScope, requestId: string): string {
  return `routine-mcp-decision-${hash([scope.tenantId, scope.routineId, requestId])}`
}

function cloneState(value: unknown): RoutineMcpRegistryState {
  return parseRoutineMcpRegistryState(value)
}

function parseDecision(value: unknown): StoredRoutineMcpDecision {
  const copy = snapshotMcpJson(value, { maxBytes: 4096, maxDepth: 4, maxNodes: 64 })
  if (!isRecord(copy)) return fail()
  const hasAuthority = Object.hasOwn(copy, 'oauthAuthority')
  const hasLocalAuthority = Object.hasOwn(copy, 'localAuthority')
  const keys = ['decisionId', 'tenantId', 'routineId', 'requestHash', 'policyRevision', 'action',
    ...(hasAuthority ? ['oauthAuthority'] : []), ...(hasLocalAuthority ? ['localAuthority'] : []),
    ...(hasAuthority || hasLocalAuthority ? ['actorUserId'] : [])]
  if (Object.keys(copy).length !== keys.length || !keys.every(key => Object.hasOwn(copy, key)) ||
      !identity(copy.tenantId) || !identity(copy.routineId) ||
      typeof copy.decisionId !== 'string' || !/^routine-mcp-decision-[a-f0-9]{64}$/.test(copy.decisionId) ||
      typeof copy.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(copy.requestHash) ||
      !routineMcpInteger(copy.policyRevision) || copy.policyRevision < 1 ||
      (copy.action !== 'approve' && copy.action !== 'revoke')) return fail()
  const oauthAuthority = hasAuthority ? parseRoutineMcpOAuthAuthority(copy.oauthAuthority) : undefined
  const localAuthority = hasLocalAuthority ? parseRoutineMcpLocalAuthority(copy.localAuthority) : undefined
  // Reuse the policy's strict paired-authority rules even when this historical
  // decision no longer has a live approval or selected tool list.
  parseRoutineMcpPolicy({ tenantId: copy.tenantId, routineId: copy.routineId,
    policy: { version: 1, revision: copy.policyRevision, approval: null },
    ...(oauthAuthority ? { oauthAuthority } : {}), ...(localAuthority ? { localAuthority } : {}) })
  for (const authority of [oauthAuthority, localAuthority]) {
    if (authority && (!routineMcpOwnerUserId(copy.actorUserId) ||
        (copy.action === 'approve' && copy.actorUserId !== authority.ownerUserId))) return fail()
  }
  return {
    decisionId: copy.decisionId,
    tenantId: copy.tenantId,
    routineId: copy.routineId,
    requestHash: copy.requestHash,
    policyRevision: copy.policyRevision,
    action: copy.action,
    ...(oauthAuthority ? { oauthAuthority } : {}), ...(localAuthority ? { localAuthority } : {}),
    ...(oauthAuthority || localAuthority ? { actorUserId: copy.actorUserId as string } : {}),
  }
}

/** Strict present-snapshot admission. Legacy absence is supplied by the caller
 * as an empty state; malformed present data never drops receipts or decisions. */
export function parseRoutineMcpRegistryState(value: unknown): RoutineMcpRegistryState {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 64 * 1024 * 1024, maxDepth: 48, maxNodes: 2_000_000 })
    if (!isRecord(copy) || Object.keys(copy).length !== 3 ||
        !Array.isArray(copy.policies) || !Array.isArray(copy.runs) || !Array.isArray(copy.decisions) ||
        copy.policies.length > 100_000 || copy.runs.length > 1_000_000 || copy.decisions.length > 25_600_000) return fail()
    const policies = copy.policies.map(parseRoutineMcpPolicy)
    const runs = copy.runs.map(parseRoutineMcpRun)
    const decisions = copy.decisions.map(parseDecision)
    const policyKeys = policies.map((row) => scopeKey(row))
    const runKeys = runs.map((row) => runKey(row.permission.tenantId, row.permission.routineId, row.runId))
    const decisionIds = decisions.map((row) => row.decisionId)
    const decisionsPerRoutine = new Map<string, number>()
    const decisionsByRevision = new Map<string, StoredRoutineMcpDecision[]>()
    for (const decision of decisions) {
      const key = scopeKey(decision)
      const count = (decisionsPerRoutine.get(key) ?? 0) + 1
      if (count > ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE) return fail('limit')
      decisionsPerRoutine.set(key, count)
      const revision = revisionKey(decision, decision.policyRevision)
      const atRevision = decisionsByRevision.get(revision) ?? []
      atRevision.push(decision)
      decisionsByRevision.set(revision, atRevision)
    }
    const policyByKey = new Map(policies.map((row) => [scopeKey(row), row]))
    if (new Set(policyKeys).size !== policyKeys.length || new Set(runKeys).size !== runKeys.length ||
        new Set(decisionIds).size !== decisionIds.length || decisions.some((decision) => {
          const policy = policyByKey.get(scopeKey(decision))
          return !policy || decision.policyRevision > policy.policy.revision
        }) || [...decisionsPerRoutine].some(([key, count]) =>
          count === ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE && policyByKey.get(key)?.policy.approval !== null)) return fail()
    for (const policy of policies) {
      const currentRevision = decisionsByRevision.get(revisionKey(policy, policy.policy.revision)) ?? []
      if (currentRevision.some(decision => !sameAuthorities(decision, policy)) ||
          (policy.policy.approval !== null && (currentRevision.length !== 1 || currentRevision[0]!.action !== 'approve'))) return fail()
    }
    for (const run of runs) {
      const approvals = (decisionsByRevision.get(revisionKey(run.permission, run.permission.policy.revision)) ?? [])
        .filter(decision => decision.action === 'approve')
      if ((run.permission.oauthAuthority || run.permission.localAuthority || approvals.some(decision => decision.oauthAuthority || decision.localAuthority)) &&
          (approvals.length !== 1 || !sameAuthorities(approvals[0]!, run.permission))) return fail()
    }
    return { policies, runs, decisions }
  } catch (error) {
    if (error instanceof RoutineMcpPolicyError) throw error
    return fail()
  }
}

/** Cross-slice join validation run before persistence is admitted. Tenant stamps
 * absent on old Routines resolve only to the caller-supplied default tenant. */
export function validateRoutineMcpRegistryJoins(
  state: RoutineMcpRegistryState,
  schedules: readonly ScheduledTask[],
  defaultTenantId?: string,
): boolean {
  try {
    if (defaultTenantId !== undefined && !identity(defaultTenantId)) return false
    const exact = parseRoutineMcpRegistryState(state)
    const routines = new Map<string, ScheduledTask[]>()
    for (const task of schedules) {
      if (!identity(task.id) || (task.tenantId !== undefined && !identity(task.tenantId))) return false
      const rows = routines.get(task.id) ?? []
      rows.push(task)
      routines.set(task.id, rows)
    }
    const policies = new Map(exact.policies.map((policy) => [scopeKey(policy), policy]))
    const routineFor = (scope: { tenantId: string; routineId: string }): ScheduledTask | undefined => {
      const candidates = routines.get(scope.routineId)
      if (!candidates || candidates.length !== 1) return undefined
      const task = candidates[0]!
      const tenantId = task.tenantId ?? defaultTenantId
      return tenantId === undefined || tenantId === scope.tenantId ? task : undefined
    }
    if (exact.policies.some((policy) => !routineFor(policy)) ||
        exact.decisions.some((decision) => !routineFor(decision))) return false
    for (const run of exact.runs) {
      const key = scopeKey(run.permission)
      const task = routineFor(run.permission)
      const current = policies.get(key)
      const matchingRuns = task?.runs.filter((candidate) => candidate.id === run.runId) ?? []
      const storedRun = matchingRuns.length === 1 ? matchingRuns[0] : undefined
      const approval = run.permission.policy.approval
      if (!task || !current || !storedRun || !approval || !storedRun.execution ||
          storedRun.execution.definitionRevision !== approval.definitionRevision ||
          run.permission.policy.revision > current.policy.revision ||
          (run.permission.policy.revision === current.policy.revision && !sameRoutineMcpJson(run.permission, current)) ||
          (run.phase === 'interrupted' && storedRun.status === 'running')) return false
    }
    return true
  } catch { return false }
}

/** In-memory private registry. Every outward read/transition is detached. */
export class RoutineMcpRegistry {
  private state: RoutineMcpRegistryState

  constructor(initial: RoutineMcpRegistryState = EMPTY) {
    this.state = cloneState(initial)
  }

  snapshot(): RoutineMcpRegistryState {
    return cloneState(this.state)
  }

  replace(state: RoutineMcpRegistryState): void {
    this.state = cloneState(state)
  }

  policy(tenantId: string, routineId: string): StoredRoutineMcpPolicy | undefined {
    const row = this.state.policies.find((candidate) => candidate.tenantId === tenantId && candidate.routineId === routineId)
    return row ? parseRoutineMcpPolicy(row) : undefined
  }

  run(tenantId: string, routineId: string, runId: string): StoredRoutineMcpRun | undefined {
    const row = this.state.runs.find((candidate) => candidate.permission.tenantId === tenantId &&
      candidate.permission.routineId === routineId && candidate.runId === runId)
    return row ? parseRoutineMcpRun(row) : undefined
  }

  setRun(value: StoredRoutineMcpRun): void {
    const run = parseRoutineMcpRun(value)
    const key = runKey(run.permission.tenantId, run.permission.routineId, run.runId)
    const index = this.state.runs.findIndex((candidate) => runKey(candidate.permission.tenantId, candidate.permission.routineId, candidate.runId) === key)
    const policy = this.policy(run.permission.tenantId, run.permission.routineId)
    if (!policy || run.permission.policy.revision > policy.policy.revision) return fail('stale')
    if (index < 0) return fail('unavailable')
    const previous = this.state.runs[index]!
    if (previous.permissionHash !== run.permissionHash) return fail('stale')
    if (!this.validRunAdvance(previous, run)) return fail('stale')
    this.state.runs[index] = run
  }

  queue(permission: StoredRoutineMcpPolicy, runId: string): StoredRoutineMcpRun {
    const exact = parseRoutineMcpPolicy(permission)
    const existing = this.run(exact.tenantId, exact.routineId, runId)
    if (existing) {
      if (!sameRoutineMcpJson(existing.permission, exact)) return fail('stale')
      return existing
    }
    if (!sameRoutineMcpJson(this.policy(exact.tenantId, exact.routineId), exact)) return fail('stale')
    const run = createRoutineMcpRun(exact, runId)
    this.state.runs.push(run)
    return parseRoutineMcpRun(run)
  }

  removeRoutine(tenantId: string, routineId: string): void {
    const runs = this.state.runs.filter((run) => run.permission.tenantId === tenantId && run.permission.routineId === routineId)
    if (runs.some((run) => run.calls.some((call) => call.status === 'pending'))) return fail('denied')
    this.state.policies = this.state.policies.filter((row) => row.tenantId !== tenantId || row.routineId !== routineId)
    this.state.runs = this.state.runs.filter((run) => run.permission.tenantId !== tenantId || run.permission.routineId !== routineId)
    this.state.decisions = this.state.decisions.filter((row) => row.tenantId !== tenantId || row.routineId !== routineId)
  }

  retainRuns(tenantId: string, routineId: string, ids: Set<string>): void {
    this.state.runs = this.state.runs.filter((run) => run.permission.tenantId !== tenantId || run.permission.routineId !== routineId || ids.has(run.runId))
  }

  suspend(tenantId: string, routineId: string): StoredRoutineMcpPolicy | undefined {
    const current = this.policy(tenantId, routineId)
    if (!current) return undefined
    const next = revokeRoutineMcpPolicy(current, current.policy.revision)
    if (next !== current) this.storePolicy(next)
    return parseRoutineMcpPolicy(next)
  }

  decide(
    scope: RoutineMcpScope,
    request: RoutineMcpDecisionRequest,
    current: RoutineMcpDecisionContext,
  ): { decisionId: string; policy: RoutineMcpPolicy; replayed: boolean } {
    if (!identity(scope.tenantId) || !identity(scope.routineId)) return fail()
    const exact = requestSnapshot(scope, request)
    const id = decisionId(scope, exact.requestId)
    const previous = this.state.decisions.find((row) => row.decisionId === id)
    if (previous) {
      if (previous.requestHash !== exact.requestHash) return fail('stale')
      if ((previous.oauthAuthority || previous.localAuthority) && previous.actorUserId !== current.actorUserId) return fail('denied')
      const truth = this.policy(scope.tenantId, scope.routineId)
      if (!truth) return fail('unavailable')
      return { decisionId: id, policy: truth.policy, replayed: true }
    }
    const key = scopeKey(scope)
    const decisionCount = this.state.decisions.filter((row) => scopeKey(row) === key).length
    if (decisionCount >= ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE ||
        (exact.action === 'approve' && decisionCount >= ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE - 1)) return fail('limit')
    if (!routineMcpInteger(current.definitionRevision) || !routineMcpInteger(current.now) ||
        typeof current.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(current.reviewHash)) return fail()
    const prior = this.policy(scope.tenantId, scope.routineId)
    if (exact.action === 'approve' && exact.approval!.reviewHash !== current.reviewHash) return fail('stale')
    const next = exact.action === 'approve'
      ? approveRoutineMcpPolicy(scope, prior, current.definitionRevision, exact.approval!, current.now, current.connection, current.actorUserId, current.allowLocalPrograms === true)
      : prior ? revokeRoutineMcpPolicy(prior, exact.expectedRevision!) : fail('stale')
    if ((next.oauthAuthority || next.localAuthority) && !routineMcpOwnerUserId(current.actorUserId)) return fail('denied')
    const action = exact.action
    this.storePolicy(next)
    this.state.decisions.push({ decisionId: id, tenantId: scope.tenantId, routineId: scope.routineId,
      requestHash: exact.requestHash, policyRevision: next.policy.revision, action,
      ...(next.oauthAuthority ? { oauthAuthority: structuredClone(next.oauthAuthority) } : {}),
      ...(next.localAuthority ? { localAuthority: structuredClone(next.localAuthority) } : {}),
      ...(next.oauthAuthority || next.localAuthority ? { actorUserId: current.actorUserId! } : {}) })
    return { decisionId: id, policy: parseRoutineMcpPolicy(next).policy, replayed: false }
  }

  private storePolicy(value: StoredRoutineMcpPolicy): void {
    const next = parseRoutineMcpPolicy(value)
    const key = scopeKey(next)
    const index = this.state.policies.findIndex((row) => scopeKey(row) === key)
    if (index < 0) this.state.policies.push(next)
    else this.state.policies[index] = next
  }

  private validRunAdvance(previous: StoredRoutineMcpRun, next: StoredRoutineMcpRun): boolean {
    if (previous.phase === 'interrupted') return sameRoutineMcpJson(previous, next)
    if (!previous.calls.length && next.phase === 'interrupted') return false
    if (next.phase !== 'active' && next.phase !== 'interrupted') return false
    const oldCalls = previous.calls
    const nextCalls = next.calls
    if (nextCalls.length < oldCalls.length || nextCalls.length > oldCalls.length + 1) return false

    // Every settled historical receipt is immutable. Only a final pending
    // receipt can settle in place; otherwise append at most one fresh receipt.
    const prefixLength = oldCalls.length > 0 && oldCalls.at(-1)!.status === 'pending' && nextCalls.length === oldCalls.length
      ? oldCalls.length - 1
      : oldCalls.length
    for (let index = 0; index < prefixLength; index += 1) {
      if (!sameRoutineMcpJson(oldCalls[index], nextCalls[index])) return false
    }
    if (prefixLength < oldCalls.length) {
      const oldLast = oldCalls[prefixLength]!
      const newLast = nextCalls[prefixLength]
      if (!newLast || oldLast.status !== 'pending' ||
          !sameRoutineMcpJson(
            { id: oldLast.id, call: oldLast.call, callHash: oldLast.callHash, startedAt: oldLast.startedAt },
            { id: newLast.id, call: newLast.call, callHash: newLast.callHash, startedAt: newLast.startedAt },
          ) || newLast.status === 'pending') return false
      if (nextCalls.length !== oldCalls.length) return false
    }
    if (next.phase === 'interrupted') {
      if (nextCalls.length !== oldCalls.length ||
          (oldCalls.length > 0 && oldCalls.at(-1)!.status !== 'pending' && !sameRoutineMcpJson(oldCalls, nextCalls))) return false
      return true
    }
    if (nextCalls.length === oldCalls.length + 1 && oldCalls.some((call) =>
      call.status === 'pending' || call.status === 'uncertain' || (call.status === 'failed' && call.result !== undefined))) return false
    return true
  }
}
