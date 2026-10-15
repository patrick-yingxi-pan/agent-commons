import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentRequestArgumentDraftBinding } from '../contract/agentRequests.ts'
import type { McpDiscoveredTool } from '../contract/mcpConnections.ts'
import type { McpJsonValue } from '../contract/mcpExecution.ts'
import type { Budget } from '../contract/budget.ts'
import { UsageRecordingError } from './modelUsage.ts'
import { ProxyArgumentExecution, type ProxyArgumentExecutionPort } from './proxyArgumentExecution.ts'
import { prepareAgentRequestArguments } from './proxyArgumentPreparation.ts'
import { ProxyRequestError, ProxyRequestRegistry } from './proxyRequestRegistry.ts'
import { cancelProxyRequest, createProxyRequest, type ProxyActor, type StoredProxyRequest } from './proxyRequestState.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { UsageRegistry } from './usageRegistry.ts'

const at = 50_000
const tool: McpDiscoveredTool = {
  name: 'lookup', description: 'Find one record.',
  inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
}
const binding: AgentRequestArgumentDraftBinding = {
  agentRevision: 2, providerId: 'provider-test', providerRevision: 3, providerConnectionRevision: 4,
  model: 'model-test', connectionId: 'connection-test', connectionRevision: 5,
  toolName: tool.name, schemaHash: mcpToolSchemaHash(tool), transport: 'http',
}
const goodArgs: Record<string, McpJsonValue> = { key: 'record-7' }

