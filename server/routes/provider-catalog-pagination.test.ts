/** Real route/model seams against an authored loopback Messages peer only. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { call, callRaw } from '../testkit/http.ts'

let sequence = 0
const models = [{ id: 'catalog-A', label: 'Model A' }, { id: 'catalog-B', label: 'Model B' }]
const privateError = 'PRIVATE_PAGINATED_CATALOG_DIAGNOSTIC'

async function fixture() {
  const listRequests: URL[] = []
  const generations: any[] = []
  let failSecondPage = false
  const peer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      listRequests.push(url)
      const secondPage = url.searchParams.get('after_id') === 'catalog-A'
      response.writeHead(secondPage && failSecondPage ? 503 : 200, {
        'content-type': 'application/json', 'x-should-retry': 'false',
      })
      response.end(JSON.stringify(secondPage && failSecondPage
        ? { type: 'error', error: { type: 'api_error', message: privateError } }
        : { data: [{ id: secondPage ? 'catalog-B' : 'catalog-A', type: 'model', display_name: secondPage ? 'Model B' : 'Model A' }],
            has_more: !secondPage, first_id: secondPage ? 'catalog-B' : 'catalog-A', last_id: secondPage ? 'catalog-B' : 'catalog-A' }))
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') {
      response.writeHead(404)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    generations.push(body)
    const message = { id: `msg-pagination-${generations.length}`, type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } }
    const text = `The exact selected ${body.model} answered.`
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { type: 'message_start', message },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  await new Promise<void>((resolve, reject) => { peer.once('error', reject); peer.listen(0, '127.0.0.1', resolve) })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    listRequests, generations,
    failPageTwo() { failSecondPage = true },
    async close() { peer.closeAllConnections(); await new Promise<void>(resolve => peer.close(() => resolve())) },
  }
}

async function setup(baseURL: string, explicit: boolean) {
  const tenantId = `tenant-paginated-catalog-${++sequence}`
  const headers = { 'x-tenant-id': tenantId }
  const provider = store.createProvider({ label: `Paginated Messages ${sequence}`, modelFamily: 'claude', effortLevels: [], models: structuredClone(models) },
    { protocol: 'anthropic-messages', baseURL, model: explicit ? 'catalog-A' : 'catalog-B', capabilities: { toolUse: false } }, tenantId)
  const created = await call('POST', '/sessions', { firstMessage: 'Catalog pagination fixture', providerId: provider.id }, headers)
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const sessionId = created.json.id
  if (explicit) {
    const picked = await call('PATCH', `/sessions/${sessionId}`, { providerId: provider.id, modelId: 'catalog-B' }, headers)
    assert.equal(picked.status, 200, JSON.stringify(picked.json))
  }
  return { tenantId, headers, provider, sessionId }
}

for (const explicit of [false, true]) {
  const selection = explicit ? 'explicit Session model' : 'configured default model'
  test(`Messages page-two ${selection} stays selectable and sendable after catalog refresh`, async () => {
    const peer = await fixture()
    try {
      const { tenantId, headers, provider, sessionId } = await setup(peer.baseURL, explicit)
      const revision = provider.connectionRevision ?? 0
      const key = `catalog-pages-${sessionId}`
      const refreshed = await call('POST', `/providers/${provider.id}/models/refresh`, { expectedRevision: revision }, { ...headers, 'idempotency-key': key })
      assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json))
      assert.deepEqual(refreshed.json.models, models, 'the published catalog must include page two before selection guards consume it')
      assert.equal(refreshed.json.defaultModelId, explicit ? 'catalog-A' : 'catalog-B')
      assert.equal(refreshed.json.connectionRevision, revision + 1)
      assert.deepEqual(peer.listRequests.map(url => url.searchParams.get('after_id')), [null, 'catalog-A'])
      assert.equal(peer.generations.length, 0, 'catalog refresh never generates a reply')
      assert.equal(store.getSession(sessionId)?.modelId, explicit ? 'catalog-B' : undefined, 'refresh must not sweep a page-two pick')
      const picked = await call('PATCH', `/sessions/${sessionId}`, { providerId: provider.id, modelId: 'catalog-B' }, headers)
      assert.equal(picked.status, 200, 'page-two model remains an admitted explicit choice')
      // Restore inherited selection to exercise the configured default as well.
      if (!explicit) assert.equal((await call('PATCH', `/sessions/${sessionId}`, { providerId: provider.id, modelId: null }, headers)).status, 200)
      const reply = await callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'Use the model from page two.' }, { ...headers, 'idempotency-key': `send-${sessionId}` })
      assert.equal(reply.status, 200, reply.body)
      assert.match(reply.body, /The exact selected catalog-B answered/)
      assert.equal(peer.generations.length, 1)
      assert.equal(peer.generations[0].model, 'catalog-B')
      assert.equal(store.getSession(sessionId)?.messages.at(-1)?.modelId, 'catalog-B')
      assert.equal(turns.bySession(sessionId), undefined)
      const replay = await call('POST', `/providers/${provider.id}/models/refresh`, { expectedRevision: revision }, { ...headers, 'idempotency-key': key })
      assert.deepEqual(replay.json, refreshed.json)
      assert.equal(peer.listRequests.length, 2, 'exact refresh replay makes no catalog requests')
      assert.equal(store.listProviders(tenantId).find(row => row.id === provider.id)?.connectionRevision, revision + 1)
    } finally { await peer.close() }
  })

  test(`Messages page-two failure preserves the prior catalog, revision and ${selection} without generation`, async () => {
    const peer = await fixture()
    try {
      const { tenantId, headers, provider, sessionId } = await setup(peer.baseURL, explicit)
      const beforeProvider = structuredClone(store.listProviders(tenantId).find(row => row.id === provider.id))
      const beforeSession = structuredClone(store.getSession(sessionId))
      const beforeUsage = structuredClone(store.usage(sessionId, tenantId))
      peer.failPageTwo()
      const refused = await call('POST', `/providers/${provider.id}/models/refresh`, { expectedRevision: beforeProvider?.connectionRevision ?? 0 },
        { ...headers, 'idempotency-key': `failed-pages-${sessionId}` })
      assert.equal(refused.status, 400, 'a failed second page must refuse the entire refresh, not commit page one')
      assert.equal(refused.json.error.code, 'bad_request')
      assert.doesNotMatch(JSON.stringify(refused.json), new RegExp(privateError))
      assert.deepEqual(peer.listRequests.map(url => url.searchParams.get('after_id')), [null, 'catalog-A'])
      assert.deepEqual(store.listProviders(tenantId).find(row => row.id === provider.id), beforeProvider)
      assert.deepEqual(store.getSession(sessionId), beforeSession)
      assert.deepEqual(store.usage(sessionId, tenantId), beforeUsage)
      assert.equal(turns.bySession(sessionId), undefined)
      assert.equal(peer.generations.length, 0, 'failed enumeration is not a generation or capability probe')
    } finally { await peer.close() }
  })
}
