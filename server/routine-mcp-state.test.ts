import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoutineMcpApprovalIntent } from '../contract/routineMcp.ts'
import type { McpBoundToolCall, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  createRoutineMcpRun, interruptRoutineMcpRun, parseRoutineMcpRun,
  reserveRoutineMcpCall, routineMcpRunMayRetry, settleRoutineMcpCall, publicRoutineMcpReceipt,
  type StoredRoutineMcpRun,
} from './routineMcpState.ts'
import { approveRoutineMcpPolicy, revokeRoutineMcpPolicy, type StoredRoutineMcpPolicy } from './routineMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const tenantId = 'tenant-a'
const routineId = 'routine-a'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const tool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)
const result: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false }

function policy(scope = { tenantId, routineId }, maxCallsPerRun = 3): StoredRoutineMcpPolicy {
  const connection: McpConnectionView = {
    id: connectionId, label: 'Reviewed MCP', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [tool], execution: 'approval-required', executableTools: ['search'],
  }
  const intent: RoutineMcpApprovalIntent = {
    expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash, expiresAt: now + 60_000,
    maxCallsPerRun, tools: [{ connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }],
  }
  return approveRoutineMcpPolicy(scope, undefined, 4, intent, now, (id, tenant) => id === connectionId && tenant === scope.tenantId ? connection : undefined)
}

function call(arguments_: Record<string, unknown> = {}): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'] }
}

function connectionReader() {
  const row: McpConnectionView = {
    id: connectionId, label: 'Reviewed MCP', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [tool], execution: 'approval-required', executableTools: ['search'],
  }
  return (id: string, tenant: string) => id === connectionId && tenant === tenantId ? row : undefined
}

function reserve(run: StoredRoutineMcpRun, key: string, input = call(), overrides: Partial<Parameters<typeof reserveRoutineMcpCall>[1]> = {}) {
  return reserveRoutineMcpCall(run, {
    key, call: input, live: run.permission, definitionRevision: 4, reviewHash, now: now + 1,
    connection: connectionReader(), ...overrides,
  })
}

function error(fn: () => unknown, includes?: string): void {
  assert.throws(fn, (thrown: unknown) => {
    assert.ok(thrown instanceof Error)
    if (includes) assert.ok(thrown.message.includes(includes))
    return true
  })
}

