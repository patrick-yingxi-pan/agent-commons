import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { AgentOwnership } from './agentOwnership.ts'
import type { McpConnectionState } from './mcpConnections.ts'
import {
  MAX_PROXY_ACTIVE_REQUESTS,
  MAX_PROXY_HISTORY_BYTES,
  MAX_PROXY_REQUESTS,
  ProxyRequestError,
  ProxyRequestRegistry,
  parseProxyRequestCreate,
  parseProxyRequests,
  proxyRequestId,
  validateProxyRequestJoins,
} from './proxyRequestRegistry.ts'
import {
  PROXY_REPLY_MAX_BYTES,
  PROXY_RESULT_MAX_BYTES,
  beginProxyRequest,
  beginProxyArgumentDraft,
  cancelProxyRequest,
  createProxyRequest,
  denyProxyRequest,
  settleProxyArgumentDraft,
  settleProxyRequest,
  shareProxyReply,
} from './proxyRequestState.ts'
import { proxyArgumentReservationId } from './proxyArgumentDraftState.ts'

const requester = { tenantId: 'tenant-requester', userId: 'person-requester', agentId: 'agent-requester' }
const owner = { tenantId: 'tenant-owner', userId: 'person-owner', agentId: 'agent-owner' }
const requesterActor = { tenantId: requester.tenantId, userId: requester.userId }
const ownerActor = { tenantId: owner.tenantId, userId: owner.userId }
const outsider = { tenantId: owner.tenantId, userId: 'person-outsider' }
const createdAt = 1_000
const key = 'request-key-1'

function call(overrides: Partial<McpBoundToolCall> = {}): McpBoundToolCall {
  return {
    connectionId: 'mcp-connection-owner', connectionRevision: 3, toolName: 'invoice_lookup',
    schemaHash: 'b'.repeat(64), arguments: { invoice: 'INV-42' }, ...overrides,
  }
}
const approval = { transport: 'http' as const, call: call() }
function create(overrides: Record<string, unknown> = {}) {
  return createProxyRequest({
    id: proxyRequestId(requesterActor, key), requester, owner,
    task: 'Look up the latest invoice status.', createdAt, ...overrides,
  } as never)
}
function running(row = create()) {
  return beginProxyRequest(row, ownerActor, 1, approval, createdAt + 1)
}
function settled(row = running()) {
  return settleProxyRequest(row, row.execution!.callHash, {
    status: 'done', summary: 'Private executor summary.',
    result: { resultType: 'complete', content: [{ type: 'text', text: 'PRIVATE MCP RESULT' }], isError: false },
  }, createdAt + 2)
}
function draftBinding(transport: 'http' | 'stdio' = 'http') {
  return { agentRevision: 0, providerId: 'provider-owner', providerRevision: 0, providerConnectionRevision: 0,
    model: 'model-owner', connectionId: 'mcp-connection-owner', connectionRevision: 3,
    toolName: 'invoice_lookup', schemaHash: 'b'.repeat(64), transport }
}
function ownership(): AgentOwnership[] {
  return [
    { agentId: requester.agentId, tenantId: requester.tenantId, ownerUserId: requester.userId },
    { agentId: owner.agentId, tenantId: owner.tenantId, ownerUserId: owner.userId },
  ]
}
const httpConnection = {
  tenantId: owner.tenantId, id: 'mcp-connection-owner', label: 'Invoices', revision: 3,
  connected: true, endpoint: 'https://mcp.example.test', authentication: 'none' as const,
}
const stdioConnection = {
  tenantId: owner.tenantId, id: 'mcp-connection-owner', label: 'Local invoices', revision: 3,
  connected: true, transport: 'stdio' as const, ownerUserId: owner.userId,
}
const emptyConnections: McpConnectionState = { connections: [], retired: [] }

