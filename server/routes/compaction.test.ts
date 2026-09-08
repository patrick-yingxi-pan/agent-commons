/** HTTP contract for model-backed conversation compaction: selected-provider
 * generation, bounded archive recovery, tenant walls, metering, and fail-closed
 * history preservation. */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { Message, Page } from '../../contract/index.ts'
import { startModelServer } from '../model/index.ts'
import { sessionCompactionId } from '../sessionCompactionIdentity.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { turns } from '../turns.ts'
import { PersistenceWriteError } from '../persistence/persist.ts'

let model: Server
let modelBase = ''

before(async () => {
  model = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => model.on('listening', resolve))
  const address = model.address()
  const port = typeof address === 'object' && address ? address.port : 0
  modelBase = `http://127.0.0.1:${port}`
  process.env.ANTHROPIC_BASE_URL = modelBase
})

after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  model.closeAllConnections?.()
  model.close()
})

function longSession(tenantId: string, label: string) {
  const session = store.createSession(label, tenantId)
  for (let i = 0; i < 9; i += 1) {
    const role = i % 2 ? 'assistant' : 'user'
    store.appendMessage(session.id, {
      id: store.mintMessageId(role),
      role,
      content: `${i === 0 ? 'Decision Firefly: ship a direct signed and notarized download. ' : ''}${label} turn ${i}. ${'durable context '.repeat(1_200)}`,
    })
  }
  return session
}

for (const mode of ['later-refusal', 'empty-response', 'success'] as const) {
  test(`compaction meters each completed response exactly once: ${mode}`, async () => {
    const tenantId = `tenant-usage-${mode}`
    const session = longSession(tenantId, mode)
    const originalMessages = structuredClone(session.messages)
    const reports: Array<[number, number, string | undefined]> = []
    const recordUsage = store.recordUsage
    let requests = 0
    let recordedBeforeNextRequest = false
    const endpoint = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume the complete request */ }
      requests += 1
      if (requests === 2) recordedBeforeNextRequest = reports.length === 1
      if (mode === 'later-refusal' && requests > 1) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fixture refusal' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: `usage-summary-${requests}`, type: 'message', role: 'assistant', model: 'fixture',
        content: [{ type: 'text', text: mode === 'empty-response' ? '' : 'Preserve the reviewed decisions.' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 30 },
      }))
    })
    await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(endpoint.address() as { port: number }).port}`
    store.recordUsage = (input, output, tenant) => {
      reports.push([input, output, tenant])
      recordUsage.call(store, input, output, tenant)
    }
    try {
      const result = await call('POST', `/sessions/${session.id}/compact`, {}, { 'x-tenant-id': tenantId })
      assert.equal(result.status, mode === 'success' ? 200 : 409)
      assert.equal(reports.length, mode === 'success' ? requests : 1)
      for (const report of reports) assert.deepEqual(report, [120, 30, tenantId])
      if (mode !== 'empty-response') assert.equal(recordedBeforeNextRequest, true, 'no later model call precedes recording')
      if (mode !== 'success') {
        assert.deepEqual(store.getSession(session.id)!.messages, originalMessages)
        assert.equal(store.getSession(session.id)!.compactedMessages, undefined)
      }
    } finally {
      store.recordUsage = recordUsage
      process.env.ANTHROPIC_BASE_URL = modelBase
      endpoint.closeAllConnections()
      await new Promise<void>((resolve) => endpoint.close(() => resolve()))
    }
  })
}

test('compaction preserves storage-unavailable classification when usage recording fails', async () => {
  const tenantId = 'tenant-compaction-usage-storage'
  const session = longSession(tenantId, 'storage failure')
  const original = structuredClone(session.messages)
  const recordUsage = store.recordUsage
  let reports = 0
  store.recordUsage = () => { reports += 1; throw new PersistenceWriteError(new Error('private-disk-path')) }
  try {
    const result = await call('POST', `/sessions/${session.id}/compact`, {}, { 'x-tenant-id': tenantId })
    assert.equal(result.status, 503)
    assert.equal(result.json.error.code, 'storage_unavailable')
    assert.doesNotMatch(JSON.stringify(result.json), /private-disk-path/)
    assert.equal(reports, 1, 'the failed accounting path cannot start a second summary pass')
    assert.deepEqual(store.getSession(session.id)!.messages, original)
  } finally {
    store.recordUsage = recordUsage
  }
})

test('POST compact generates a substantive brief, meters it, and exposes the untouched archive in bounded pages', async () => {
  const tenantId = `tenant-compaction-route-${Date.now()}`
  const session = longSession(tenantId, 'route-backed summary')
  const headers = { 'x-tenant-id': tenantId }
  const idempotencyKey = `compact-${session.id}`
  const before = store.usage(undefined, tenantId).limits[0].pct

  const response = await call('POST', `/sessions/${session.id}/compact`, {}, {
    ...headers,
    'idempotency-key': idempotencyKey,
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.compactedMessages, undefined, 'the mutation response never echoes the archive')
  assert.equal(response.json.messages.length, 5)
  assert.match(response.json.messages[0].content, /Firefly/, 'the brief derives from earlier source')
  assert.equal(response.json.messages[0].compactedFrom, 5)
  assert.deepEqual(
    response.json.compactionReceiptIds,
    [sessionCompactionId(tenantId, session.id, idempotencyKey)],
    'the acknowledged model act carries its exact durable receipt',
  )
  assert.ok(store.usage(undefined, tenantId).limits[0].pct > before, 'summary tokens count against the tenant plan')

  const first = await call('GET', `/sessions/${session.id}/compacted-messages?limit=2`, undefined, headers)
  assert.equal(first.status, 200)
  const firstPage = first.json as Page<Message>
  assert.equal(firstPage.items.length, 2)
  assert.ok(firstPage.nextCursor)
  assert.match(firstPage.items[0].content, /Firefly/)

  const next = await call(
    'GET',
    `/sessions/${session.id}/compacted-messages?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    undefined,
    headers,
  )
  assert.equal(next.status, 200)
  assert.equal((next.json as Page<Message>).items.length, 2)
  assert.notEqual(next.json.items[0].id, firstPage.items[0].id, 'the keyed continuation advances')

  const foreign = await call('GET', `/sessions/${session.id}/compacted-messages?limit=2`, undefined, {
    'x-tenant-id': `${tenantId}-foreign`,
  })
  assert.equal(foreign.status, 404, 'archive existence is tenant-hidden')
})