function item(index: number, tenant = `tenant-${index}`, agent = `owner-agent-${index}`): StoredProxyRequest {
  return createProxyRequest({
    id: `agent-request-${index.toString(16).padStart(32, '0')}`,
    requester: { tenantId: `requester-tenant-${index}`, userId: `requester-${index}`, agentId: `requester-agent-${index}` },
    owner: { tenantId: tenant, userId: `owner-${index}`, agentId: agent },
    task: `Find record ${index}.`, createdAt: at,
  })
}
function ownerActor(row: StoredProxyRequest): ProxyActor {
  return { tenantId: row.intent.owner.tenantId, userId: row.intent.owner.userId }
}
function bindingFor(selected: McpDiscoveredTool = tool): AgentRequestArgumentDraftBinding {
  return { ...binding, toolName: selected.name, schemaHash: mcpToolSchemaHash(selected) }
}
function source(row: StoredProxyRequest, selected: McpDiscoveredTool = tool, budgets: (Budget | undefined)[] = []) {
  return {
    prepared: prepareAgentRequestArguments({ task: row.intent.task,
      agent: { id: row.intent.owner.agentId, label: 'Receiving Agent', systemPrompt: 'Use the selected tool.', instructions: '', tools: [] },
      tool: selected }),
    config: { model: 'model-test' }, budgets, tool: selected,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function harness(options: {
  generate?: ProxyArgumentExecutionPort['generate']
  source?: ProxyArgumentExecutionPort['source']
  ready?: () => boolean
  authenticated?: () => boolean
  otherWorkers?: () => ReturnType<ProxyArgumentExecutionPort['otherWorkers']>
  budgets?: (Budget | undefined)[]
  commit?: ProxyArgumentExecutionPort['commit']
  timeoutMs?: number
} = {}) {
  const registry = new ProxyRequestRegistry()
  const usage = new UsageRegistry(() => at + 1, () => 'usage-default')
  const events: string[] = []
  const errors: unknown[] = []
  const rowWaiters = new Map<string, Array<{ predicate: (row: StoredProxyRequest) => boolean; resolve: (row: StoredProxyRequest) => void }>>()
  const errorSignal = deferred<unknown>()
  const waitForRow = (id: string, predicate: (row: StoredProxyRequest) => boolean): Promise<StoredProxyRequest> => {
    const current = registry.get(id)
    if (current && predicate(current)) return Promise.resolve(current)
    return new Promise(resolve => {
      const waiters = rowWaiters.get(id) ?? []
      waiters.push({ predicate, resolve })
      rowWaiters.set(id, waiters)
    })
  }
  const changed = (id: string): void => {
    events.push(`changed:${id}`)
    const row = registry.get(id)
    if (!row) return
    const waiters = rowWaiters.get(id) ?? []
    const pending = waiters.filter(waiter => {
      if (!waiter.predicate(row)) return true
      waiter.resolve(row)
      return false
    })
    if (pending.length) rowWaiters.set(id, pending)
    else rowWaiters.delete(id)
  }
  const port: ProxyArgumentExecutionPort = {
    registry, usage, ready: options.ready ?? (() => true),
    source: options.source ?? ((row) => source(row, tool, options.budgets)),
    otherWorkers: options.otherWorkers ?? (() => []),
    generate: options.generate ?? (async (_prepared, _config, _signal, record) => {
      record({ inputTokens: 12, outputTokens: 5 })
      return { toolName: tool.name, arguments: { ...goodArgs } }
    }),
    commit: options.commit ?? (operation => { events.push('commit'); return operation() }),
    changed, now: () => at + 1,
    onError: error => { errors.push(error); errorSignal.resolve(error) },
  }
  return { registry, usage, events, errors, waitForRow, waitForError: errorSignal.promise,
    execution: new ProxyArgumentExecution(port, options.timeoutMs ?? 60_000), authenticated: options.authenticated ?? (() => true) }
}
const draftIs = (status: string) => (row: StoredProxyRequest): boolean => row.argumentDraft?.status === status
function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}
function start(h: ReturnType<typeof harness>, row: StoredProxyRequest, actor = ownerActor(row), authenticated = h.authenticated): void {
  h.registry.put(row)
  h.execution.start(row.intent.id, actor, { action: 'draft-arguments', expectedRevision: 1, binding: bindingFor() }, authenticated)
}

test('durable pending reservation commits before one tool-free model request', async () => {
  const gate = deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>()
  const row = item(1), seen: string[] = []
  const entered = deferred<void>()
  const h = harness({ generate: async (_input, _config, _signal, record) => {
    seen.push(`generate:${h.registry.get(row.intent.id)?.argumentDraft?.status}`)
    entered.resolve()
    record({ inputTokens: 12, outputTokens: 5 })
    return gate.promise
  } })
  start(h, row)
  assert.deepEqual(h.events, ['commit', `changed:${row.intent.id}`])
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft?.status, 'pending')
  assert.deepEqual(seen, [], 'the model must not run before the durable receipt and usage hold commit')
  assert.equal(h.usage.snapshotReservations()[0]?.id, `${row.intent.id}:arguments`)
  await entered.promise
  assert.deepEqual(seen, ['generate:pending'])
  gate.resolve({ toolName: tool.name, arguments: goodArgs })
  await h.waitForRow(row.intent.id, draftIs('done'))
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0, 'stop awaits physical worker cleanup')
  const final = h.registry.get(row.intent.id)!
  assert.equal(final.argumentDraft?.status, 'done')
  assert.deepEqual(final.argumentDraft?.arguments, goodArgs)
  assert.equal(final.status, 'waiting', 'a model suggestion is not MCP execution consent')
})

test('exact owner and current authorization are required; denied pre-dispatch leaves no footprint', () => {
  const row = item(2), actor = ownerActor(row), h = harness()
  h.registry.put(row)
  assert.throws(() => h.execution.start(row.intent.id, { ...actor, userId: 'same-tenant-outsider' },
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'unavailable')
  assert.throws(() => h.execution.start(row.intent.id, actor,
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => false),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'unavailable')
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft, undefined)
  assert.equal(h.usage.snapshotReservations().length, 0)
  assert.equal(h.execution.activeActors().length, 0)
})

