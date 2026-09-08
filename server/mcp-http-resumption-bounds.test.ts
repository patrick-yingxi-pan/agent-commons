import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { postMcpHttp, createMcpHttpTransport, McpHttpError, MAX_MCP_RESUMPTIONS } from './mcpHttpTransport.ts'
import { createMcpToolSession } from './mcpToolSession.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'

const version = MCP_LEGACY_VERSIONS[0]
const options = { scope: 'loopback' as const, protocolVersion: version, sessionId: 'private-session' }
const request = { jsonrpc: '2.0', id: 'original-call', method: 'tools/call', params: { name: 'echo', arguments: {} } }
const result = { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'done' }] } }
const prime = (id = 'cursor', retry = 0) => `id: ${id}\nretry: ${retry}\ndata:\n\n`
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const failed = (code: string) => (error: unknown) => error instanceof McpHttpError && error.code === code && error.mayHaveExecuted

async function peer(t, handler) {
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    await handler(req, res, raw ? JSON.parse(raw) : null)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return `http://127.0.0.1:${server.address().port}/mcp?audience=exact`
}

test('resumption stops at eight GETs without repeating the original POST', { timeout: 5000 }, async t => {
  const methods = []
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(prime(`event-${methods.length}`))
  })
  await assert.rejects(postMcpHttp(url, request, options), failed('response'))
  assert.deepEqual(methods, ['POST', ...Array(MAX_MCP_RESUMPTIONS).fill('GET')])
})

test('the response byte budget is cumulative across resumed streams', { timeout: 5000 }, async t => {
  const methods = []
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    // Each comment is within the per-event bound; seven connections exceed
    // the one logical response's 1 MiB bound before its terminal result.
    res.end(`:${'x'.repeat(150_000)}\n\n` + prime(`event-${methods.length}`) + (methods.length === 7 ? frame(result) : ''))
  })
  await assert.rejects(postMcpHttp(url, request, options), failed('response'))
  assert.deepEqual(methods, ['POST', ...Array(6).fill('GET')])
})

test('resumption honors a complete retry field even without a following blank line', { timeout: 5000 }, async t => {
  let closedAt = 0
  let resumedAt = 0
  const url = await peer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (req.method === 'POST') {
      closedAt = performance.now()
      return res.end(prime() + 'retry: 200\n')
    }
    resumedAt = performance.now()
    res.end(frame(result))
  })
  assert.deepEqual((await postMcpHttp(url, request, options)).message, result)
  assert.ok(closedAt > 0 && resumedAt - closedAt >= 200, 'The server retry minimum must not be shortened.')
})

test('a resumed declared length cannot exceed the remaining aggregate budget', { timeout: 5000 }, async t => {
  const methods = []
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    if (req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      return res.end(`:${'x'.repeat(150_000)}\n\n` + prime())
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': '1000000' })
    // No body: reject from headers, not a later byte overflow or timeout.
    res.flushHeaders()
  })
  await assert.rejects(postMcpHttp(url, request, options), failed('response'))
  assert.deepEqual(methods, ['POST', 'GET'])
})

test('abrupt POST and GET disconnections resume only their last complete event', { timeout: 5000 }, async t => {
  const methods = []
  const cursors = []
  let disconnect
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    cursors.push(req.headers['last-event-id'])
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (methods.length === 3) return res.end(frame(result))
    disconnect = () => res.destroy()
    res.write(prime(`complete-${methods.length}`) + 'id: incomplete\n')
  })
  const transport = createMcpHttpTransport({ http: (target, config, callback) => httpRequest(target, config, incoming => {
    callback(incoming)
    // Interrupt only after the real parser has received the priming frame.
    incoming.once('data', () => { if (methods.length < 3) disconnect() })
  }) })
  assert.deepEqual((await transport(url, request, options)).message, result)
  assert.deepEqual(methods, ['POST', 'GET', 'GET'])
  assert.deepEqual(cursors, [undefined, 'complete-1', 'complete-2'])
})

test('a retry longer than the original deadline cannot extend it or start a GET', { timeout: 5000 }, async t => {
  const methods = []
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(prime('private-cursor') + `retry: ${'9'.repeat(100)}\n`)
  })
  await assert.rejects(postMcpHttp(url, request, { ...options, timeoutMs: 1000 }), failed('timeout'))
  assert.deepEqual(methods, ['POST'])
})

