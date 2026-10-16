import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentRequestReplyDraftBinding } from '../contract/agentRequests.ts'
import type { Budget } from '../contract/budget.ts'
import { UsageRecordingError } from './modelUsage.ts'
import { prepareAgentRequestReply } from './proxyReplyPreparation.ts'
import { ProxyReplyExecution, type ProxyReplyExecutionPort } from './proxyReplyExecution.ts'
import { ProxyRequestError, ProxyRequestRegistry } from './proxyRequestRegistry.ts'
import { beginProxyRequest, cancelProxyRequest, createProxyRequest, settleProxyRequest,
  type ProxyActor, type StoredProxyRequest } from './proxyRequestState.ts'
import { UsageRegistry } from './usageRegistry.ts'

const at = 50_000
const binding: AgentRequestReplyDraftBinding = {
  agentRevision: 2, providerId: 'provider-test', providerRevision: 3,
  providerConnectionRevision: 4, model: 'model-test',
}
const replyText = 'I can help with that. Please send the invoice number.'

function item(index: number, tenant = `tenant-${index}`, agent = `owner-agent-${index}`): StoredProxyRequest {
  return createProxyRequest({
    id: `agent-request-${index.toString(16).padStart(32, '0')}`,
    requester: { tenantId: `requester-tenant-${index}`, userId: `requester-${index}`, agentId: `requester-agent-${index}` },
    owner: { tenantId: tenant, userId: `owner-${index}`, agentId: agent },
    task: `Please respond to request ${index}.`, createdAt: at,
  })
}
function ownerActor(row: StoredProxyRequest): ProxyActor {
  return { tenantId: row.intent.owner.tenantId, userId: row.intent.owner.userId }
}
function source(row: StoredProxyRequest, notes: string, budgets: (Budget | undefined)[] = []) {
  return {
    prepared: prepareAgentRequestReply({ task: row.intent.task,
      agent: { id: row.intent.owner.agentId, label: 'Receiving Agent', systemPrompt: 'Be concise.', instructions: 'Answer the task.' },
      notes }),
    config: { model: binding.model }, budgets,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function harness(options: {
  generate?: ProxyReplyExecutionPort['generate']
  source?: ProxyReplyExecutionPort['source']
  ready?: () => boolean
  authenticated?: () => boolean
  otherWorkers?: () => ReturnType<ProxyReplyExecutionPort['otherWorkers']>
  budgets?: (Budget | undefined)[]
  commit?: ProxyReplyExecutionPort['commit']
  timeoutMs?: number
} = {}) {
  const registry = new ProxyRequestRegistry()
  const usage = new UsageRegistry(() => at + 1, () => 'usage-default')
  const events: string[] = []
  const errors: unknown[] = []
  const waiters = new Map<string, Array<{ predicate: (row: StoredProxyRequest) => boolean; resolve: (row: StoredProxyRequest) => void }>>()
  const errorSignal = deferred<unknown>()
  const waitForRow = (id: string, predicate: (row: StoredProxyRequest) => boolean): Promise<StoredProxyRequest> => {
    const current = registry.get(id)
    if (current && predicate(current)) return Promise.resolve(current)
    return new Promise(resolve => {
      const list = waiters.get(id) ?? []
      list.push({ predicate, resolve }); waiters.set(id, list)
    })
  }
  const changed = (id: string): void => {
    events.push(`changed:${id}`)
    const row = registry.get(id)
    if (!row) return
    const pending = (waiters.get(id) ?? []).filter(waiter => {
      if (!waiter.predicate(row)) return true
      waiter.resolve(row); return false
    })
    if (pending.length) waiters.set(id, pending); else waiters.delete(id)
  }
  const port: ProxyReplyExecutionPort = {
    registry, usage, ready: options.ready ?? (() => true),
    source: options.source ?? ((row, _binding, notes) => source(row, notes, options.budgets)),
    otherWorkers: options.otherWorkers ?? (() => []),
    generate: options.generate ?? (async (_prepared, _config, _signal, record) => {
      record({ inputTokens: 12, outputTokens: 7 })
      return replyText
    }),
    commit: options.commit ?? (operation => { events.push('commit'); return operation() }),
    changed, now: () => at + 1, onError: error => { errors.push(error); errorSignal.resolve(error) },
  }
  return { registry, usage, events, errors, waitForRow, waitForError: errorSignal.promise,
    execution: new ProxyReplyExecution(port, options.timeoutMs ?? 60_000), authenticated: options.authenticated ?? (() => true) }
}
const draftIs = (status: string) => (row: StoredProxyRequest): boolean => row.replyDraft?.status === status
function start(h: ReturnType<typeof harness>, row: StoredProxyRequest, actor = ownerActor(row), notes = 'Ask for the missing invoice number.', authenticated = h.authenticated): void {
  h.registry.put(row)
  const value = { action: 'draft-reply', expectedRevision: row.revision, binding, notes }
  h.execution.start(row.intent.id, actor, value, authenticated)
}

test('durable pending reservation commits before one tool-free request; only reviewed text is retained', async () => {
  const gate = deferred<string>(), entered = deferred<void>()
  const row = item(1), h = harness({ source: (current, _binding, notes) => source(current, notes),
    generate: async (prepared, _config, _signal, record) => {
      assert.equal(h.registry.get(row.intent.id)?.replyDraft?.status, 'pending')
      assert.match(prepared.prompt, /Ask for the missing invoice number/)
      assert.equal(prepared.prompt.includes('PRIVATE TOOL RESULT'), false)
      entered.resolve(); record({ inputTokens: 12, outputTokens: 7 }); return gate.promise
    } })
  start(h, row)
  assert.deepEqual(h.events, ['commit', `changed:${row.intent.id}`])
  assert.equal(h.registry.get(row.intent.id)?.replyDraft?.status, 'pending')
  assert.equal(h.usage.snapshotReservations()[0]?.id, `${row.intent.id}:reply`)
  await entered.promise
  gate.resolve(replyText)
  const final = await h.waitForRow(row.intent.id, draftIs('done'))
  await h.execution.stop()
  assert.equal(final.status, 'waiting')
  assert.equal(final.replyDraft?.status, 'done')
  assert.equal(final.replyDraft?.text, replyText)
  assert.equal(JSON.stringify(final.replyDraft).includes('Ask for the missing invoice number'), false, 'owner notes are input-only')
  assert.equal(final.reply, undefined, 'a suggestion never becomes the shared reply')
  assert.equal(h.usage.readForTenant(ownerActor(row).tenantId).snapshot().weekly.consumed, 19)
})

test('waiting and awaiting-reply are eligible, while exact party and live authorization remain required', async () => {
  const waiting = item(2), base = item(3)
  for (const index of [0, 1]) {
    const h = harness()
    const original = index === 0 ? waiting : base
    h.registry.put(original)
    let row = original
    if (index === 1) {
      const pending = beginProxyRequest(row, ownerActor(row), row.revision, { transport: 'http', call: {
        connectionId: 'mcp-connection-test', connectionRevision: 1, toolName: 'lookup', schemaHash: 'a'.repeat(64), arguments: {},
      } }, at + 1)
      h.registry.put(pending)
      row = settleProxyRequest(pending, pending.execution!.callHash, { status: 'done', summary: 'Tool completed.', result: {
        resultType: 'complete', content: [{ type: 'text', text: 'PRIVATE TOOL RESULT' }], isError: false,
      } }, at + 2)
      h.registry.put(row)
    }
    h.execution.start(row.intent.id, ownerActor(row),
      { action: 'draft-reply', expectedRevision: row.revision, binding, notes: 'owner note' }, () => true)
    await h.waitForRow(row.intent.id, draftIs('done'))
    await h.execution.stop()
    assert.equal(h.registry.get(row.intent.id)?.replyDraft?.text, replyText)
    assert.equal(h.registry.get(row.intent.id)?.status, row.status)
  }

  const row = item(4), h = harness()
  h.registry.put(row)
  assert.throws(() => h.execution.start(row.intent.id, { ...ownerActor(row), userId: 'same-tenant-outsider' },
    { action: 'draft-reply', expectedRevision: 1, binding, notes: '' }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'unavailable')
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-reply', expectedRevision: 1, binding, notes: '' }, () => false),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'unavailable')
  assert.equal(h.registry.get(row.intent.id)?.replyDraft, undefined)
  assert.equal(h.usage.snapshotReservations().length, 0)
})

test('pending tool work, malformed envelopes, stale source and replay are refused without a second call', async () => {
  const row = item(5), h = harness()
  const running = beginProxyRequest(row, ownerActor(row), 1, { transport: 'http', call: {
    connectionId: 'mcp-connection-test', connectionRevision: 1, toolName: 'lookup', schemaHash: 'a'.repeat(64), arguments: {},
  } }, at + 1)
  h.registry.put(row)
  h.registry.put(running)
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-reply', expectedRevision: running.revision, binding, notes: '' }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-reply', expectedRevision: running.revision, binding, notes: '', extra: true }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'invalid')
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-reply', expectedRevision: running.revision, binding, notes: '\\'.repeat(8_193) }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'invalid')
  assert.equal(h.usage.snapshotReservations().length, 0)

  const waiting = item(6)
  let changed = false, calls = 0
  const stale = harness({ source: current => ({ ...source(current, ''), config: { model: changed ? 'other-model' : binding.model } }),
    generate: async (_prepared, _config, _signal, record) => { calls++; record({ inputTokens: 1, outputTokens: 1 }); return replyText } })
  stale.registry.put(waiting)
  stale.execution.start(waiting.intent.id, ownerActor(waiting),
    { action: 'draft-reply', expectedRevision: 1, binding, notes: '' }, () => true)
  changed = true
  await stale.waitForRow(waiting.intent.id, draftIs('failed'))
  await stale.execution.stop()
  assert.equal(calls, 0)
  assert.equal(stale.registry.get(waiting.intent.id)?.replyDraft?.status, 'failed')
  assert.throws(() => stale.execution.start(waiting.intent.id, ownerActor(waiting),
    { action: 'draft-reply', expectedRevision: 2, binding, notes: '' }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'conflict')
})

test('maximum-size escaped notes survive request snapshotting without widening the notes bound', async () => {
  const h = harness({ source: (row, _binding, notes) => source(row, notes) })
  const row = item(22)
  start(h, row, ownerActor(row), '\\'.repeat(8_192))
  await h.waitForRow(row.intent.id, draftIs('done'))
  await h.execution.stop()
  assert.equal(h.registry.get(row.intent.id)?.replyDraft?.status, 'done')

  const oversized = item(23)
  h.registry.put(oversized)
  assert.throws(() => h.execution.start(oversized.intent.id, ownerActor(oversized),
    { action: 'draft-reply', expectedRevision: oversized.revision, binding, notes: '\\'.repeat(8_193) }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'invalid')
  assert.equal(h.registry.get(oversized.intent.id)?.replyDraft, undefined)
  assert.equal(h.usage.snapshotReservations().length, 1, 'the refused item adds no reservation')
})

test('cancellation prevents late prose becoming usable; active physical capacity and usage remain accounted', async () => {
  const gate = deferred<string>(), entered = deferred<void>()
  const row = item(7, 'tenant-a', 'agent-a'), h = harness({ generate: async (_prepared, _config, _signal, record) => {
    entered.resolve(); record({ inputTokens: 8, outputTokens: 4 }); return gate.promise
  } })
  start(h, row)
  await entered.promise
  h.registry.put(cancelProxyRequest(h.registry.get(row.intent.id)!, ownerActor(row), 2, at + 2))
  h.execution.cancel(row.intent.id)
  const second = item(8, 'tenant-a', 'agent-b')
  start(h, second)
  assert.equal(h.execution.activeActors().length, 2)
  const third = item(9, 'tenant-a', 'agent-c')
  h.registry.put(third)
  assert.throws(() => h.execution.start(third.intent.id, ownerActor(third),
    { action: 'draft-reply', expectedRevision: 1, binding, notes: '' }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  gate.resolve(replyText)
  await Promise.all([h.waitForRow(row.intent.id, draftIs('failed')), h.waitForRow(second.intent.id, draftIs('done'))])
  await h.execution.stop()
  assert.equal(h.registry.get(row.intent.id)?.status, 'cancelled')
  assert.equal(h.registry.get(row.intent.id)?.replyDraft?.status, 'failed')
  assert.equal(h.registry.get(row.intent.id)?.replyDraft && 'text' in h.registry.get(row.intent.id)!.replyDraft!, false)
})

test('invalid output is failed; ambiguous transport or usage remains uncertain', async t => {
  const cases: Array<{ name: string; generate: ProxyReplyExecutionPort['generate']; expected: string }> = [
    { name: 'invalid reply text', generate: async (_input, _config, _signal, record) => {
      record({ inputTokens: 1, outputTokens: 1 }); return '   '
    }, expected: 'failed' },
    { name: 'transport failure', generate: async () => { throw new Error('connection lost') }, expected: 'uncertain' },
    { name: 'invalid usage', generate: async (_input, _config, _signal, record) => {
      record({ inputTokens: -1, outputTokens: 1 }); return replyText
    }, expected: 'uncertain' },
  ]
  for (const entry of cases) await t.test(entry.name, async () => {
    const h = harness({ generate: entry.generate }), row = item(10 + cases.indexOf(entry))
    start(h, row)
    await h.waitForRow(row.intent.id, draftIs(entry.expected))
    await h.execution.stop()
    assert.equal(h.registry.get(row.intent.id)?.replyDraft?.status, entry.expected)
    assert.equal(h.registry.get(row.intent.id)?.replyDraft && 'text' in h.registry.get(row.intent.id)!.replyDraft!, false)
  })
})

test('usage recorder failure leaves durable pending work for restart recovery', async () => {
  const h = harness({ generate: async () => { throw new UsageRecordingError() } }), row = item(20)
  start(h, row)
  await h.waitForError
  await h.execution.stop()
  assert.equal(h.registry.get(row.intent.id)?.replyDraft?.status, 'pending')
  assert.equal(h.usage.snapshotReservations()[0]?.status, 'active')
})

test('budget refusal does not commit a receipt or hold', () => {
  const row = item(21), h = harness({ budgets: [{ windows: [
    { label: '5-hour limit', ceiling: 1 }, { label: 'Weekly · all models', ceiling: 1 },
  ] }] })
  h.registry.put(row)
  assert.throws(() => h.execution.start(row.intent.id, ownerActor(row),
    { action: 'draft-reply', expectedRevision: 1, binding, notes: '' }, () => true),
  (error: unknown) => error instanceof ProxyRequestError && error.code === 'limit')
  assert.equal(h.registry.get(row.intent.id)?.replyDraft, undefined)
  assert.equal(h.usage.snapshotReservations().length, 0)
  assert.equal(h.execution.activeActors().length, 0)
})