test('selected tool name and admitted schema must match the frozen current source before reservation', () => {
  for (const change of ['name', 'schema'] as const) {
    const row = item(change === 'name' ? 201 : 202)
    const h = harness({ source: current => {
      const selected = source(current)
      if (change === 'name') selected.prepared = { ...selected.prepared, toolName: 'different-tool' }
      else selected.tool = { ...selected.tool, inputSchema: { type: 'object', properties: { other: { type: 'number' } } } }
      return selected
    }, generate: async () => { throw new Error('must not dispatch') } })
    h.registry.put(row)
    assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
      { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
    (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')
    assert.equal(h.registry.get(row.intent.id)?.argumentDraft, undefined)
    assert.equal(h.usage.snapshotReservations().length, 0)
    assert.equal(h.execution.activeActors().length, 0)
  }
})

test('one-shot attempt rejects replay and enforces global physical slots', async t => {
  const gates = [deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>(),
    deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>(),
    deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>(),
    deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>()]
  let calls = 0
  const allEntered = deferred<void>()
  const h = harness({ generate: async (_input, _config, _signal, record) => {
    const call = calls++
    if (calls === 4) allEntered.resolve()
    record({ inputTokens: 1, outputTokens: 1 })
    return gates[call]!.promise
  } })
  t.after(async () => {
    for (const gate of gates) gate.resolve({ toolName: tool.name, arguments: goodArgs })
    await h.execution.stop()
  })
  const rows = [item(3, 'tenant-a', 'agent-a'), item(4, 'tenant-b', 'agent-b'),
    item(5, 'tenant-c', 'agent-c'), item(6, 'tenant-d', 'agent-d')]
  for (const row of rows) start(h, row)
  await allEntered.promise
  assert.equal(h.execution.activeActors().length, 4)
  assert.throws(() => h.execution.start(rows[0]!.intent.id, ownerActor(rows[0]!),
    { action: 'draft-arguments', expectedRevision: 2, binding }, () => true), /Agent request conflict/)
  const fifth = item(8, 'tenant-e', 'agent-e')
  h.registry.put(fifth)
  assert.throws(() => h.execution.start(fifth.intent.id, ownerActor(fifth),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  for (const gate of gates) gate.resolve({ toolName: tool.name, arguments: goodArgs })
  await Promise.all(rows.map(row => h.waitForRow(row.intent.id, draftIs('done'))))
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0)
})

test('same Agent cannot hold two physical argument-draft workers while capacity remains', async t => {
  const gate = deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>()
  const entered = deferred<void>()
  const h = harness({ generate: async (_input, _config, _signal, record) => {
    entered.resolve(); record({ inputTokens: 1, outputTokens: 1 }); return gate.promise
  } })
  t.after(async () => {
    gate.resolve({ toolName: tool.name, arguments: goodArgs })
    await h.execution.stop()
  })
  const first = item(71, 'tenant-a', 'agent-a')
  start(h, first)
  await entered.promise
  assert.equal(h.execution.activeActors().length, 1)
  const duplicate = item(72, 'tenant-a', 'agent-a')
  h.registry.put(duplicate)
  assert.throws(() => h.execution.start(duplicate.intent.id, ownerActor(duplicate),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  assert.equal(h.execution.activeActors().length, 1, 'refusal leaves only the original physical worker')
  assert.equal(h.registry.get(duplicate.intent.id)?.argumentDraft, undefined)
  gate.resolve({ toolName: tool.name, arguments: goodArgs })
  await h.waitForRow(first.intent.id, draftIs('done'))
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0)
})

test('tenant worker cap applies below the global cap across other executors', () => {
  const h = harness({ otherWorkers: () => [
    { tenantId: 'tenant-a', userId: 'external-a', agentId: 'other-a' },
    { tenantId: 'tenant-a', userId: 'external-b', agentId: 'other-b' },
  ] })
  const row = item(9, 'tenant-a', 'agent-a')
  h.registry.put(row)
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit',
  'two existing same-tenant workers plus this draft reaches the tenant cap before the four-worker host cap')
  assert.equal(h.execution.activeActors().length, 0)
})

test('host-wide worker cap includes other executors without masking the tenant cap', () => {
  const h = harness({ otherWorkers: () => [
    { tenantId: 'external-a', userId: 'a', agentId: 'a' },
    { tenantId: 'external-b', userId: 'b', agentId: 'b' },
    { tenantId: 'external-c', userId: 'c', agentId: 'c' },
    { tenantId: 'external-d', userId: 'd', agentId: 'd' },
  ] })
  const row = item(91, 'tenant-a', 'agent-a')
  h.registry.put(row)
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  assert.equal(h.execution.activeActors().length, 0)
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft, undefined)
})

test('cancellation aborts the signal but retains the physical slot until ignored-abort work settles', async () => {
  const gate = deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>()
  let signal: AbortSignal | undefined
  const entered = deferred<void>()
  const h = harness({ generate: async (_input, _config, abort, record) => {
    signal = abort; entered.resolve(); record({ inputTokens: 8, outputTokens: 3 }); return gate.promise
  } })
  const row = item(10, 'tenant-a', 'agent-a')
  start(h, row)
  await entered.promise
  h.registry.put(cancelProxyRequest(h.registry.get(row.intent.id)!, ownerActor(row), 2, at + 2))
  h.execution.cancel(row.intent.id)
  assert.equal(signal?.aborted, true)
  assert.equal(h.execution.activeActors().length, 1)
  const second = item(11, 'tenant-a', 'agent-b')
  h.registry.put(second)
  h.execution.start(second.intent.id, ownerActor(second), { action: 'draft-arguments', expectedRevision: 1, binding }, () => true)
  assert.equal(h.execution.activeActors().length, 2)
  const third = item(111, 'tenant-a', 'agent-c')
  h.registry.put(third)
  assert.throws(() => h.execution.start(third.intent.id, ownerActor(third),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  gate.resolve({ toolName: tool.name, arguments: goodArgs })
  await Promise.all([h.waitForRow(row.intent.id, draftIs('failed')), h.waitForRow(second.intent.id, draftIs('done'))])
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0, 'both physical promises have completed')
  assert.equal(h.registry.get(row.intent.id)?.status, 'cancelled')
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft?.status, 'failed', 'cancellation prevents a late result becoming a usable suggestion')
  assert.equal(h.usage.readForTenant('tenant-a').snapshot().weekly.consumed, 22)
})

test('timeout aborts but holds capacity; a result without reported usage is never saved as a draft', async () => {
  const gate = deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>()
  let signal: AbortSignal | undefined
  const entered = deferred<AbortSignal>()
  const h = harness({ timeoutMs: 5, generate: async (_input, _config, abort) => { signal = abort; entered.resolve(abort); return gate.promise } })
  const row = item(12)
  start(h, row)
  await entered.promise
  await aborted(signal!)
  assert.equal(h.execution.activeActors().length, 1, 'timeout is not proof the provider stopped')
  gate.resolve({ toolName: tool.name, arguments: goodArgs })
  await h.waitForRow(row.intent.id, draftIs('uncertain'))
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0, 'stop observes timeout-call physical completion')
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft?.status, 'uncertain')
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft && 'arguments' in h.registry.get(row.intent.id)!.argumentDraft!, false)
  const reservation = h.usage.snapshotReservations()[0]
  assert.equal(reservation?.status, 'uncertain', 'unknown provider usage retains its bounded hold')
})