test('GET resumption reuses admitted DNS and keeps the exact HTTPS audience and TLS policy', async t => {
  const methods = []
  const sockets = []
  let resolutions = 0
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(req.method === 'POST' ? prime() : frame(result))
  })
  const publicUrl = 'https://public.example/mcp?audience=exact'
  const transport = createMcpHttpTransport({
    resolve: async () => { resolutions++; return [{ address: '93.184.216.34', family: 4 }] },
    https: (target, config, callback) => {
      config.lookup('public.example', {}, (_error, address, family) => sockets.push({ target: String(target), config, address, family }))
      // Only the peer socket is substituted. Inspect production's immutable
      // HTTPS/TLS/DNS options before connecting to the test-owned HTTP peer.
      return httpRequest(url, config, callback)
    },
  })
  assert.deepEqual((await transport(publicUrl, request, { ...options, scope: 'public', bearerToken: 'private-bearer' })).message, result)
  assert.equal(resolutions, 1)
  assert.deepEqual(methods, ['POST', 'GET'])
  for (const socket of sockets) {
    assert.equal(socket.target, publicUrl)
    assert.equal(socket.address, '93.184.216.34')
    assert.equal(socket.family, 4)
    assert.equal(socket.config.rejectUnauthorized, true)
    assert.equal(socket.config.headers.Authorization, 'Bearer private-bearer')
    assert.equal(socket.config.headers['Mcp-Session-Id'], 'private-session')
  }
  assert.equal(sockets[1].config.headers['Cache-Control'], 'no-store')
})

test('cancelling during backoff clears the pending GET and retains submission uncertainty', { timeout: 5000 }, async t => {
  const controller = new AbortController()
  const methods = []
  let ended = false
  const url = await peer(t, (req, res) => {
    methods.push(req.method)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(prime('cursor', 1000))
  })
  const transport = createMcpHttpTransport({ http: (target, config, callback) => httpRequest(target, config, incoming => {
    // This microtask runs after the production EOF handler schedules backoff.
    incoming.once('end', () => queueMicrotask(() => { ended = true; controller.abort() }))
    callback(incoming)
  }) })
  await assert.rejects(transport(url, request, { ...options, signal: controller.signal }), failed('cancelled'))
  assert.equal(ended, true)
  assert.deepEqual(methods, ['POST'])
})

test('cancelling an active resumed GET notifies the exact original tool request', { timeout: 5000 }, async t => {
  const controller = new AbortController()
  const methods = []
  let originalId
  let cancellation
  let closed
  const getClosed = new Promise(resolve => { closed = resolve })
  const url = await peer(t, (req, res, body) => {
    const method = body?.method ?? req.method
    methods.push(method)
    if (method === 'server/discover') return res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'legacy' } }))
    if (method === 'initialize') return res.writeHead(200, { 'content-type': 'application/json', 'Mcp-Session-Id': 'private-session' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } }))
    if (method === 'notifications/initialized') return res.writeHead(202).end()
    if (method === 'tools/call') { originalId = body.id; return res.writeHead(200, { 'content-type': 'text/event-stream' }).end(prime()) }
    if (method === 'notifications/cancelled') { cancellation = body; return res.writeHead(202).end() }
    req.socket.once('close', closed)
    controller.abort()
  })
  await assert.rejects(createMcpToolSession()(url, { tool: { name: 'echo', inputSchema: { type: 'object' } }, arguments: {} }, { scope: 'loopback', signal: controller.signal }),
    error => error instanceof McpToolCallError && error.code === 'cancelled' && error.mayHaveExecuted)
  await getClosed
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'GET', 'notifications/cancelled'])
  assert.deepEqual(cancellation, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: originalId } })
})

test('a synchronous resumed socket failure rejects within the GET cap rather than escaping the timer', async t => {
  let gets = 0
  const url = await peer(t, (_req, res) => res.writeHead(200, { 'content-type': 'text/event-stream' }).end(prime()))
  const transport = createMcpHttpTransport({ http: (target, config, callback) => {
    if (config.method === 'GET') { gets++; throw new Error('private socket failure') }
    return httpRequest(target, config, callback)
  } })
  await assert.rejects(transport(url, request, options), failed('network'))
  assert.equal(gets, MAX_MCP_RESUMPTIONS)
})
