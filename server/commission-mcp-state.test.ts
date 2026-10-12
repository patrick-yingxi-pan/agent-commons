import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpApprovalIntent, CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpToolPermission, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  interruptCommissionMcpAttempt, parseCommissionMcpAttempt, reserveCommissionMcpAttempt,
  settleCommissionMcpAttempt, type StoredCommissionMcpAttempt,
} from './commissionMcpState.ts'
import {
  approveCommissionMcpPolicy, CommissionMcpPolicyError, revokeCommissionMcpPolicy,
  type CommissionMcpScope, type StoredCommissionMcpPolicy,
} from './commissionMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const tenantId = 'tenant-owner'
const ownerUserId = 'person-owner'
const projectId = 'project-shared'
const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const tool = { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)
const scope: CommissionMcpScope = { tenantId, ownerUserId, projectId, commissionId: 'commission-a', agentId: 'agent-a' }
const result: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false }

function permission(): McpToolPermission {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }
}

function connection(): McpConnectionView {
  return { id: connectionId, label: 'Reviewed peer', status: 'connected', revision: 7, authentication: 'none',
    protocolVersion: '2026-07-28', inspectedAt: now, tools: [tool], execution: 'approval-required', executableTools: ['search'] }
}

function reader(counter?: { reads: number[] }, expectedOwner = ownerUserId) {
  return (id: string, tenant: string, owner: string) => {
    counter?.reads.push(1)
    return id === connectionId && tenant === tenantId && owner === expectedOwner ? connection() : undefined
  }
}

function grant(commission = 'commission-a', owner = ownerUserId, project = projectId, revision = 1): StoredCommissionMcpPolicy {
  const currentScope = { ...scope, commissionId: commission, ownerUserId: owner, projectId: project }
  const intent: CommissionMcpApprovalIntent = { expectedRevision: 0, expectedConfigurationRevision: 4, reviewHash,
    execution: { agentId: 'agent-a', providerId: 'provider-a', modelId: 'model-a' }, expiresAt: now + 60_000,
    maxWorkItems: 3, tools: [permission()] }
  const approved = approveCommissionMcpPolicy(currentScope, undefined, { configurationRevision: 4, reviewHash }, intent, now, reader(undefined, owner))
  return revision === 1 ? approved : { ...approved, policy: { ...approved.policy, revision } }
}

function work(itemId = 'work-item-a', type: CommissionMcpWork['type'] = 'mcp.mutate', target = 'search'): CommissionMcpWork {
  return { itemId, subGoal: 'Search the reviewed source', type, target, note: '' }
}

function call(arguments_: Record<string, unknown> = {}): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'] }
}

function reserve(current: StoredCommissionMcpAttempt | undefined, overrides: Partial<Parameters<typeof reserveCommissionMcpAttempt>[1]> = {}) {
  const permission = grant()
  return reserveCommissionMcpAttempt(current, { permission, work: work(), call: call({ query: 'otters' }), live: permission,
    review: { configurationRevision: 4, reviewHash }, now, connection: reader(), ...overrides })
}

function errorCode(fn: () => unknown, code: CommissionMcpPolicyError['code'] = 'invalid'): void {
  assert.throws(fn, (error: unknown) => error instanceof CommissionMcpPolicyError && error.code === code)
}

test('admission accepts only detached exact mcp.mutate work, matching target, grant, call, and owner connection', () => {
  const fixed = work()
  const admitted = reserve(undefined, { work: fixed })
  fixed.note = 'changed after admission'
  assert.equal(admitted.created, true)
  assert.equal(admitted.attempt.status, 'pending')
  assert.equal(admitted.attempt.work.note, '')
  assert.deepEqual(parseCommissionMcpAttempt(admitted.attempt), admitted.attempt)

  for (const badWork of [work('item', 'mcp.read' as never), work('item', 'mcp.mutate', 'other'),
    { ...work(), extra: true } as unknown as CommissionMcpWork, { ...work(), itemId: ' bad' }]) {
    assert.throws(() => reserve(undefined, { work: badWork }), CommissionMcpPolicyError)
  }
  errorCode(() => reserve(undefined, { live: undefined }), 'denied')
  errorCode(() => reserve(undefined, { connection: () => undefined }), 'denied')
  errorCode(() => reserve(undefined, { now: now + 60_000 }), 'denied')
})

