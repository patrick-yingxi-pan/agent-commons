/** Capability metadata reaches the actual Messages wire through real routes.
 * Claude-root and DeepSeek-mounted peers are authored loopback fixtures only. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type ServerResponse } from 'node:http'
import { call, callRaw } from '../testkit/http.ts'
import { store } from '../store/index.ts'

let sequence = 0
const UNSUPPORTED = 'effort-unsupported'
const UNKNOWN = 'effort-unknown'
const SUBSET = 'effort-low-only'
const REPLY = 'The selected effort capability was honored.'

function stream(response: ServerResponse, model: string, id: string, tool: boolean) {
  const block = tool
    ? { type: 'tool_use', id: 'effort-capability-call', name: 'api__get_usage', input: { query: {} } }
    : { type: 'text', text: REPLY }
  const events = [
    { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null,
      stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool
      ? { type: 'tool_use', id: block.id, name: block.name, input: {} }
      : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
      : { type: 'text_delta', text: REPLY } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

async function fixture(mount: string) {
  const requests: Array<{ path: string; body: any }> = []
  let listings = 0
  const peer = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'GET' && path === `${mount}/v1/models`) {
      listings++
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [
        { id: UNSUPPORTED, capabilities: { effort: { supported: false } } },
        { id: UNKNOWN },
        { id: SUBSET, capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: false } } } },
      ], has_more: false }))
      return
    }
    if (request.method !== 'POST' || path !== `${mount}/v1/messages`) {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({ path, body })
    if (body.stream !== true) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'effort-capability-probe', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    const admitted = body.model === UNSUPPORTED ? !Object.hasOwn(body, 'output_config')
      : body.output_config?.effort === (body.model === SUBSET ? 'low' : 'high')
    if (!admitted) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Authored unsupported effort refusal.' } }))
      return
    }
    const hasResult = body.messages.some((message: any) => Array.isArray(message.content) &&
      message.content.some((block: any) => block.type === 'tool_result'))
    stream(response, body.model, `effort-capability-${requests.length}`, body.model === UNSUPPORTED && !hasResult)
  })
  await new Promise<void>((resolve, reject) => { peer.once('error', reject); peer.listen(0, '127.0.0.1', resolve) })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  return {
    baseURL: `http://127.0.0.1:${address.port}${mount}`, requests,
    get listings() { return listings },
    async close() { peer.closeAllConnections(); await new Promise<void>(resolve => peer.close(() => resolve())) },
  }
}

for (const [label, mount] of [['Claude root', ''], ['DeepSeek mount', '/anthropic']] as const) {
  test(`${label}: registration and refresh preserve unsupported, unknown and supported effort on Send and continuation`, async () => {
    const peer = await fixture(mount)
    const headers = { 'x-tenant-id': `tenant-effort-capability-${++sequence}` }
    try {
      const created = await call('POST', '/providers', { label: `Effort capability ${sequence}`, modelFamily: mount ? 'deepseek' : 'claude',
        effortLevels: ['High'], config: { protocol: 'anthropic-messages', baseURL: peer.baseURL, model: UNKNOWN } }, headers)
      assert.equal(created.status, 200, JSON.stringify(created.json))
      const providerId = created.json.id
      assert.equal(peer.listings, 1, 'registration reads the actual endpoint catalog')
      const refreshed = await call('POST', `/providers/${providerId}/models/refresh`, { expectedRevision: created.json.connectionRevision },
        { ...headers, 'idempotency-key': `effort-refresh-${sequence}` })
      assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json))
      assert.equal(peer.listings, 2)
      const session = await call('POST', '/sessions', { firstMessage: 'Effort capability fixture', providerId }, headers)
      assert.equal(session.status, 200, JSON.stringify(session.json))
      const sessionId = session.json.id

      for (const [model, expectedEffort, expectedCalls] of [[UNSUPPORTED, undefined, 2], [UNKNOWN, 'high', 1], [SUBSET, 'low', 1]] as const) {
        const selected = await call('PATCH', `/sessions/${sessionId}`, { providerId, modelId: model }, headers)
        assert.equal(selected.status, 200, JSON.stringify(selected.json))
        const before = peer.requests.length
        const reply = await callRaw('POST', `/sessions/${sessionId}/messages`, { text: `Use declared effort for ${model}.` },
          { ...headers, 'idempotency-key': `effort-send-${sequence}-${model}` })
        assert.equal(reply.status, 200, reply.body)
        const outgoing = peer.requests.slice(before)
        assert.deepEqual(outgoing.map(({ body }) => body.output_config?.effort), Array(expectedCalls).fill(expectedEffort),
          `${model} must preserve its capability rather than inheriting an unsupported provider setting`)
        assert.ok(outgoing.every(({ path, body }) => path === `${mount}/v1/messages` && body.model === model && body.stream === true))
        assert.match(reply.body, new RegExp(REPLY))
        assert.doesNotMatch(reply.body, /provider rejected|Authored unsupported effort refusal/)
        if (model === UNSUPPORTED) {
          assert.ok(outgoing.every(({ body }) => !Object.hasOwn(body, 'output_config')), 'unsupported effort is absent through the complete tool loop')
          assert.ok(outgoing[1].body.messages.at(-1).content.some((block: any) => block.type === 'tool_result' && block.tool_use_id === 'effort-capability-call'))
          const activities = store.getSession(sessionId)?.messages.at(-1)?.toolActivities ?? []
          assert.equal(activities.length, 1)
          assert.equal(activities[0].status, 'done')
        }
      }
      for (const provider of [created.json, refreshed.json]) {
        assert.deepEqual(provider.models.find((model: any) => model.id === UNSUPPORTED).effortLevels, [])
        assert.equal(provider.models.find((model: any) => model.id === UNKNOWN).effortLevels, undefined)
        assert.deepEqual(provider.models.find((model: any) => model.id === SUBSET).effortLevels, ['Low'])
      }
      assert.equal(peer.requests.filter(({ body }) => body.stream !== true).length, 1, 'only registration probes; refresh never generates')
    } finally { await peer.close() }
  })
}
