import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { callMcpTool, createMcpToolCaller, McpToolCallError } from './mcpToolCall.ts'
import { createMcpHttpTransport } from './mcpHttpTransport.ts'
import { MCP_MODERN_VERSION, MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'

const options = { scope: 'loopback' as const }
const makeCall = (protocolVersion = MCP_MODERN_VERSION) => ({
  protocolVersion, tool: { name: 'weather.lookup', inputSchema: { type: 'object', properties: { location: { type: 'string' } } } },
  arguments: { location: 'Paris' },
})
const complete = { resultType: 'complete', content: [{ type: 'text', text: 'Clear' }] }
const failure = (code, mayHaveExecuted) => (error) => {
  assert.ok(error instanceof McpToolCallError)
  assert.equal(error.code, code)
  assert.equal(error.mayHaveExecuted, mayHaveExecuted)
  assert.doesNotMatch(error.stack, /upstream-secret|private-query|sensitive-state|private-token/)
  assert.deepEqual(Object.keys(error).sort(), ['code', 'mayHaveExecuted', 'name'])
  return true
}
async function endpoint(t, handler) {
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ body, headers: req.headers, method: req.method })
      handler(req, res, body)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) })
  return { url: `http://127.0.0.1:${server.address().port}/mcp?private-query=1`, requests }
}
function respond(res, body, result = complete, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
}