test('receipt identity is stable across Commission, owner, and grant replacement, and disjoint by Project/work item', () => {
  const a = reserveCommissionMcpAttempt(undefined, { permission: grant(), work: work(), call: call(), live: grant(),
    review: { configurationRevision: 4, reviewHash }, now, connection: reader() }).attempt
  const bGrant = grant('commission-b', 'person-other', projectId, 9)
  const b = reserveCommissionMcpAttempt(undefined, { permission: bGrant,
    work: work(), call: call(), live: bGrant, review: { configurationRevision: 4, reviewHash }, now,
    connection: (id, tenant, owner) => id === connectionId && tenant === tenantId && owner === 'person-other' ? connection() : undefined }).attempt
  assert.equal(a.id, b.id)

  const projectGrant = grant('commission-a', ownerUserId, 'project-other')
  const item = work('work-item-b')
  const ids = [
    a.id,
    reserveCommissionMcpAttempt(undefined, { permission: projectGrant, work: work(), call: call(), live: projectGrant,
      review: { configurationRevision: 4, reviewHash }, now, connection: reader() }).attempt.id,
    reserveCommissionMcpAttempt(undefined, { permission: grant(), work: item, call: call(), live: grant(),
      review: { configurationRevision: 4, reviewHash }, now, connection: reader() }).attempt.id,
  ]
  assert.equal(new Set(ids).size, ids.length)
})

test('identity and intent tampering fail closed; replay is exact and does not reread connection after revocation', () => {
  const pending = reserve(undefined).attempt
  for (const mutate of [
    (copy: any) => { copy.call.arguments.query = 'changed' },
    (copy: any) => { copy.work.note = 'changed' },
    (copy: any) => { copy.permission.ownerUserId = 'person-other' },
    (copy: any) => { copy.id = 'commission-mcp-forged' },
    (copy: any) => { copy.intentHash = '0'.repeat(64) },
  ]) {
    const tampered = structuredClone(pending)
    mutate(tampered)
    errorCode(() => parseCommissionMcpAttempt(tampered))
  }
  const revoked = revokeCommissionMcpPolicy(pending.permission, pending.permission.policy.revision)
  const reads = { reads: [] as number[] }
  const replay = reserveCommissionMcpAttempt(pending, { permission: pending.permission, work: pending.work, call: pending.call,
    live: revoked, review: { configurationRevision: 999, reviewHash: 'd'.repeat(64) }, now: now + 99_999,
    connection: reader(reads) })
  assert.equal(replay.created, false)
  assert.equal(replay.attempt.id, pending.id)
  assert.equal(reads.reads.length, 0)
  errorCode(() => reserveCommissionMcpAttempt(pending, { permission: pending.permission, work: pending.work,
    call: call({ query: 'changed' }), live: pending.permission, review: { configurationRevision: 4, reviewHash }, now, connection: reader() }), 'stale')
})

test('approval has half-open time bounds and reservation state agrees with validated outcomes', () => {
  assert.equal(reserve(undefined).created, true)
  errorCode(() => reserve(undefined, { now: now - 1 }), 'denied')
  errorCode(() => reserve(undefined, { now: now + 60_000 }), 'denied')
  const pending = reserve(undefined).attempt
  const done = settleCommissionMcpAttempt(pending, { status: 'done', summary: 'private', result }, now + 2)
  assert.equal(done.status, 'done')
  assert.deepEqual(done.result, result)
  assert.doesNotMatch(JSON.stringify(done), /private/)
  const failed = settleCommissionMcpAttempt(pending, { status: 'failed', summary: 'pre-submit refusal' }, now + 2)
  assert.equal(failed.status, 'failed')
  for (const outcome of [
    { status: 'done', summary: 'missing' },
    { status: 'failed', summary: 'contradiction', result },
    { status: 'done', summary: 'bad', result: { ...result, isError: true } },
    { status: 'done', summary: 'oversized', result: { resultType: 'complete', content: [{ type: 'text', text: 'x'.repeat(300_000) }], isError: false } },
    { status: 'unexpected' },
  ]) {
    assert.equal(settleCommissionMcpAttempt(pending, outcome as never, now + 2).status, 'uncertain')
  }
  errorCode(() => settleCommissionMcpAttempt(done, { status: 'failed', summary: '' }, now + 3))
})

