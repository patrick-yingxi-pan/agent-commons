import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentRequestApproval } from '../contract/agentRequests.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import { ProxyRequestExecution, type ProxyRequestExecutionPort } from './proxyRequestExecution.ts'
import { ProxyRequestError, ProxyRequestRegistry } from './proxyRequestRegistry.ts'
import { cancelProxyRequest, createProxyRequest, parseStoredProxyRequest, proxyRequestView,
  type ProxyActor, type StoredProxyRequest } from './proxyRequestState.ts'

const at = 10_000
const approval: AgentRequestApproval = {
  transport: 'http', call: {
    connectionId: 'mcp-connection-execution-test', connectionRevision: 3,
    toolName: 'lookup', schemaHash: 'b'.repeat(64), arguments: { key: 'invoice-1' },
  },
}
const done: McpBoundExecutionOutcome = {
  status: 'done', summary: 'executor summary',
  result: { resultType: 'complete', content: [{ type: 'text', text: 'PRIVATE TOOL RESULT' }], isError: false },
}
const failed: McpBoundExecutionOutcome = { status: 'failed', summary: 'executor refused before submission' }

function actors(index: number, tenant = `tenant-${index}`, ownerAgent = `owner-agent-${index}`) {
  const requester = { tenantId: `requester-tenant-${index}`, userId: `requester-person-${index}`, agentId: `requester-agent-${index}` }
  const owner = { tenantId: tenant, userId: `owner-person-${index}`, agentId: ownerAgent }
  return { requester, owner, requesterActor: { tenantId: requester.tenantId, userId: requester.userId },
    ownerActor: { tenantId: owner.tenantId, userId: owner.userId } }
}

function row(index: number, tenant?: string, ownerAgent?: string): StoredProxyRequest {
  const parties = actors(index, tenant, ownerAgent)
  return createProxyRequest({ id: `agent-request-${index.toString(16).padStart(32, '0')}`,
    requester: parties.requester, owner: parties.owner, task: `Execute bounded task ${index}.`, createdAt: at })
}

function invocation(revision = 1, selected: AgentRequestApproval = approval) {
  return { action: 'run', expectedRevision: revision, approval: selected }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i += 1) await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(predicate(), message)
}

function harness(options: {
  execute?: ProxyRequestExecutionPort['execute']
  permitted?: (row: StoredProxyRequest, selected: AgentRequestApproval) => boolean
  commit?: <T>(operation: () => T) => T
} = {}) {
  const registry = new ProxyRequestRegistry()
  const events: string[] = []
  const errors: unknown[] = []
  const port: ProxyRequestExecutionPort = {
    registry,
    ready: () => true,
    permitted: options.permitted ?? (() => true),
    execute: options.execute ?? (async () => done),
    commit: options.commit ?? (operation => { events.push('commit'); return operation() }),
    changed: id => { events.push(`changed:${id}`) },
    now: () => at + 1,
    onError: error => { errors.push(error) },
  }
  return { registry, events, errors, execution: new ProxyRequestExecution(port) }
}

function admit(registry: ProxyRequestRegistry, value: StoredProxyRequest): void { registry.put(value) }

test('pending state commits before one physical call starts; commit failure never dispatches', async () => {
  const gate = deferred<McpBoundExecutionOutcome>()
  const observed: string[] = []
  const item = row(1)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const h = harness({ execute: async frozen => { observed.push(`execute:${frozen.status}`); return gate.promise } })
  admit(h.registry, item)

  h.execution.start(item.intent.id, ownerActor, invocation(), () => true)
  assert.deepEqual(h.events, ['commit', `changed:${item.intent.id}`])
  assert.equal(h.registry.get(item.intent.id)?.execution?.status, 'pending')
  assert.deepEqual(observed, [], 'the effect executor cannot run before the durable pending receipt is visible')
  await until(() => observed.length === 1, 'one physical execution should start after commit')
  assert.deepEqual(observed, ['execute:running'])
  gate.resolve(done)
  await h.execution.stop()

  const failedItem = row(2)
  const failedActor = { tenantId: failedItem.intent.owner.tenantId, userId: failedItem.intent.owner.userId }
  let calls = 0
  const rejected = harness({ execute: async () => { calls += 1; return done }, commit: () => { throw new Error('durable write failed') } })
  admit(rejected.registry, failedItem)
  assert.throws(() => rejected.execution.start(failedItem.intent.id, failedActor, invocation(), () => true), /durable write failed/)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 0)
  assert.equal(rejected.execution.activeCount(), 0)
  assert.equal(rejected.registry.get(failedItem.intent.id)?.status, 'waiting')
})

