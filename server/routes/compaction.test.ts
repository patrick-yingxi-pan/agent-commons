/** HTTP contract for model-backed conversation compaction: selected-provider
 * generation, bounded archive recovery, tenant walls, metering, and fail-closed
 * history preservation. */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { Message, Page } from '../../contract/index.ts'
import { startModelServer } from '../model/index.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { turns } from '../turns.ts'

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

test('POST compact generates a substantive brief, meters it, and exposes the untouched archive in bounded pages', async () => {
  const tenantId = `tenant-compaction-route-${Date.now()}`
  const session = longSession(tenantId, 'route-backed summary')
  const headers = { 'x-tenant-id': tenantId }
  const before = store.usage(undefined, tenantId).limits[0].pct

  const response = await call('POST', `/sessions/${session.id}/compact`, {}, headers)
  assert.equal(response.status, 200)
  assert.equal(response.json.compactedMessages, undefined, 'the mutation response never echoes the archive')
  assert.equal(response.json.messages.length, 5)
  assert.match(response.json.messages[0].content, /Firefly/, 'the brief derives from earlier source')
  assert.equal(response.json.messages[0].compactedFrom, 5)
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
  const response = await call('POST', `/sessions/${session.id}/compact`, {}, { 'x-tenant-id': tenantId })
  assert.equal(response.status, 200)
  assert.equal(response.json.messages.length, 1)
  assert.equal(response.json.messages[0].compactedFrom, undefined)

  const invalid = await call('GET', `/sessions/${session.id}/compacted-messages?limit=0`, undefined, {
    'x-tenant-id': tenantId,
  })
  assert.equal(invalid.status, 400)
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