test('parse and reserve do not invoke getters; terminal receipts are immutable and restart never redispatches', () => {
  const getterAttempt = { ...reserve(undefined).attempt }
  let getterCalls = 0
  Object.defineProperty(getterAttempt, 'id', { enumerable: true, get() { getterCalls += 1; return 'id' } })
  errorCode(() => parseCommissionMcpAttempt(getterAttempt))
  assert.equal(getterCalls, 0)
  const getterCall = call()
  Object.defineProperty(getterCall.arguments, 'secret', { enumerable: true, get() { getterCalls += 1; return 'secret' } })
  errorCode(() => reserve(undefined, { call: getterCall }))
  assert.equal(getterCalls, 0)

  const pending = reserve(undefined).attempt
  const uncertain = interruptCommissionMcpAttempt(pending, now)
  assert.equal(uncertain.status, 'uncertain')
  assert.equal(uncertain.finishedAt, pending.startedAt)
  assert.deepEqual(interruptCommissionMcpAttempt(uncertain, now + 5), uncertain)
  const terminal = settleCommissionMcpAttempt(pending, { status: 'done', summary: '', result }, now + 2)
  assert.deepEqual(interruptCommissionMcpAttempt(terminal, now + 3), terminal)
  const terminalReplay = reserveCommissionMcpAttempt(terminal, { permission: terminal.permission, work: terminal.work,
    call: terminal.call, live: terminal.permission, review: { configurationRevision: 4, reviewHash }, now,
    connection: () => { throw new Error('must not read') } })
  assert.equal(terminalReplay.created, false)
})

test('parser enforces closed receipt states and retains only agreement-consistent error results', () => {
  const pending = reserve(undefined).attempt
  const errorResult: McpToolResult = { ...result, content: [{ type: 'text', text: 'remote error' }], isError: true }
  const failed = settleCommissionMcpAttempt(pending, { status: 'failed', summary: 'ignored summary', result: errorResult }, now + 2)
  assert.equal(failed.status, 'failed')
  assert.deepEqual(failed.result, errorResult)
  assert.deepEqual(parseCommissionMcpAttempt(failed), failed)

  const done = settleCommissionMcpAttempt(pending, { status: 'done', summary: '', result }, now + 2)
  const failedWithoutError = settleCommissionMcpAttempt(pending, { status: 'failed', summary: '' }, now + 2)
  assert.throws(() => parseCommissionMcpAttempt({ ...done, result: errorResult }), CommissionMcpPolicyError)
  assert.throws(() => parseCommissionMcpAttempt({ ...failedWithoutError, result }), CommissionMcpPolicyError)
  assert.throws(() => parseCommissionMcpAttempt({ ...pending, extra: true }), CommissionMcpPolicyError)
  assert.throws(() => parseCommissionMcpAttempt({ ...pending, status: 'unknown' }), CommissionMcpPolicyError)
  assert.throws(() => parseCommissionMcpAttempt({ ...done, finishedAt: pending.startedAt - 1 }), CommissionMcpPolicyError)

  let getterCalls = 0
  const outcome = { status: 'done', summary: 'ignored', result } as Record<string, unknown>
  Object.defineProperty(outcome, 'private', { enumerable: true, get() { getterCalls += 1; return 'private' } })
  const uncertain = settleCommissionMcpAttempt(pending, outcome as never, now + 2)
  assert.equal(uncertain.status, 'uncertain')
  assert.equal(getterCalls, 0)
})