test('an unavailable summary provider changes no active or archived history', async () => {
  const tenantId = `tenant-compaction-failure-${Date.now()}`
  const session = longSession(tenantId, 'failure remains intact')
  const before = structuredClone(store.getSession(session.id))
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
  process.env.MODEL_TIMEOUT_MS = '500'
  try {
    const response = await call('POST', `/sessions/${session.id}/compact`, {}, { 'x-tenant-id': tenantId })
    assert.equal(response.status, 409)
    assert.equal(response.json.error.code, 'capability_unavailable')
    const afterFailure = store.getSession(session.id)!
    assert.deepEqual(afterFailure.messages, before?.messages)
    assert.equal(afterFailure.compactedMessages, undefined)
  } finally {
    process.env.ANTHROPIC_BASE_URL = modelBase
    delete process.env.MODEL_TIMEOUT_MS
  }
})

test('short-session compaction is a free no-op and archive pagination validates its bound', async () => {
  const tenantId = `tenant-compaction-noop-${Date.now()}`
  const session = store.createSession('short no-op', tenantId)
  store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: 'hi' })
  const idempotencyKey = `compact-short-${session.id}`
  const response = await call('POST', `/sessions/${session.id}/compact`, {}, {
    'x-tenant-id': tenantId,
    'idempotency-key': idempotencyKey,
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.messages.length, 1)
  assert.equal(response.json.messages[0].compactedFrom, undefined)
  assert.deepEqual(response.json.compactionReceiptIds, [sessionCompactionId(tenantId, session.id, idempotencyKey)])

  const invalid = await call('GET', `/sessions/${session.id}/compacted-messages?limit=0`, undefined, {
    'x-tenant-id': tenantId,
  })
  assert.equal(invalid.status, 400)
})