test('creation parser is closed, bounded, detached, and ID keys include both tenant and person', () => {
  const body = { fromAgentId: 'agent-requester', toAgentId: 'agent-owner', task: 'Check one invoice.' }
  assert.deepEqual(parseProxyRequestCreate(body), body)
  const parsed = parseProxyRequestCreate(body)
  body.task = 'mutated'
  assert.equal(parsed.task, 'Check one invoice.')
  for (const invalid of [
    null, [], { ...body, ownerUserId: 'forged' }, { ...body, idempotencyKey: 'x' },
    { fromAgentId: 'a', toAgentId: 'b' },
    Object.assign(Object.create({ inherited: true }), { fromAgentId: 'a', toAgentId: 'b', task: 'x' }),
  ]) assert.throws(() => parseProxyRequestCreate(invalid))
  const accessor = { fromAgentId: 'a', toAgentId: 'b', task: 'check' }
  Object.defineProperty(accessor, 'task', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => parseProxyRequestCreate(accessor))
  assert.throws(() => parseProxyRequestCreate({ fromAgentId: 'a', toAgentId: 'b', task: 'x'.repeat(20_000) }))

  const id = proxyRequestId(requesterActor, key)
  assert.match(id, /^agent-request-[a-f0-9]{32}$/)
  assert.notEqual(proxyRequestId({ ...requesterActor, userId: 'person-other' }, key), id)
  assert.notEqual(proxyRequestId({ ...requesterActor, tenantId: 'tenant-other' }, key), id)
  assert.notEqual(proxyRequestId(requesterActor, 'request-key-2'), id)
  assert.throws(() => proxyRequestId(requesterActor, 'x'.repeat(201)))
})

test('history parser is strict, detached, bounded, and enforces duplicate and active-row limits', () => {
  assert.deepEqual(parseProxyRequests(undefined), [])
  const waiting = create()
  const result = parseProxyRequests([waiting])
  waiting.intent.task = 'mutated outside parser'
  assert.equal(result[0]!.intent.task, 'Look up the latest invoice status.')
  result[0]!.intent.owner.userId = 'mutated returned row'
  assert.equal(parseProxyRequests([create()])[0]!.intent.owner.userId, owner.userId)

  for (const malformed of [
    {}, 'not rows', [null], [create(), create()],
    [{ ...create(), unexpected: true }],
    [{ ...create(), revision: 2 }],
    [{ ...create(), status: 'replied', reply: 'not executed' }],
  ]) assert.throws(() => parseProxyRequests(malformed))

  const activeRows = Array.from({ length: MAX_PROXY_ACTIVE_REQUESTS + 1 }, (_, index) => create({
    id: proxyRequestId(requesterActor, `active-${index}`),
  }))
  assert.throws(() => parseProxyRequests(activeRows))
  assert.throws(() => parseProxyRequests(Array.from({ length: MAX_PROXY_REQUESTS + 1 }, (_, index) =>
    create({ id: proxyRequestId(requesterActor, `row-${index}`) }))))
})