test('live source changes before dispatch or after provider wait prevent a usable draft', async () => {
  const before = item(13)
  let calls = 0, allowed = true
  const pre = harness({ authenticated: () => allowed,
    generate: async () => { calls++; return { toolName: tool.name, arguments: goodArgs } } })
  pre.registry.put(before)
  pre.execution.start(before.intent.id, ownerActor(before),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => allowed)
  allowed = false
  await pre.waitForRow(before.intent.id, draftIs('failed'))
  await pre.execution.stop()
  assert.equal(pre.execution.activeActors().length, 0)
  assert.equal(calls, 0)
  assert.deepEqual(pre.usage.snapshotReservations()[0]?.report, { inputTokens: 0, outputTokens: 0 })
  assert.equal(pre.registry.get(before.intent.id)?.argumentDraft?.status, 'failed')

  const gate = deferred<{ toolName: string; arguments: Record<string, McpJsonValue> }>()
  let sourceChanged = false
  let records = 0
  const entered = deferred<void>()
  const after = item(14)
  const h = harness({ source: row => source(row, sourceChanged ? { ...tool, description: 'changed after provider wait' } : tool),
    generate: async (_input, _config, _signal, record) => { records++; entered.resolve(); record({ inputTokens: 3, outputTokens: 2 }); return gate.promise } })
  start(h, after)
  await entered.promise
  assert.equal(records, 1)
  sourceChanged = true
  gate.resolve({ toolName: tool.name, arguments: goodArgs })
  await h.waitForRow(after.intent.id, draftIs('failed'))
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0)
  assert.equal(h.registry.get(after.intent.id)?.argumentDraft?.status, 'failed')
  assert.equal(h.registry.get(after.intent.id)?.argumentDraft && 'arguments' in h.registry.get(after.intent.id)!.argumentDraft!, false)
})

