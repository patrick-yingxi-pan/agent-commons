/** Authored loopback peers, not live-service acceptance or paid API calls. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { generateReply } from '../generate.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import type { ProviderConfig } from '../data/providers.ts'

const protocols = ['anthropic-messages', 'openai-responses'] as const
const privateMarker = 'UPSTREAM_PRIVATE_KEY_BODY_AND_URL'
const session = { id: 'provider-rejection', title: 'Provider rejection' }

async function peer(status: number, initialTool = false) {
  const requests: any[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(body)
    if (!initialTool || requests.length > 1) {
      // Transient tests concern the shared failure classification, not SDK backoff.
      res.writeHead(status, { 'content-type': 'application/json', 'x-should-retry': 'false' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: privateMarker } }))
      return
    }
    const tool = body.tools.find((tool: any) => tool.name.startsWith('mcp_external_'))
    assert.ok(tool, 'the fixture must exercise a declared external consent proposal')
    const input = { query: 'captured-before-refusal' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (data: Record<string, unknown>) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
    if (req.url?.endsWith('/responses')) {
      const output = [
        { id: 'msg-before', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Earlier prose.', annotations: [] }] },
        { id: 'fc-before', type: 'function_call', call_id: 'call-before', name: tool.name, arguments: JSON.stringify(input), status: 'completed' },
      ]
      event({ type: 'response.created', response: { id: 'resp-before', status: 'in_progress', output: [], usage: null } })
      event({ type: 'response.output_text.delta', item_id: 'msg-before', output_index: 0, content_index: 0, delta: 'Earlier prose.' })
      event({ type: 'response.completed', response: { id: 'resp-before', object: 'response', status: 'completed', model: body.model, output, usage: { input_tokens: 17, output_tokens: 4 } } })
    } else {
      event({ type: 'message_start', message: { id: 'msg-before', type: 'message', role: 'assistant', content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 17, output_tokens: 0 } } })
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Earlier prose.' } })
      event({ type: 'content_block_stop', index: 0 })
      event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-before', name: tool.name, input: {} } })
      event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
      event({ type: 'content_block_stop', index: 1 })
      event({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 4 } })
      event({ type: 'message_stop' })
    }
    res.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    requests,
    config: (protocol: ProviderConfig['protocol']): ProviderConfig => ({ protocol, baseURL: `http://127.0.0.1:${address.port}`, model: 'local-test', capabilities: { toolUse: true } }),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

function collect() {
  const starts: string[] = []
  let text = ''
  return { starts, get text() { return text }, handlers: { onStart: (id: string) => starts.push(id), onDelta: (delta: string) => { text += delta } } }
}

test('permanent provider HTTP refusals give safe actionable terminal details on both protocols', async t => {
  const cases = [
    [400, /request.*Models/], [401, /authentication.*API key.*Models/],
    [402, /billing/], [403, /access.*permissions/], [404, /endpoint or model.*Models/],
    [405, /request.*Models/], [413, /too large.*shorter/], [415, /request.*Models/],
    [422, /request.*Models/], [451, /request.*Models/],
  ] as const
  for (const protocol of protocols) for (const [status, detail] of cases) {
    await t.test(`${protocol} HTTP ${status}`, async () => {
      const endpoint = await peer(status)
      try {
        const c = collect()
        const result = await generateReply(session, DEFAULT_AGENT, 'Hello.', c.handlers, undefined, endpoint.config(protocol))
        assert.equal(result.outcome, 'fallback')
        assert.equal(result.failure, 'provider_rejected')
        assert.match(result.message.content, detail)
        assert.ok(result.message.content.includes(`HTTP ${status}`))
        assert.match(result.message.content, /will not be retried automatically/)
        assert.doesNotMatch(result.message.content, /UPSTREAM_PRIVATE|127\.0\.0\.1|Please try again|unreachable/)
        assert.equal(result.message.content, c.text)
        assert.deepEqual(c.starts, [result.message.id])
        assert.equal(endpoint.requests.length, 1)
        assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 })
        assert.equal(result.message.toolActivities, undefined)
      } finally { await endpoint.close() }
    })
  }
})

test('transient HTTP statuses retain the existing retryable classification on both protocols', async t => {
  for (const protocol of protocols) for (const status of [408, 409, 429, 500, 503, 529]) {
    await t.test(`${protocol} HTTP ${status}`, async () => {
      const endpoint = await peer(status)
      try {
        const result = await generateReply(session, DEFAULT_AGENT, 'Hello.', collect().handlers, undefined, endpoint.config(protocol))
        assert.equal(result.failure, 'endpoint_unavailable')
        assert.doesNotMatch(result.message.content, /UPSTREAM_PRIVATE/)
        assert.equal(endpoint.requests.length, 1)
      } finally { await endpoint.close() }
    })
  }
})

test('a refused continuation retains earlier prose, usage and consent proposals without replay', async t => {
  const id = `mcp-connection-${'e'.repeat(32)}`
  const tool = { name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
  const connection = { id, label: 'Rejection fixture', revision: 2, status: 'connected', authentication: 'none', inspectedAt: 1, protocolVersion: '2026-07-28', tools: [tool], execution: 'approval-required', executableTools: ['lookup'] }
  for (const protocol of protocols) await t.test(protocol, async () => {
    const endpoint = await peer(401, true)
    try {
      const c = collect()
      const reports: unknown[] = []
      const result = await generateReply(session, DEFAULT_AGENT, 'Look it up.', { ...c.handlers, onUsage: row => reports.push(row) },
        undefined, endpoint.config(protocol), undefined, [{ id, type: 'mcp', label: 'Rejection fixture', scope: '*' }], undefined, { externalMcpConnections: [connection] })
      assert.equal(result.failure, 'provider_rejected')
      assert.match(result.message.content, /^Earlier prose\.[\s\S]*authentication/)
      assert.equal(result.message.content, c.text)
      assert.deepEqual(c.starts, [result.message.id])
      assert.deepEqual(result.usage, { inputTokens: 17, outputTokens: 4 })
      assert.deepEqual(reports, [{ inputTokens: 17, outputTokens: 4 }])
      assert.equal(result.message.toolActivities?.length, 1)
      assert.equal(result.message.toolActivities[0].status, 'proposed')
      assert.deepEqual(result.message.toolActivities[0].input, { query: 'captured-before-refusal' })
      assert.equal(endpoint.requests.length, 2, 'one initial call and one refused continuation, no replay')
    } finally { await endpoint.close() }
  })
})

test('missing configured provider credentials fail locally with safe actionable details', async t => {
  const keyRef = 'PROVIDER_REJECTION_UNAVAILABLE_TEST_KEY'
  assert.equal(process.env[keyRef], undefined, 'this synthetic reference must not resolve a real credential')
  for (const protocol of protocols) await t.test(protocol, async () => {
    const endpoint = await peer(401)
    try {
      const c = collect()
      const result = await generateReply(session, DEFAULT_AGENT, 'Hello.', c.handlers, undefined, { ...endpoint.config(protocol), apiKeyEnv: keyRef })
      assert.equal(result.failure, 'provider_rejected')
      assert.match(result.message.content, /connection.*Models.*will not be retried automatically/)
      assert.doesNotMatch(result.message.content, /PROVIDER_REJECTION|127\.0\.0\.1/)
      assert.equal(result.message.content, c.text)
      assert.equal(endpoint.requests.length, 0)
    } finally { await endpoint.close() }
  })
})