test('pre-draft near-capacity waiting history remains readable after optional draft support', () => {
  const rows = Array.from({ length: 130 }, (_, index) => create({
    id: `agent-request-${index.toString(16).padStart(32, '0')}`,
    requester: { tenantId: `requester-tenant-${index}`, userId: `requester-user-${index}`, agentId: `requester-agent-${index}` },
    owner: { tenantId: `owner-tenant-${index}`, userId: `owner-user-${index}`, agentId: `owner-agent-${index}` },
  }))
  const actual = rows.reduce((size, row) => size + Buffer.byteLength(JSON.stringify(row), 'utf8') + 1, 2)
  const oldWaitingHeadroom = 65_536 + PROXY_RESULT_MAX_BYTES + 2 * PROXY_REPLY_MAX_BYTES + 8_192
  const oldReserved = actual + rows.length * oldWaitingHeadroom
  assert.ok(oldReserved < MAX_PROXY_HISTORY_BYTES, 'this snapshot fits the pre-draft reservation policy')
  assert.deepEqual(parseProxyRequests(rows).length, rows.length)

  const atLimitRows = Array.from({ length: 143 }, (_, index) => create({
    id: `agent-request-${(index + 1_000).toString(16).padStart(32, '0')}`,
    requester: { tenantId: `requester-tenant-${index}`, userId: `requester-user-${index}`, agentId: `requester-agent-${index}` },
    owner: { tenantId: `owner-tenant-${index}`, userId: `owner-user-${index}`, agentId: `owner-agent-${index}` },
    task: index < 30 ? 'x'.repeat(8_000) : 'A bounded task.',
  }))
  const atLimitActual = atLimitRows.reduce((size, row) => size + Buffer.byteLength(JSON.stringify(row), 'utf8') + 1, 2)
  const atLimitOldReserved = atLimitActual + atLimitRows.length * oldWaitingHeadroom
  assert.ok(atLimitOldReserved < MAX_PROXY_HISTORY_BYTES, 'the larger snapshot also fits before draft headroom')
  assert.ok(atLimitOldReserved + 53_248 > MAX_PROXY_HISTORY_BYTES, 'adding one pending draft reservation exceeds the cap')
  const registry = new ProxyRequestRegistry()
  registry.rehydrate(atLimitRows)
  const first = atLimitRows[0]!
  const pending = beginProxyArgumentDraft(first,
    { tenantId: first.intent.owner.tenantId, userId: first.intent.owner.userId }, first.revision,
    draftBinding(), 'a'.repeat(64), createdAt + 1)
  assert.throws(() => registry.put(pending),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit',
    'a draft that cannot reserve its bounded final receipt is refused before mutation')
  assert.equal(registry.get(first.intent.id)?.argumentDraft, undefined)

  const one = create({ id: 'agent-request-ffffffffffffffffffffffffffffffff' })
  const isolated = new ProxyRequestRegistry()
  isolated.put(one)
  const onePending = beginProxyArgumentDraft(one, ownerActor, one.revision, draftBinding(), 'b'.repeat(64), createdAt + 1)
  isolated.put(onePending)
  const complete = settleProxyArgumentDraft(onePending, 'b'.repeat(64),
    { status: 'done', arguments: { value: 'x'.repeat(48 * 1_024 - 12) } }, createdAt + 2)
  isolated.put(complete)
  assert.equal(isolated.get(one.intent.id)?.argumentDraft?.status, 'done',
    'pending headroom covers the maximum bounded detached argument receipt')
})

test('live and retired Agent ownership plus exact MCP connection provenance are required for structural joins', () => {
  const done = settled()
  const retiredOwnership = ownership().map(row => ({ ...row, retired: true as const }))
  assert.equal(validateProxyRequestJoins([done], ownership(), {
    ...emptyConnections, connections: [httpConnection],
  }), true)
  assert.equal(validateProxyRequestJoins([done], retiredOwnership, {
    ...emptyConnections, retired: [{ tenantId: owner.tenantId, id: httpConnection.id }],
  }), true, 'durable history remains joinable after both Agents and connection retire')

  for (const records of [
    ownership().filter(row => row.agentId !== requester.agentId),
    ownership().map(row => row.agentId === owner.agentId ? { ...row, tenantId: 'tenant-wrong' } : row),
    ownership().map(row => row.agentId === owner.agentId ? { ...row, ownerUserId: 'person-wrong' } : row),
    [...ownership(), ownership()[0]!],
  ]) assert.equal(validateProxyRequestJoins([done], records, { ...emptyConnections, connections: [httpConnection] }), false)
  assert.equal(validateProxyRequestJoins([done], ownership(), emptyConnections), false)
  assert.equal(validateProxyRequestJoins([done], ownership(), {
    ...emptyConnections, connections: [httpConnection], retired: [{ tenantId: owner.tenantId, id: httpConnection.id }],
  }), false, 'ambiguous live/retired connection identity is rejected')
  assert.equal(validateProxyRequestJoins([done], ownership(), {
    ...emptyConnections, connections: [{ ...httpConnection, tenantId: 'tenant-wrong' }],
  }), false)
  assert.equal(validateProxyRequestJoins([done], ownership(), {
    ...emptyConnections, connections: [{ ...httpConnection, ownerUserId: 'person-wrong' }],
  }), false)

  const stdioRun = beginProxyRequest(create(), ownerActor, 1, {
    transport: 'stdio', localPrograms: true, call: call(),
  }, createdAt + 1)
  assert.equal(validateProxyRequestJoins([stdioRun], ownership(), {
    ...emptyConnections, connections: [stdioConnection],
  }), true)
  assert.equal(validateProxyRequestJoins([stdioRun], ownership(), {
    ...emptyConnections, connections: [{ ...stdioConnection, ownerUserId: 'person-other' }],
  }), false)
  assert.equal(validateProxyRequestJoins([stdioRun], ownership(), {
    ...emptyConnections, connections: [httpConnection],
  }), false, 'approved transport must match the frozen connection transport')
})