test('transport failure, invalid usage, bad tool choice, and schema-invalid arguments never become suggestions', async t => {
  const cases: Array<{ name: string; generate: ProxyArgumentExecutionPort['generate']; expected: string }> = [
    { name: 'transport failure', generate: async () => { throw new Error('connection lost') }, expected: 'uncertain' },
    { name: 'invalid usage', generate: async (_input, _config, _signal, record) => {
      record({ inputTokens: -1, outputTokens: 2 }); return { toolName: tool.name, arguments: goodArgs }
    }, expected: 'uncertain' },
    { name: 'wrong tool name', generate: async (_input, _config, _signal, record) => {
      record({ inputTokens: 1, outputTokens: 1 }); return { toolName: 'other-tool', arguments: goodArgs }
    }, expected: 'failed' },
    { name: 'schema-invalid args', generate: async (_input, _config, _signal, record) => {
      record({ inputTokens: 1, outputTokens: 1 }); return { toolName: tool.name, arguments: { key: 17 } }
    }, expected: 'failed' },
  ]
  for (const entry of cases) await t.test(entry.name, async () => {
    const h = harness({ generate: entry.generate })
    const row = item(20 + cases.indexOf(entry))
    start(h, row)
    await h.waitForRow(row.intent.id, draftIs(entry.expected))
    await h.execution.stop()
    assert.equal(h.execution.activeActors().length, 0)
    const draft = h.registry.get(row.intent.id)?.argumentDraft
    assert.equal(draft?.status, entry.expected)
    assert.equal(draft && 'arguments' in draft, false)
  })
})

test('usage recorder failure leaves the committed draft pending for restart recovery', async () => {
  const h = harness({ generate: async () => { throw new UsageRecordingError() } })
  const row = item(30)
  start(h, row)
  await h.waitForError
  await h.execution.stop()
  assert.equal(h.execution.activeActors().length, 0)
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft?.status, 'pending')
  assert.equal(h.usage.snapshotReservations()[0]?.status, 'active')
})

test('budget refusal is atomic: no pending receipt, reservation, or worker', () => {
  const row = item(31)
  const h = harness({ budgets: [{ windows: [{ label: '5-hour limit', ceiling: 1 }, { label: 'Weekly · all models', ceiling: 1 }] }] })
  h.registry.put(row)
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-arguments', expectedRevision: 1, binding }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  assert.equal(h.registry.get(row.intent.id)?.argumentDraft, undefined)
  assert.equal(h.usage.snapshotReservations().length, 0)
  assert.equal(h.execution.activeActors().length, 0)
})
