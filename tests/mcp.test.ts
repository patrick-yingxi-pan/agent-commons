/** The MCP door's protocol behavior (server/mcp.ts, access-parity INV-11):
 *  `POST /mcp` speaks stateless Streamable-HTTP JSON-RPC — initialize / ping /
 *  tools/list / tools/call — and every tool is one HTTP operation dispatched
 *  back through the real router. Parity itself (route↔tool bijection, the
 *  shared auth wall, tenancy) is locked by tests/mcp-parity.test.ts; this
 *  suite locks the endpoint's own protocol contract. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'
import { MCP_PROTOCOL_VERSION } from '../server/mcp.ts'

let seq = 0
const rpc = async (method: string, params?: unknown, headers?: Record<string, string>) =>
  await call('POST', '/mcp', { jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) }, headers)

/** Call a tool and parse the `{status, body}` envelope out of the result text. */
const toolCall = async (name: string, args?: Record<string, unknown>, headers?: Record<string, string>) => {
  const r = await rpc('tools/call', { name, arguments: args ?? {} }, headers)
  assert.equal(r.status, 200, `tools/call ${name} answers 200 at the JSON-RPC layer`)
  if (r.json.error) return { rpcError: r.json.error }
  const result = r.json.result
  const text = result.content?.[0]?.text
  return { isError: result.isError === true, ...(JSON.parse(text) as { status: number; body: any }) }
}

test('initialize: protocol version, tools capability, and instructions that teach the auth flow', async () => {
  const r = await rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '0' } })
  assert.equal(r.status, 200)
  const result = r.json.result
  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION)
  assert.equal(result.serverInfo.name, 'universal-workspace')
  assert.ok(result.capabilities.tools, 'tools are the advertised capability')
  assert.match(result.instructions, /post_auth_login/, 'the instructions teach signing in through the same front door')
  assert.match(result.instructions, /Bearer/, '…and presenting the credential as a bearer header')
})

test('notifications are accepted with 202 and no body', async () => {
  const r = await call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(r.status, 202)
  assert.equal(r.json, undefined)
})

test('ping answers an empty result; unknown methods answer -32601; non-JSON-RPC bodies answer -32600', async () => {
  const ping = await rpc('ping')
  assert.deepEqual(ping.json.result, {})
  const unknown = await rpc('no/such-method')
  assert.equal(unknown.json.error.code, -32601)
  const invalid = await call('POST', '/mcp', { hello: 'world' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, -32600)
})

test('tools/list: generated from the route table, with path params as required string inputs', async () => {
  const r = await rpc('tools/list')
  const tools: any[] = r.json.result.tools
  assert.ok(tools.length > 100, `the whole API surface is exposed (${tools.length} tools)`)
  const byName = new Map(tools.map((t) => [t.name, t]))
  assert.ok(byName.has('get_capabilities'))
  assert.ok(byName.has('post_sessions'))
  const bySession = byName.get('get_sessions_by_id')
  assert.ok(bySession, 'a :id route becomes a by_id tool')
  assert.deepEqual(bySession.inputSchema.required, ['id'])
  assert.equal(bySession.inputSchema.properties.id.type, 'string')
  assert.ok(!byName.has('get_events'), 'the endless SSE stream is an argued exclusion')
  assert.ok(!byName.has('post_mcp'), 'the endpoint does not expose itself')
})

test('tools/call: a create → read round-trip through the real routes', async () => {
  const created = await toolCall('post_sessions', { body: { firstMessage: 'Born over MCP' } })
  assert.equal(created.isError, false)
  assert.equal(created.status, 200)
  assert.ok(created.body.id, 'the created Session comes back through the tool envelope')
  const read = await toolCall('get_sessions_by_id', { id: created.body.id })
  assert.equal(read.status, 200)
  assert.equal(read.body.id, created.body.id)
  const list = await toolCall('get_sessions', { query: { limit: 1 } })
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.body.items), 'query params flow through (paginated shape)')
})

test('tools/call: a non-2xx inner response is isError with the same error envelope', async () => {
  const r = await toolCall('get_sessions_by_id', { id: 'no-such-session' })
  assert.equal(r.isError, true)
  assert.equal(r.status, 404)
  assert.equal(r.body.error.code, 'not_found', 'the HTTP error envelope is preserved verbatim')
})

test('tools/call: unknown tools and missing path params are JSON-RPC -32602', async () => {
  const unknown = await toolCall('no_such_tool')
  assert.equal(unknown.rpcError?.code, -32602)
  const missing = await rpc('tools/call', { name: 'get_sessions_by_id', arguments: {} })
  assert.equal(missing.json.error.code, -32602)
  assert.match(missing.json.error.message, /path parameter/)
})

test('tools/call: served image bytes ride as first-class MCP image content (no UTF-8 mangling)', async () => {
  const r = await rpc('tools/call', { name: 'get_fs_content', arguments: { query: { source: 'cloud', path: 'mockup.svg' } } })
  const item = r.json.result.content[0]
  assert.equal(item.type, 'image', 'binary responses become image content, not mangled text')
  assert.match(item.mimeType, /^image\//)
  const decoded = Buffer.from(item.data, 'base64').toString('utf8')
  assert.match(decoded, /<svg/, 'the bytes round-trip exactly')
})

test('the endpoint is stateless: GET and DELETE answer 405 with Allow: POST', async () => {
  for (const method of ['GET', 'DELETE']) {
    const r = await callRaw(method, '/mcp')
    assert.equal(r.status, 405, `${method} /mcp`)
    assert.equal(r.headers.allow, 'POST')
  }
})