test('draft receipts reserve bounded result headroom, join their exact historical connection, and recover without replay', () => {
  const pending = beginProxyArgumentDraft(create(), ownerActor, 1, draftBinding(), 'c'.repeat(64), createdAt + 1)
  const connections = { ...emptyConnections, connections: [httpConnection] }
  assert.equal(validateProxyRequestJoins([pending], ownership(), connections), true)
  assert.equal(validateProxyRequestJoins([pending], ownership(), {
    ...emptyConnections, retired: [{ tenantId: owner.tenantId, id: httpConnection.id }],
  }), true, 'historical connection retirement does not invalidate the private receipt')
  for (const invalidConnections of [
    { ...emptyConnections, connections: [{ ...httpConnection, tenantId: 'tenant-wrong' }] },
    { ...emptyConnections, connections: [{ ...httpConnection, ownerUserId: 'person-wrong' }] },
    { ...emptyConnections, connections: [{ ...httpConnection, transport: 'stdio' as const }] },
    { ...emptyConnections, connections: [httpConnection], retired: [{ tenantId: owner.tenantId, id: httpConnection.id }] },
  ]) assert.equal(validateProxyRequestJoins([pending], ownership(), invalidConnections), false)
  assert.equal(proxyArgumentReservationId(pending.intent.id), `${pending.intent.id}:arguments`)

  const registry = new ProxyRequestRegistry()
  registry.put(pending)
  assert.equal(registry.recover(createdAt + 2), true)
  const uncertain = registry.get(pending.intent.id)!
  assert.equal(uncertain.argumentDraft?.status, 'uncertain')
  assert.equal(uncertain.revision, pending.revision + 1)
  assert.equal(registry.recover(createdAt + 3), false)
  assert.throws(() => beginProxyArgumentDraft(uncertain, ownerActor, uncertain.revision, draftBinding(), 'd'.repeat(64), createdAt + 4))

  const cancelledId = proxyRequestId(requesterActor, 'cancelled-draft')
  const cancelledWaiting = create({ id: cancelledId })
  const cancelledDraftPending = beginProxyArgumentDraft(cancelledWaiting, ownerActor, 1,
    draftBinding(), 'e'.repeat(64), createdAt + 1)
  const cancelledPending = cancelProxyRequest(cancelledDraftPending, requesterActor, 2, createdAt + 2)
  const afterCancel = new ProxyRequestRegistry()
  afterCancel.put(cancelledWaiting)
  afterCancel.put(cancelledDraftPending)
  afterCancel.put(cancelledPending)
  assert.equal(afterCancel.recover(createdAt + 3), true, 'a late model completion remains recoverable after requester cancellation')
  assert.equal(afterCancel.get(cancelledPending.intent.id)?.status, 'cancelled')
  assert.equal(afterCancel.get(cancelledPending.intent.id)?.argumentDraft?.status, 'uncertain')

  const atCapacity = new ProxyRequestRegistry()
  for (let index = 0; index < MAX_PROXY_ACTIVE_REQUESTS; index += 1) {
    const row = beginProxyArgumentDraft(create({ id: proxyRequestId(requesterActor, `draft-capacity-${index}`) }), ownerActor, 1,
      draftBinding(), 'f'.repeat(64), createdAt + 1)
    atCapacity.put(row)
  }
  assert.throws(() => atCapacity.put(create({ id: proxyRequestId(requesterActor, 'reserved-draft-capacity') })),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit',
    'a pending draft still consumes the per-person active request budget')
})