test('a shared reader cannot spend the owner budget or rewrite the owner transcript', async () => {
  const session = longSession(store.defaultTenantId(), 'owner-only compaction')
  const grant = store.createGrant({
    subject: { kind: 'session', id: session.id },
    audience: { kind: 'org', orgId: 'tenant-beta' },
    tier: 'co-own',
  }, store.defaultTenantId())
  assert.equal(typeof grant, 'object', 'precondition: the other tenant can read this conversation')
  const before = structuredClone(store.getSession(session.id))
  const refused = await call('POST', `/sessions/${session.id}/compact`, {}, {
    'x-user-id': 'user-grace',
    'x-tenant-id': 'tenant-beta',
    'idempotency-key': `shared-reader-${session.id}`,
  })
  assert.equal(refused.status, 403)
  assert.deepEqual(store.getSession(session.id)?.messages, before?.messages)
  assert.equal(store.getSession(session.id)?.compactionReceiptIds, undefined)
})

test('a live reply excludes compaction before provider work or history mutation', async () => {
  const tenantId = `tenant-compaction-live-${Date.now()}`
  const session = longSession(tenantId, 'live turn wins')
  const before = structuredClone(store.getSession(session.id))
  const live = turns.start(session.id, () => {})
  assert.ok(live)
  try {
    const response = await call('POST', `/sessions/${session.id}/compact`, {}, { 'x-tenant-id': tenantId })
    assert.equal(response.status, 409)
    assert.match(response.json.error.message, /current reply/i)
    const afterRefusal = store.getSession(session.id)!
    assert.deepEqual(afterRefusal.messages, before?.messages)
    assert.equal(afterRefusal.compactedMessages, undefined)
  } finally {
    turns.finish(live.id)
  }
})

test('an in-flight summary excludes deletion, and the retained key succeeds after it settles', async () => {
  const tenantId = `tenant-compaction-delete-${Date.now()}`
  const session = longSession(tenantId, 'summary before deletion')
  let signalStarted!: () => void
  let releaseSummary!: () => void
  let modelRequests = 0
  const started = new Promise<void>((resolve) => { signalStarted = resolve })
  const released = new Promise<void>((resolve) => { releaseSummary = resolve })
  const gatedModel = createServer(async (req, res) => {
    modelRequests += 1
    for await (const _chunk of req) { /* consume the complete request */ }
    signalStarted()
    await released
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      id: 'msg_gated_compaction',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: 'A durable summary prepared before deletion.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 9 },
    }))
  })
  await new Promise<void>((resolve) => gatedModel.listen(0, '127.0.0.1', resolve))
  const address = gatedModel.address()
  const port = typeof address === 'object' && address ? address.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  const deleteHeaders = {
    'x-tenant-id': tenantId,
    'idempotency-key': `session-delete-summary-${session.id}`,
  }
  const compactionKey = `session-compaction-summary-${session.id}`
  const compactionHeaders = { 'x-tenant-id': tenantId, 'idempotency-key': compactionKey }
  try {
    const compacting = call('POST', `/sessions/${session.id}/compact`, {}, compactionHeaders)
    await started
    const joined = call('POST', `/sessions/${session.id}/compact`, {}, compactionHeaders)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(modelRequests, 1, 'same-key concurrent requests share one model operation')
    const refused = await call('DELETE', `/sessions/${session.id}`, { expectedRevision: 0 }, deleteHeaders)
    assert.equal(refused.status, 409)
    assert.match(refused.json.error.message, /summary to finish/i)
    assert.ok(store.getSession(session.id), 'the summarizing conversation remains authoritative')
    releaseSummary()
    assert.equal((await compacting).status, 200)
    assert.equal((await joined).status, 200)
    const requestsAfterCompaction = modelRequests
    assert.ok(requestsAfterCompaction > 0, 'the bounded reduction exercised the model')

    const replayed = await callFresh('POST', `/sessions/${session.id}/compact`, {}, compactionHeaders)
    assert.equal(replayed.status, 200, 'durable replay survives a fresh route cache')
    assert.equal(modelRequests, requestsAfterCompaction, 'restart-style replay performs no second model request')
    assert.deepEqual(
      replayed.json.compactionReceiptIds,
      [sessionCompactionId(tenantId, session.id, compactionKey)],
    )

    const removed = await call('DELETE', `/sessions/${session.id}`, { expectedRevision: 0 }, deleteHeaders)
    assert.equal(removed.status, 200, 'the busy refusal is not cached under the retained retry key')
    assert.equal(store.getSession(session.id), undefined)
  } finally {
    releaseSummary()
    process.env.ANTHROPIC_BASE_URL = modelBase
    gatedModel.closeAllConnections?.()
    await new Promise<void>((resolve) => gatedModel.close(() => resolve()))
  }
})