test('create and parse admit one strict detached run ledger', () => {
  const approval = policy()
  const run = createRoutineMcpRun(approval, 'run-a')
  assert.match(run.permissionHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(run, { permission: approval, permissionHash: run.permissionHash, runId: 'run-a', phase: 'active', calls: [] })
  assert.notEqual(run.permission, approval)
  assert.deepEqual(parseRoutineMcpRun(run), run)

  for (const malformed of [
    { ...run, extra: true }, { ...run, runId: ' run-a' }, { ...run, phase: 'complete' },
    { ...run, permission: { ...approval, policy: { ...approval.policy, approval: null } } },
    { ...run, calls: {} },
  ]) error(() => parseRoutineMcpRun(malformed))

  let getterCalls = 0
  const accessor = { permission: approval, runId: 'run-a', phase: 'active', calls: [] as unknown[] }
  Object.defineProperty(accessor, 'runId', { enumerable: true, get() { getterCalls += 1; return 'run-a' } })
  error(() => parseRoutineMcpRun(accessor))
  assert.equal(getterCalls, 0)
  const parsed = parseRoutineMcpRun(run)
  parsed.calls.push({} as never)
  assert.equal(run.calls.length, 0, 'the parse result is detached from the input')
})

test('run admission refuses duplicate receipts, too many calls, and impossible pending state', () => {
  const approval = policy({ tenantId, routineId }, 2)
  const run = createRoutineMcpRun(approval, 'run-a')
  const one = reserve(run, 'logical-1')
  assert.equal(one.created, true)
  error(() => reserve(one.run, 'logical-2'), 'denied')
  const failed = settleRoutineMcpCall(one.run, one.receipt.id, { status: 'failed', summary: 'pre-submit refusal' }, now + 2)
  assert.equal(failed.calls[0].status, 'failed')
  assert.equal(routineMcpRunMayRetry(failed), false)
  const two = reserve(failed, 'logical-2')
  assert.equal(two.created, true, 'a known failed attempt still occupies one slot but leaves the next slot available')
  const done = settleRoutineMcpCall(two.run, two.receipt.id, { status: 'done', summary: 'ok', result }, now + 3)
  assert.equal(done.calls.length, 2)
  assert.throws(() => reserve(done, 'logical-3'), (thrown: unknown) => thrown instanceof Error && thrown.message.includes('limit'))

  error(() => parseRoutineMcpRun({ ...run, calls: [one.receipt, one.receipt] }))
  const independentlyValidPending = reserve(run, 'logical-other').receipt
  assert.deepEqual(parseRoutineMcpRun({ ...run, calls: [independentlyValidPending] }).calls, [independentlyValidPending])
  const twoPending = { ...run, calls: [one.receipt, independentlyValidPending] }
  error(() => parseRoutineMcpRun(twoPending))
  error(() => parseRoutineMcpRun({ ...run, phase: 'interrupted', calls: [one.receipt] }))
  const independent = reserve(run, 'logical-third')
  const third = settleRoutineMcpCall(independent.run, independent.receipt.id, { status: 'done', summary: '', result }, now + 3).calls[0]
  assert.deepEqual(parseRoutineMcpRun({ ...run, calls: [third] }).calls, [third])
  error(() => parseRoutineMcpRun({ ...run, calls: [...done.calls, third] }))
  for (const stopped of [
    one.receipt,
    settleRoutineMcpCall(one.run, one.receipt.id, { status: 'uncertain', summary: '' }, now + 2).calls[0],
    settleRoutineMcpCall(one.run, one.receipt.id, { status: 'failed', summary: '', result: { ...result, isError: true } }, now + 2).calls[0],
  ]) {
    assert.deepEqual(parseRoutineMcpRun({ ...run, calls: [stopped] }).calls, [stopped])
    error(() => parseRoutineMcpRun({ ...run, calls: [stopped, third] }))
  }
})

test('reservation snapshots caller input and host-key replay is exact and precedes current authority checks', () => {
  const approval = policy()
  const run = createRoutineMcpRun(approval, 'run-a')
  const original = call({ query: 'private query' })
  const first = reserve(run, 'host-key', original)
  assert.equal(first.created, true)
  original.arguments.query = 'mutated after reserve'
  assert.deepEqual(first.receipt.call.arguments, { query: 'private query' })
  assert.equal(run.calls.length, 0, 'reservation is a pure transition over the caller-owned run')

  const revoked = revokeRoutineMcpPolicy(approval, approval.policy.revision)
  const replay = reserve(first.run, 'host-key', call({ query: 'private query' }), {
    live: revoked, definitionRevision: 999, now: now + 99_999,
  })
  assert.equal(replay.created, false)
  assert.equal(replay.receipt.id, first.receipt.id)
  assert.equal(replay.receipt.status, 'pending')
  assert.throws(() => reserve(run, 'other-key', call(), { reviewHash: 'd'.repeat(64) }), /denied/)
  assert.throws(() => reserve(first.run, 'host-key', call({ query: 'changed query' })), /stale/)
  let refusal = ''
  try { reserve(first.run, 'secret-key', call({ query: 'secret payload' }), { live: undefined }) } catch (thrown) { refusal = String(thrown) }
  assert.doesNotMatch(refusal, /secret-key|secret payload/)
})

test('receipt IDs are disjoint across tenant, Routine, and run scopes', () => {
  const scopes = [
    { tenantId, routineId, runId: 'run-same' },
    { tenantId: 'tenant-b', routineId, runId: 'run-same' },
    { tenantId, routineId: 'routine-b', runId: 'run-same' },
    { tenantId, routineId, runId: 'run-other' },
  ]
  const receipts = scopes.map(({ tenantId: tenant, routineId: routine, runId }) => {
    const p = policy({ tenantId: tenant, routineId: routine })
    const active = createRoutineMcpRun(p, runId)
    const out = reserveRoutineMcpCall(active, { key: 'same-key', call: call(), live: p, definitionRevision: 4, reviewHash, now: now + 1,
      connection: (id, owner) => id === connectionId && owner === tenant ? connectionReader()(id, tenantId) : undefined })
    return out.receipt.id
  })
  assert.equal(new Set(receipts).size, scopes.length)

  const source = reserve(createRoutineMcpRun(policy(), 'source-run'), 'host-key').run
  assert.throws(() => parseRoutineMcpRun({ ...source, runId: 'target-run' }), /invalid/)
  const changedCall = structuredClone(source)
  changedCall.calls[0].call.arguments = { retargeted: true }
  assert.throws(() => parseRoutineMcpRun(changedCall), /invalid/)
  const changedPermission = structuredClone(source)
  changedPermission.permission.policy.approval!.definitionRevision += 1
  assert.throws(() => parseRoutineMcpRun(changedPermission), /invalid/)
})

test('an empty queued ledger cannot replace its frozen approval with a newer live review', () => {
  const original = policy()
  const run = createRoutineMcpRun(original, 'queued-run')
  const renewed = { ...original, policy: { ...original.policy, revision: 2 } }
  const rewritten = { ...run, permission: renewed }
  assert.throws(() => parseRoutineMcpRun(rewritten), /invalid/)
  assert.throws(() => reserve(rewritten, 'new-call', call(), { live: renewed }), /invalid/)
})

test('settlement validates state/outcome agreement and converts unretainable results to uncertain', () => {
  const pending = reserve(createRoutineMcpRun(policy(), 'run-a'), 'key').run
  const receipt = pending.calls[0]
  assert.equal(receipt.status, 'pending')
  assert.equal(settleRoutineMcpCall(pending, receipt.id, { status: 'done', summary: 'missing result' } as never, now + 2).calls[0].status, 'uncertain')
  assert.equal(settleRoutineMcpCall(pending, receipt.id, { status: 'failed', summary: 'contradiction', result } as never, now + 2).calls[0].status, 'uncertain')
  assert.throws(() => settleRoutineMcpCall(pending, receipt.id, { status: 'other' } as never, now + 2))
  assert.throws(() => settleRoutineMcpCall(pending, 'routine-mcp-missing', { status: 'uncertain', summary: 'x' }, now + 2))

  const invalid = settleRoutineMcpCall(pending, receipt.id, { status: 'done', summary: 'must be generic', result: { nope: true } as never }, now + 2)
  assert.equal(invalid.calls[0].status, 'uncertain')
  assert.throws(() => reserve(invalid, 'another-call'), /denied/)
  const oversized = settleRoutineMcpCall(pending, receipt.id, { status: 'done', summary: 'private', result: {
    resultType: 'complete', content: [{ type: 'text', text: 'x'.repeat(300_000) }], isError: false,
  } as McpToolResult }, now + 2)
  assert.equal(oversized.calls[0].status, 'uncertain')
  assert.doesNotMatch(JSON.stringify(oversized), /private|x{100}/)

  const good = settleRoutineMcpCall(pending, receipt.id, { status: 'done', summary: 'ok', result }, now + 2)
  assert.equal(good.calls[0].status, 'done')
  assert.throws(() => settleRoutineMcpCall(good, receipt.id, { status: 'failed', summary: 'rewrite' }, now + 3), /invalid/)
  const failedWithError = settleRoutineMcpCall(pending, receipt.id, {
    status: 'failed', summary: 'known remote error', result: { ...result, isError: true },
  }, now + 2)
  assert.equal(failedWithError.calls[0].status, 'failed')
  assert.throws(() => reserve(failedWithError, 'model-retry-after-tool-error'), /denied/,
    'a tool error can follow partial effects and cannot lead to another automatic call')
})

test('restart turns pending work uncertain and any prior reservation blocks model retry', () => {
  const empty = createRoutineMcpRun(policy(), 'run-empty')
  assert.equal(routineMcpRunMayRetry(empty), true)
  assert.deepEqual(interruptRoutineMcpRun(empty, now + 50), empty)
  const pending = reserve(empty, 'key')
  const interrupted = interruptRoutineMcpRun(pending.run, now)
  assert.equal(interrupted.phase, 'interrupted')
  assert.equal(interrupted.calls[0].status, 'uncertain')
  assert.equal(interrupted.calls[0].finishedAt, pending.receipt.startedAt)
  assert.equal(routineMcpRunMayRetry(interrupted), false)

  const completed = settleRoutineMcpCall(pending.run, pending.receipt.id, { status: 'done', summary: 'complete', result }, now + 2)
  const recovered = interruptRoutineMcpRun(completed, now + 3)
  assert.equal(recovered.calls[0].status, 'done')
  assert.equal(routineMcpRunMayRetry(recovered), false, 'settled external work still forbids replaying the model prompt')
})

test('parse, reserve, and settlement errors do not invoke accessors or leak call data', () => {
  const run = createRoutineMcpRun(policy(), 'run-a')
  let calls = 0
  const accessorCall = call()
  Object.defineProperty(accessorCall.arguments, 'secret', { enumerable: true, get() { calls += 1; return 'secret value' } })
  assert.throws(() => reserve(run, 'private-key', accessorCall))
  assert.equal(calls, 0)

  const pending = reserve(run, 'host-key')
  const outcome = { status: 'done', summary: 'credential-crumb', result: result } as const
  const settled = settleRoutineMcpCall(pending.run, pending.receipt.id, outcome, now + 2)
  assert.doesNotMatch(JSON.stringify(settled), /credential-crumb/)
  assert.throws(() => settleRoutineMcpCall(pending.run, pending.receipt.id, outcome, now), /invalid/)
})

test('legacy permission and call hashes remain byte-for-byte unchanged', () => {
  const run = createRoutineMcpRun(policy(), 'run-a')
  const reserved = reserve(run, 'host-key')
  assert.equal(run.permissionHash, 'cbfc36bcd8f5a9455ec3732e6e6167436b9f59087600e6b40bd618cdb2107b5b')
  assert.equal(reserved.receipt.callHash, 'cba8ea3582b62a4e2722752ae20255815a1535e4770f3ff42be8dec67a2b1b56')
})

test('OAuth authority is hashed into empty and occupied frozen ledgers and retained through terminal recovery', () => {
  const permission = { ...policy(), oauthAuthority: { ownerUserId: 'person-owner', connectionIds: [connectionId] } }
  const run = createRoutineMcpRun(permission, 'run-a')
  const legacy = createRoutineMcpRun(policy(), 'run-a')
  assert.notEqual(run.permissionHash, legacy.permissionHash)
  assert.deepEqual(run.permission.oauthAuthority, permission.oauthAuthority)
  let available = true
  const oauthReader = (id: string, tenant: string, actor?: string) => available && actor === 'person-owner'
    ? { ...connectionReader()(id, tenant)!, authentication: 'device-oauth' as const } : undefined
  const pending = reserve(run, 'host-key', call(), { connection: oauthReader })
  assert.notEqual(pending.receipt.callHash, reserve(legacy, 'host-key').receipt.callHash)
  assert.throws(() => reserve(run, 'wrong-legacy-binding'), /denied/)
  available = false
  assert.throws(() => reserve(run, 'membership-lost', call(), { connection: oauthReader }), /denied/)
  assert.equal(reserve(pending.run, 'host-key', call(), { connection: oauthReader }).created, false, 'represented host work is not re-dispatched')
  for (const source of [run, pending.run]) {
    const changed = structuredClone(source)
    changed.permission.oauthAuthority!.ownerUserId = 'person-peer'
    assert.throws(() => parseRoutineMcpRun(changed), /invalid/)
    delete changed.permission.oauthAuthority
    assert.throws(() => parseRoutineMcpRun(changed), /invalid/)
  }
  const terminal = settleRoutineMcpCall(pending.run, pending.receipt.id, { status: 'done', summary: '', result }, now + 2)
  const interrupted = interruptRoutineMcpRun(pending.run, now + 3)
  for (const state of [terminal, interrupted]) {
    assert.deepEqual(parseRoutineMcpRun(state).permission.oauthAuthority, permission.oauthAuthority)
    assert.equal(routineMcpRunMayRetry(state), false)
    assert.doesNotMatch(JSON.stringify(publicRoutineMcpReceipt(state.calls[0]!)), /oauthAuthority|ownerUserId|person-owner|callHash/)
  }
})