test('registry keeps intent immutable, requires adjacent revision, and exposes history only to exact parties', () => {
  const registry = new ProxyRequestRegistry()
  const row = create()
  registry.put(row)
  const changedIntent = denyProxyRequest(create({ task: 'A different task.' }), ownerActor, 1, createdAt + 1)
  assert.throws(() => registry.prepare(changedIntent as never), (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')
  const progressed = settled(running(row))
  assert.throws(() => registry.prepare(progressed as never),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')

  const denied = denyProxyRequest(row, ownerActor, 1, createdAt + 1)
  registry.put(denied)
  assert.equal(registry.get(row.intent.id)?.revision, 2)
  assert.deepEqual(registry.forActor(requesterActor).map(item => item.intent.id), [row.intent.id])
  assert.deepEqual(registry.forActor(ownerActor).map(item => item.intent.id), [row.intent.id])
  assert.deepEqual(registry.forActor(outsider), [])
  assert.deepEqual(registry.forActor({ tenantId: requester.tenantId, userId: owner.userId }), [])

  const returned = registry.get(row.intent.id)!
  returned.intent.owner.userId = 'attacker'
  assert.equal(registry.get(row.intent.id)?.intent.owner.userId, owner.userId)
  assert.equal(registry.snapshot()[0]?.intent.owner.userId, owner.userId)
})

test('failed rehydration is atomic and pending execution recovers to uncertainty without replay', () => {
  const pending = running()
  const cancelledPending = cancelProxyRequest(running(create({
    id: proxyRequestId(requesterActor, 'cancelled-late-history'),
  })), requesterActor, 2, createdAt + 2)
  const registry = new ProxyRequestRegistry()
  registry.rehydrate([pending, cancelledPending])
  const before = registry.snapshot()
  assert.throws(() => registry.rehydrate([pending, { ...pending, unexpected: true }]))
  assert.deepEqual(registry.snapshot(), before)

  const restored = new ProxyRequestRegistry()
  restored.rehydrate(JSON.parse(JSON.stringify(before)))
  assert.equal(restored.recover(createdAt + 10), true)
  const recovered = restored.get(pending.intent.id)!
  assert.equal(recovered.status, 'awaiting-reply')
  assert.equal(recovered.execution?.status, 'uncertain')
  assert.equal(recovered.revision, 3)
  assert.equal(restored.recover(createdAt + 20), false)
  assert.throws(() => beginProxyRequest(recovered, ownerActor, recovered.revision, approval, createdAt + 21))

  const lateHistory = restored.get(cancelledPending.intent.id)!
  assert.equal(lateHistory.status, 'cancelled')
  assert.equal(lateHistory.execution?.status, 'uncertain')
  assert.equal(lateHistory.revision, 4)
  assert.equal(restored.recover(createdAt + 30), false)
  assert.throws(() => beginProxyRequest(lateHistory, ownerActor, lateHistory.revision, approval, createdAt + 31))
})

test('registry caps active requests per exact person and caps total history rows', () => {
  const registry = new ProxyRequestRegistry()
  for (let index = 0; index < MAX_PROXY_ACTIVE_REQUESTS; index += 1) {
    registry.put(create({ id: proxyRequestId(requesterActor, `capacity-${index}`) }))
  }
  assert.equal(registry.snapshot().length, MAX_PROXY_ACTIVE_REQUESTS)
  assert.throws(() => registry.put(create({ id: proxyRequestId(requesterActor, 'capacity-overflow') })),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')

  const full = new ProxyRequestRegistry()
  const rows = Array.from({ length: MAX_PROXY_REQUESTS }, (_, index) => {
    const requesterForRow = { ...requester, tenantId: `tenant-${index}`, userId: `person-${index}` }
    const ownerForRow = { ...owner, tenantId: `owner-tenant-${index}`, userId: `owner-person-${index}` }
    const row = create({
      id: proxyRequestId(requesterForRow, `row-${index}`), requester: requesterForRow, owner: ownerForRow,
    })
    return denyProxyRequest(row, { tenantId: ownerForRow.tenantId, userId: ownerForRow.userId }, 1, createdAt + 1)
  })
  full.rehydrate(rows)
  assert.equal(full.snapshot().length, MAX_PROXY_REQUESTS)
  assert.throws(() => full.put(create({ id: proxyRequestId(requesterActor, 'row-overflow') })),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
})

test('reserved aggregate headroom survives competing admission and admits a maximum escaped reply', () => {
  const registry = new ProxyRequestRegistry()
  const waitingRows = []
  let rejected: unknown
  let overflowRow: ReturnType<typeof create> | undefined
  for (let index = 0; index < MAX_PROXY_REQUESTS; index += 1) {
    const requesterForRow = { ...requester, tenantId: `reserve-tenant-${index}`, userId: `reserve-person-${index}` }
    const ownerForRow = { ...owner, tenantId: `reserve-owner-tenant-${index}`, userId: `reserve-owner-${index}` }
    const row = create({
      id: proxyRequestId(requesterForRow, `reserve-${index}`), requester: requesterForRow, owner: ownerForRow,
    })
    try {
      registry.put(row)
      waitingRows.push(row)
    } catch (error) {
      rejected = error
      overflowRow = row
      break
    }
  }
  assert.ok(rejected instanceof ProxyRequestError && rejected.code === 'limit')
  assert.ok(waitingRows.length > 1, 'aggregate byte capacity stopped admission')
  assert.ok(waitingRows.length < MAX_PROXY_REQUESTS, 'reserved terminal capacity binds before the row-count cap')
  assert.ok(overflowRow)
  assert.deepEqual(parseProxyRequests(waitingRows).length, waitingRows.length)
  assert.throws(() => parseProxyRequests([...waitingRows, overflowRow]))

  const intent = waitingRows[0]!
  const ownerActorForRow = { tenantId: intent.intent.owner.tenantId, userId: intent.intent.owner.userId }
  const largeApproval = { transport: 'http' as const, call: call({ arguments: { payload: 'x'.repeat(48_000) } }) }
  const runningRow = beginProxyRequest(intent, ownerActorForRow, 1, largeApproval, createdAt + 1)
  registry.put(runningRow)

  const resultForMax = (text: string) => ({
    resultType: 'complete' as const, content: [{ type: 'text' as const, text }], isError: false,
  })
  let low = 0
  let high = PROXY_RESULT_MAX_BYTES
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(JSON.stringify(resultForMax('r'.repeat(middle))), 'utf8') <= PROXY_RESULT_MAX_BYTES) low = middle
    else high = middle - 1
  }
  const maximumResult = resultForMax('r'.repeat(low))
  assert.ok(Buffer.byteLength(JSON.stringify(maximumResult), 'utf8') <= PROXY_RESULT_MAX_BYTES)
  assert.ok(Buffer.byteLength(JSON.stringify(resultForMax('r'.repeat(low + 1))), 'utf8') > PROXY_RESULT_MAX_BYTES)
  const settledRow = settleProxyRequest(runningRow, runningRow.execution!.callHash, {
    status: 'done', summary: 'ignored by the private fixed summary', result: maximumResult,
  }, createdAt + 2)
  registry.put(settledRow)

  // Quotes and backslashes are valid prose and each can double in JSON. Keep
  // the raw UTF-8 length at the contract maximum. The large bound call uses
  // most of the waiting-row reservation, exposing an under-sized reply reserve.
  const fullReply = '\\"'.repeat(PROXY_REPLY_MAX_BYTES / 2)
  assert.equal(Buffer.byteLength(fullReply, 'utf8'), PROXY_REPLY_MAX_BYTES)
  const replied = shareProxyReply(settledRow, ownerActorForRow, settledRow.revision, fullReply, createdAt + 3)
  registry.put(replied)
  assert.equal(registry.get(intent.intent.id)?.execution?.status, 'done')
  assert.equal(Buffer.byteLength(registry.get(intent.intent.id)?.reply ?? '', 'utf8'), PROXY_REPLY_MAX_BYTES)
  assert.equal(registry.snapshot().length, waitingRows.length)
})