test('one real modern tool call mirrors body-derived names and nested parameters without widening metadata', async (t) => {
  const peer = await endpoint(t, (_req, res, body) => respond(res, body))
  const call = makeCall()
  call.tool.name = '天气 lookup'
  call.tool.inputSchema.properties = { tenant: { type: 'object', properties: {
    label: { type: 'string', 'x-mcp-header': 'Tenant' }, count: { type: 'integer', 'x-mcp-header': 'Count' },
    active: { type: 'boolean', 'x-mcp-header': 'Active' }, missing: { type: 'string', 'x-mcp-header': 'Missing' },
  } } }
  call.arguments = { tenant: { label: ' 世界\r\nCookie: bad ', count: 42, active: false } }
  const pending = callMcpTool(peer.url, call, { ...options, bearerToken: 'private-token' })
  call.arguments.tenant.count = 99
  call.tool.inputSchema.properties.tenant.properties.count['x-mcp-header'] = 'Changed'
  const result = await pending
  assert.deepEqual(result.content, complete.content)
  assert.equal(result.isError, false)
  assert.equal(peer.requests.length, 1)
  const { body, headers, method } = peer.requests[0]
  assert.equal(method, 'POST')
  assert.equal(body.method, 'tools/call')
  assert.equal(body.params.arguments.tenant.count, 42)
  assert.deepEqual(body.params._meta, {
    'io.modelcontextprotocol/protocolVersion': MCP_MODERN_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'agent-commons', version: '0.1.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  })
  assert.equal(headers['mcp-method'], body.method)
  assert.equal(headers['mcp-name'], `=?base64?${Buffer.from(body.params.name).toString('base64')}?=`)
  assert.equal(headers['mcp-param-tenant'], `=?base64?${Buffer.from(body.params.arguments.tenant.label).toString('base64')}?=`)
  assert.equal(headers['mcp-param-count'], '42')
  assert.equal(headers['mcp-param-active'], 'false')
  assert.equal(headers['mcp-param-missing'], undefined)
  assert.equal(headers['mcp-param-changed'], undefined)
  assert.equal(headers['mcp-session-id'], undefined)
  assert.equal(headers.authorization, 'Bearer private-token')
  assert.equal(headers.cookie, undefined)
})

test('legacy calls use only the caller-owned initialized context and never open or delete a session', async (t) => {
  const peer = await endpoint(t, (_req, res, body) => respond(res, body, { content: complete.content }, 200, { 'Mcp-Session-Id': 'private-token' }))
  for (const version of MCP_LEGACY_VERSIONS) {
    assert.equal((await callMcpTool(peer.url, { ...makeCall(version), sessionId: 'private-token' }, options)).isError, false)
  }
  assert.equal(peer.requests.length, MCP_LEGACY_VERSIONS.length)
  assert.equal(new Set(peer.requests.map((row) => row.body.id)).size, peer.requests.length)
  for (const row of peer.requests) {
    assert.equal(row.body.method, 'tools/call')
    assert.equal(row.headers['mcp-session-id'], 'private-token')
    assert.equal(row.headers['mcp-name'], undefined)
    assert.equal(row.body.params._meta, undefined)
  }
})

test('SSE returns a complete tool error as data, not success prose; structured null is not erased', async (t) => {
  const peer = await endpoint(t, (_req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"message":"untrusted"}}\n\n')
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { ...complete, isError: true, structuredContent: null } })}\n\n`)
  })
  const result = await callMcpTool(peer.url, makeCall(), options)
  assert.equal(result.isError, true)
  assert.equal(Object.hasOwn(result, 'structuredContent'), true)
  assert.equal(result.structuredContent, null)
  assert.equal(peer.requests.length, 1)
})

test('RPC errors, input-required and malformed results retain uncertainty and never retry or continue', async (t) => {
  let kind = 'rpc'
  const peer = await endpoint(t, (_req, res, body) => {
    if (kind === 'rpc') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32020, message: 'upstream-secret' } }))
    } else if (kind === 'input') respond(res, body, { resultType: 'input_required', requestState: 'sensitive-state', inputRequests: {} })
    else if (kind === 'malformed') respond(res, body, { ...complete, content: [{ type: 'text', text: 42 }] })
    else if (kind === 'legacy-shape') respond(res, body, { content: complete.content })
    else if (kind === 'session') respond(res, body, complete, 200, { 'Mcp-Session-Id': 'unexpected' })
    else if (kind === 'wrong-id') respond(res, { id: 'different' })
    else if (kind === 'http-error') respond(res, body, complete, 500)
    else if (kind === 'expired') { res.writeHead(404); res.end('upstream-secret') }
  })
  for (const [mode, code] of [['rpc', 'rpc_error'], ['input', 'input_required'], ['malformed', 'result'], ['legacy-shape', 'result'],
    ['session', 'protocol'], ['wrong-id', 'response'], ['http-error', 'response'], ['expired', 'response']]) {
    kind = mode
    const count = peer.requests.length
    await assert.rejects(callMcpTool(peer.url, makeCall(), options), failure(code, true))
    assert.equal(peer.requests.length, count + 1)
  }
})

test('invalid call arguments, schemas and header plans fail before any transport invocation', async () => {
  let posts = 0
  const call = createMcpToolCaller({ post: async () => { posts++; throw new Error() } })
  const invalid = [
    { ...makeCall(), protocolVersion: '2024-11-05' }, { ...makeCall(), sessionId: 'legacy-session' },
    { ...makeCall(), arguments: [] }, { ...makeCall(), arguments: { x: undefined } },
    { ...makeCall(), arguments: { x: 'x'.repeat(49_152) } },
    { ...makeCall(), tool: { name: '\ud800', inputSchema: { type: 'object' } } },
    { ...makeCall(), tool: { name: 'ok', inputSchema: { type: 'array' } } },
    { ...makeCall(), tool: { name: 'ok', inputSchema: { type: 'object', properties: { location: { type: 'string', 'x-mcp-header': 'Bad\r\nName' } } } } },
  ]
  for (const value of invalid) await assert.rejects(call('https://example.com/mcp', value, { scope: 'public' }), failure('request', false))
  assert.equal(posts, 0)
})

test('pre-abort and stalled DNS remain definite non-submission, including after the late DNS answer', async () => {
  let resolves = 0
  let sockets = 0
  let release
  const pendingDns = new Promise((resolve) => { release = resolve })
  const call = createMcpToolCaller({ post: createMcpHttpTransport({
    resolve: async () => { resolves++; return pendingDns }, https: () => { sockets++; throw new Error() },
  }) })
  const signal = AbortSignal.abort('private-token')
  await assert.rejects(call('https://example.com/mcp', makeCall(), { scope: 'public', signal }), failure('cancelled', false))
  assert.equal(resolves, 0)
  await assert.rejects(call('https://example.com/mcp', makeCall(), { scope: 'public', timeoutMs: 30 }), failure('timeout', false))
  assert.equal(resolves, 1)
  release([{ address: '93.184.216.34', family: 4 }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sockets, 0)
})

test('legacy session rotation is refused and unknown transport exceptions never escape or become safe retries', async (t) => {
  const peer = await endpoint(t, (_req, res, body) => respond(res, body, { content: [] }, 200, { 'Mcp-Session-Id': 'rotated' }))
  await assert.rejects(callMcpTool(peer.url, { ...makeCall(MCP_LEGACY_VERSIONS[0]), sessionId: 'original' }, options), failure('protocol', true))
  assert.equal(peer.requests.length, 1)
  const caller = createMcpToolCaller({ post: async () => { throw new Error('upstream-secret private-token') } })
  await assert.rejects(caller(peer.url, makeCall(), options), failure('network', true))
})

test('a complete transport response remains authoritative when cancellation arrives before the consumer continuation', async () => {
  const controller = new AbortController()
  const caller = createMcpToolCaller({ post: (_endpoint, request) => {
    // The transport promise is already fulfilled; cancellation follows that
    // verdict but runs before the awaiting caller's continuation.
    const received = Promise.resolve({ status: 200, message: { jsonrpc: '2.0', id: request.id, result: complete } })
    queueMicrotask(() => controller.abort())
    return received
  } })
  assert.deepEqual((await caller('https://example.com/mcp', makeCall(), { scope: 'public', signal: controller.signal })).content, complete.content)
  assert.equal(controller.signal.aborted, true)
})

test('post-submission timeout and cancellation close the real socket, stay uncertain, and do not replay', { timeout: 5000 }, async (t) => {
  for (const mode of ['cancelled', 'timeout']) {
    let arrived
    let closed
    const observed = new Promise((resolve) => { arrived = resolve })
    const disconnected = new Promise((resolve) => { closed = resolve })
    const peer = await endpoint(t, (req) => { req.socket.on('close', closed); arrived() })
    const controller = new AbortController()
    const pending = callMcpTool(peer.url, makeCall(), { ...options, signal: controller.signal, timeoutMs: mode === 'timeout' ? 200 : 3000 })
    const rejection = assert.rejects(pending, failure(mode, true))
    await observed
    if (mode === 'cancelled') controller.abort('private-token')
    await rejection
    await disconnected
    assert.equal(peer.requests.length, 1)
  }
})