test('only the exact owner at the exact revision with valid approval can start; restore-fenced history refuses', () => {
  const item = row(3)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const outsider = { ...ownerActor, userId: 'someone-else' }
  const h = harness()
  admit(h.registry, item)
  const reject = (actor: ProxyActor, input: unknown) => assert.throws(
    () => h.execution.start(item.intent.id, actor, input, () => true),
  )
  reject(outsider, invocation())
  reject(ownerActor, invocation(2))
  reject(ownerActor, { ...invocation(), approval: { ...approval, unknown: true } })
  reject(ownerActor, invocation(1, { ...approval, transport: 'stdio' } as never))
  assert.equal(h.execution.activeCount(), 0)
  assert.equal(h.registry.get(item.intent.id)?.status, 'waiting')

  const fenced = parseStoredProxyRequest({ ...item, executionBlockedByRestore: true })
  const fencedHarness = harness()
  admit(fencedHarness.registry, fenced)
  assert.throws(() => fencedHarness.execution.start(item.intent.id, ownerActor, invocation(), () => true))
  assert.equal(fencedHarness.registry.get(item.intent.id)?.executionBlockedByRestore, true)
  assert.equal(fencedHarness.execution.activeCount(), 0)
})

test('one request dispatches once and cannot be restarted while running or after settlement', async () => {
  const gate = deferred<McpBoundExecutionOutcome>()
  let calls = 0
  const item = row(4)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const h = harness({ execute: async () => { calls += 1; return gate.promise } })
  admit(h.registry, item)

  h.execution.start(item.intent.id, ownerActor, invocation(), () => true)
  await until(() => calls === 1, 'first call should begin')
  assert.throws(() => h.execution.start(item.intent.id, ownerActor, invocation(), () => true),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')
  gate.resolve(done)
  await until(() => h.execution.activeCount() === 0, 'physical call should settle')
  assert.equal(h.registry.get(item.intent.id)?.status, 'awaiting-reply')
  assert.throws(() => h.execution.start(item.intent.id, ownerActor, invocation(3), () => true),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')
  assert.equal(calls, 1)
})

test('authority is rechecked through the bound executor wait and late cancelled results remain owner-private', async () => {
  const permission = { current: true }
  const gate = deferred<McpBoundExecutionOutcome>()
  let boundAllowed: (() => boolean) | undefined
  let signal: AbortSignal | undefined
  let calls = 0
  const item = row(5)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const h = harness({
    permitted: () => permission.current,
    execute: async (_frozen, allowed, abort) => { calls += 1; boundAllowed = allowed; signal = abort; return gate.promise },
  })
  admit(h.registry, item)
  h.execution.start(item.intent.id, ownerActor, invocation(), () => true)
  await until(() => calls === 1, 'executor should receive a call with the live authority callback')
  assert.equal(boundAllowed!(), true)

  // The request is cancelled while the physical promise is unresolved. The
  // aborted signal does not release capacity; known late truth is retained.
  const requesterActor = { tenantId: item.intent.requester.tenantId, userId: item.intent.requester.userId }
  h.registry.put(cancelProxyRequest(h.registry.get(item.intent.id)!, requesterActor, 2, at + 2))
  h.execution.cancel(item.intent.id)
  assert.equal(signal?.aborted, true)
  assert.equal(h.execution.activeCount(), 1)
  assert.throws(() => h.execution.start(item.intent.id, ownerActor, invocation(3), () => true),
    'cancellation cannot reopen or dispatch a second call')
  permission.current = false
  assert.equal(boundAllowed!(), false, 'the executor sees current revocation after its asynchronous wait')
  gate.resolve(done)
  await until(() => h.execution.activeCount() === 0, 'late physical settlement should release capacity')

  const final = h.registry.get(item.intent.id)!
  assert.equal(final.status, 'cancelled')
  assert.equal(final.execution?.status, 'done', 'late known outcome is kept without reopening the request')
  const ownerView = proxyRequestView(final, ownerActor)!
  const requesterView = proxyRequestView(final, { tenantId: item.intent.requester.tenantId, userId: item.intent.requester.userId })!
  assert.equal(JSON.stringify(ownerView).includes('PRIVATE TOOL RESULT'), true)
  assert.equal('execution' in requesterView, false, 'raw result remains private to the owner')
})

test('live authority loss after a wait prevents the executor from authorizing its effect', async () => {
  const permission = { current: true }
  const gate = deferred<void>()
  let boundAllowed: (() => boolean) | undefined
  let calls = 0
  const item = row(6)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const h = harness({
    permitted: () => permission.current,
    execute: async (_frozen, allowed) => {
      calls += 1
      boundAllowed = allowed
      await gate.promise
      return allowed() ? done : failed
    },
  })
  admit(h.registry, item)
  h.execution.start(item.intent.id, ownerActor, invocation(), () => true)
  await until(() => calls === 1, 'executor should enter its wait')
  permission.current = false
  gate.resolve()
  await until(() => h.execution.activeCount() === 0, 'executor should settle after rechecking authority')
  assert.equal(boundAllowed!(), false)
  assert.equal(h.registry.get(item.intent.id)?.execution?.status, 'failed')
})

test('physical capacity remains occupied through cancellation until ignored-abort work settles', async () => {
  const gate = deferred<McpBoundExecutionOutcome>()
  let signal: AbortSignal | undefined
  const item = row(7)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const h = harness({ execute: async (_frozen, _allowed, abort) => { signal = abort; return gate.promise } })
  admit(h.registry, item)
  h.execution.start(item.intent.id, ownerActor, invocation(), () => true)
  await until(() => signal !== undefined, 'executor should start')

  const requesterActor = { tenantId: item.intent.requester.tenantId, userId: item.intent.requester.userId }
  h.registry.put(cancelProxyRequest(h.registry.get(item.intent.id)!, requesterActor, 2, at + 2))
  h.execution.cancel(item.intent.id)
  assert.equal(signal!.aborted, true)
  assert.equal(h.execution.activeCount(), 1)
  const second = row(8)
  admit(h.registry, second)
  const secondActor = { tenantId: second.intent.owner.tenantId, userId: second.intent.owner.userId }
  h.execution.start(second.intent.id, secondActor, invocation(), () => true)
  await until(() => h.execution.activeCount() === 2, 'other work may use available capacity')

  gate.resolve(done)
  await until(() => h.execution.activeCount() === 0, 'both physical calls should settle')
  assert.equal(h.registry.get(item.intent.id)?.status, 'cancelled')
  assert.equal(h.registry.get(item.intent.id)?.execution?.status, 'done')
})

test('global, per-tenant, and per-owner-Agent concurrency limits are enforced', async () => {
  const pending: ReturnType<typeof deferred<McpBoundExecutionOutcome>>[] = []
  const h = harness({ execute: async () => {
    const gate = deferred<McpBoundExecutionOutcome>()
    pending.push(gate)
    return gate.promise
  } })
  const start = (value: StoredProxyRequest) => {
    admit(h.registry, value)
    h.execution.start(value.intent.id, { tenantId: value.intent.owner.tenantId, userId: value.intent.owner.userId }, invocation(), () => true)
  }

  start(row(10, 'tenant-a'))
  start(row(11, 'tenant-a'))
  assert.throws(() => start(row(12, 'tenant-a')),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit',
    'one tenant cannot use more than two physical slots')
  start(row(13, 'tenant-b'))
  assert.throws(() => start(row(14, 'tenant-b', 'owner-agent-13')),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit',
    'one owner Agent cannot hold two simultaneous slots')
  start(row(15, 'tenant-c'))
  assert.equal(h.execution.activeCount(), 4)
  assert.throws(() => start(row(16, 'tenant-d')),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit',
    'the process cannot exceed four physical slots')

  await until(() => pending.length === 4, 'all admitted calls should enter the executor')
  const stopping = h.execution.stop()
  for (const gate of pending) gate.resolve(failed)
  await stopping
  await until(() => h.execution.activeCount() === 0, 'capacity test workers should settle')
})

test('stop aborts every worker and waits for physical settlement even when executor ignores abort', async () => {
  const gate = deferred<McpBoundExecutionOutcome>()
  let signal: AbortSignal | undefined
  const item = row(20)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const h = harness({ execute: async (_frozen, _allowed, abort) => { signal = abort; return gate.promise } })
  admit(h.registry, item)
  h.execution.start(item.intent.id, ownerActor, invocation(), () => true)
  await until(() => signal !== undefined, 'executor should start')

  let stopped = false
  const stop = h.execution.stop().then(() => { stopped = true })
  assert.equal(signal!.aborted, true)
  await Promise.resolve()
  assert.equal(stopped, false, 'stop must wait while the physical promise is still unresolved')
  assert.equal(h.execution.activeCount(), 1)
  gate.resolve(done)
  await stop
  assert.equal(stopped, true)
  assert.equal(h.execution.activeCount(), 0)
  assert.equal(h.registry.get(item.intent.id)?.execution?.status, 'done')
})

test('settlement commit failure is observed and the worker is closed without automatic replay', async () => {
  const errors: unknown[] = []
  let failSettlement = false
  const item = row(21)
  const ownerActor = { tenantId: item.intent.owner.tenantId, userId: item.intent.owner.userId }
  const portHarness = harness({ commit: operation => {
    if (failSettlement) throw new Error('settlement persistence failed')
    return operation()
  } })
  // Replace the callback with a recorder without changing the execution port.
  const execution = new ProxyRequestExecution({
    registry: portHarness.registry, ready: () => true, permitted: () => true,
    execute: async () => done,
    commit: operation => { if (failSettlement) throw new Error('settlement persistence failed'); return operation() },
    changed: id => { portHarness.events.push(`changed:${id}`) }, now: () => at + 1,
    onError: error => { errors.push(error) },
  })
  admit(portHarness.registry, item)
  execution.start(item.intent.id, ownerActor, invocation(), () => true)
  failSettlement = true
  await until(() => execution.activeCount() === 0, 'failed settlement should still close the worker')
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]), /settlement persistence failed/)
  assert.equal(portHarness.registry.get(item.intent.id)?.execution?.status, 'pending',
    'a failed durable settlement does not invent a terminal receipt')
  assert.throws(() => execution.start(item.intent.id, ownerActor, invocation(2), () => true),
    'pending uncertainty cannot be automatically dispatched again')
})
