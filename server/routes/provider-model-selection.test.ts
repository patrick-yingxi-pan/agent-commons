/** Model admission uses the exact server-resolved ID, never a catalog's first
 * entry. Wire peers are authored fetch fixtures; no provider is contacted. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { call, callRaw } from '../testkit/http.ts'
import type { EndpointProtocol } from '../../contract/providers.ts'

let sequence = 0
function provider(protocol: EndpointProtocol, tenantId: string) {
  return store.createProvider({ label: `Exact model ${++sequence}`, modelFamily: protocol === 'openai-responses' ? 'gpt' : 'claude', effortLevels: [], models: [{ id: 'catalog-B', label: 'Available model B' }] },
    { protocol, baseURL: 'http://127.0.0.1:1', model: 'configured-A', capabilities: { toolUse: false } }, tenantId)
}
async function session(tenantId: string, providerId: string, inherited: boolean) {
  let agentId: string | undefined
  if (inherited) {
    const created = await call('POST', '/agents', { label: `Inherited routing ${++sequence}`, providerId, systemPromptId: 'sp-concise-reviewer' }, { 'x-tenant-id': tenantId })
    assert.equal(created.status, 200, JSON.stringify(created.json))
    agentId = created.json.id
  }
  const created = await call('POST', '/sessions', { firstMessage: 'Exact model route fixture', ...(agentId ? { agentId } : { providerId }) }, { 'x-tenant-id': tenantId })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.modelId, undefined)
  if (inherited) assert.equal(created.json.providerId, undefined)
  return created.json.id as string
}

function wireResponse(protocol: EndpointProtocol, stream: boolean): Response {
  const text = 'Selected model B answered.'
  const message = { id: `fixture-${++sequence}`, type: 'message', role: 'assistant', model: 'catalog-B', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } }
  if (protocol === 'openai-responses') {
    const response = { id: `resp-${sequence}`, object: 'response', status: 'completed', model: 'catalog-B', output: [{ id: message.id, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage: message.usage }
    return stream ? new Response([{ type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } }, { type: 'response.completed', response }].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response)
  }
  return stream ? new Response([
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(message)
}

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  for (const inherited of [false, true]) {
    test(`${protocol}: absent configured default refuses ${inherited ? 'Agent-inherited' : 'Session-bound'} send before effects; explicit B recovers and completed send replays`, async t => {
      const tenantId = `tenant-selection-${++sequence}`
      const headers = { 'x-tenant-id': tenantId, 'idempotency-key': `model-selection-${sequence}` }
      const selected = provider(protocol, tenantId)
      const id = await session(tenantId, selected.id, inherited)
      let calls = 0
      t.mock.method(globalThis, 'fetch', async (_input, init) => {
        calls++
        const body = JSON.parse(String(init!.body))
        assert.equal(body.model, 'catalog-B', 'only the explicitly selected valid ID may leave the server')
        return wireResponse(protocol, body.stream === true)
      })
      const before = structuredClone(store.getSession(id))
      const usage = structuredClone(store.usage(id, tenantId))
      const refused = await callRaw('POST', `/sessions/${id}/messages`, { text: 'Must not be appended.' }, headers)
      assert.equal(refused.status, 409)
      assert.equal(JSON.parse(refused.body).error.code, 'capability_unavailable')
      assert.deepEqual(store.getSession(id), before)
      assert.deepEqual(store.usage(id, tenantId), usage)
      assert.equal(turns.bySession(id), undefined)
      assert.equal(turns.byIdempotencyKey(id, headers['idempotency-key']), undefined)
      assert.equal(turns.completedByKey(id, headers['idempotency-key']), undefined)
      assert.equal(calls, 0)
      const picked = await call('PATCH', `/sessions/${id}`, { providerId: selected.id, modelId: 'catalog-B' }, { 'x-tenant-id': tenantId })
      assert.equal(picked.status, 200, JSON.stringify(picked.json))
      const recovered = await callRaw('POST', `/sessions/${id}/messages`, { text: 'Must not be appended.' }, headers)
      assert.equal(recovered.status, 200)
      assert.match(recovered.body, /Selected model B answered/)
      assert.equal(calls, 1)
      // Losing B later must not make an exact completed retry perform new work.
      store.replaceStaticProviderModels(selected.id, [{ id: 'catalog-C', label: 'Model C' }])
      const replay = await callRaw('POST', `/sessions/${id}/messages`, { text: 'Must not be appended.' }, headers)
      assert.equal(replay.status, 200)
      assert.match(replay.body, /Selected model B answered/)
      assert.equal(calls, 1)
    })
  }

  test(`${protocol}: compaction refuses absent inherited default without transcript or metering changes; explicit B and exact replay work`, async t => {
    const tenantId = `tenant-compact-selection-${++sequence}`
    const selected = provider(protocol, tenantId)
    const id = await session(tenantId, selected.id, true)
    const headers = { 'x-tenant-id': tenantId, 'idempotency-key': `compact-selection-${sequence}` }
    for (let i = 0; i < 9; i++) store.appendMessage(id, { id: store.mintMessageId(i % 2 ? 'assistant' : 'user'), role: i % 2 ? 'assistant' : 'user', content: `Frozen history ${i} ${'context '.repeat(20)}` })
    let calls = 0
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      calls++
      const body = JSON.parse(String(init!.body))
      assert.equal(body.model, 'catalog-B')
      return wireResponse(protocol, false)
    })
    const before = structuredClone(store.getSession(id))
    const usage = structuredClone(store.usage(id, tenantId))
    const refused = await call('POST', `/sessions/${id}/compact`, {}, headers)
    assert.equal(refused.status, 409)
    assert.equal(refused.json.error.code, 'capability_unavailable')
    assert.deepEqual(store.getSession(id), before)
    assert.deepEqual(store.usage(id, tenantId), usage)
    assert.equal(turns.bySession(id), undefined)
    assert.equal(calls, 0)
    assert.equal((await call('PATCH', `/sessions/${id}`, { providerId: selected.id, modelId: 'catalog-B' }, { 'x-tenant-id': tenantId })).status, 200)
    const recovered = await call('POST', `/sessions/${id}/compact`, {}, headers)
    assert.equal(recovered.status, 200, JSON.stringify(recovered.json))
    assert.ok(calls > 0)
    const afterCalls = calls
    store.replaceStaticProviderModels(selected.id, [{ id: 'catalog-C', label: 'Model C' }])
    assert.equal((await call('POST', `/sessions/${id}/compact`, {}, headers)).status, 200)
    assert.equal(calls, afterCalls)
  })
}
