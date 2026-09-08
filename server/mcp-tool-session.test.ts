import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { McpHttpError } from './mcpHttpTransport.ts'
import { createMcpToolSession } from './mcpToolSession.ts'

type Body = Record<string, any>
type Handler = (req: IncomingMessage, res: ServerResponse, body: Body | null) => void | Promise<void>
const scope = { scope: 'loopback' as const }
const tool = { name: 'echo', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }

function rpc(id: unknown, result: unknown): Record<string, unknown> { return { jsonrpc: '2.0', id, result } }
function modernDiscovery(id: unknown): Record<string, unknown> {
  return rpc(id, { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'loopback', version: '1' } } })
}
function complete(id: unknown, text = 'ok', isError = false): Record<string, unknown> {
  return rpc(id, { resultType: 'complete', content: [{ type: 'text', text }], isError })
}
function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(value))
}
async function body(req: IncomingMessage): Promise<Body | null> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) as Body : null
}
async function endpoint(t: { after: (fn: () => void | Promise<void>) => void }, handler: Handler): Promise<string> {
  const server = createServer(async (req, res) => handler(req, res, await body(req)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}/mcp`
}
async function call(url: string, args: Record<string, unknown> = { q: 'hello' }, options: Record<string, unknown> = {}) {
  return createMcpToolSession()(url, { tool, arguments: args }, { ...scope, ...options } as any)
}
function assertCallError(error: unknown, code: string, executed: boolean): void {
  assert.ok(error instanceof McpToolCallError)
  assert.equal(error.code, code)
  assert.equal(error.mayHaveExecuted, executed)
}

test('modern session discovers and calls exactly once without legacy cleanup', async (t) => {
  const methods: string[] = []
  const url = await endpoint(t, (_req, res, request) => {
    methods.push(request?.method ?? '')
    if (request?.method === 'server/discover') return json(res, 200, modernDiscovery(request.id))
    if (request?.method === 'tools/call') return json(res, 200, complete(request.id, request.params.arguments.q))
    return json(res, 400, { error: 'unexpected' })
  })
  const result = await call(url)
  assert.equal(result.protocolVersion, MCP_MODERN_VERSION)
  assert.equal(result.result.content[0]?.text, 'hello')
  assert.equal(result.cleanup, 'not-needed')
  assert.deepEqual(methods, ['server/discover', 'tools/call'])
})

test('each supported legacy version initializes, calls once, and releases the private session', async (t) => {
  for (const version of MCP_LEGACY_VERSIONS) {
    const methods: string[] = []
    const sessionId = `legacy-${version}`
    const url = await endpoint(t, (req, res, request) => {
      methods.push(request?.method ?? req.method ?? '')
      if (req.method === 'DELETE') {
        assert.equal(req.headers['mcp-session-id'], sessionId)
        return res.writeHead(204).end()
      }
      if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
      if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: version, serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': sessionId })
      if (request?.method === 'notifications/initialized') return res.writeHead(202).end()
      if (request?.method === 'tools/call') {
        assert.equal(req.headers['mcp-session-id'], sessionId)
        return json(res, 200, complete(request.id, version))
      }
      return json(res, 400, { error: 'unexpected' })
    })
    const result = await call(url)
    assert.equal(result.protocolVersion, version)
    assert.equal(result.result.content[0]?.text, version)
    assert.equal(result.cleanup, 'released')
    assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'DELETE'])
  }
})

test('a failed initialized notification prevents the tool attempt', async (t) => {
  const methods: string[] = []
  const url = await endpoint(t, (_req, res, request) => {
    methods.push(request?.method ?? '')
    if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
    if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': 'notification-failure' })
    if (request?.method === 'notifications/initialized') return res.writeHead(500).end()
    return json(res, 200, complete(request?.id))
  })
  await assert.rejects(call(url), (error: unknown) => { assertCallError(error, 'response', false); return true })
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', ''])
})

test('modern version mismatch refuses unsupported fallback without initialize', async (t) => {
  const methods: string[] = []
  const url = await endpoint(t, (_req, res, request) => {
    methods.push(request?.method ?? '')
    return json(res, 400, { jsonrpc: '2.0', id: request?.id, error: { code: -32022, message: 'unsupported', data: { requested: MCP_MODERN_VERSION, supported: ['2024-01-01'] } } })
  })
  await assert.rejects(call(url), (error: unknown) => { assertCallError(error, 'unsupported_version', false); return true })
  assert.deepEqual(methods, ['server/discover'])
})

test('cleanup 405 preserves a successful tool result and reports server-managed cleanup', async (t) => {
  const url = await endpoint(t, (req, res, request) => {
    if (req.method === 'DELETE') return res.writeHead(405).end()
    if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
    if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': 'cleanup-405' })
    if (request?.method === 'notifications/initialized') return res.writeHead(202).end()
    return json(res, 200, complete(request?.id, 'survived'))
  })
  const result = await call(url)
  assert.equal(result.result.content[0]?.text, 'survived')
  assert.equal(result.cleanup, 'server-managed')
})

test('cleanup cancellation preserves the complete tool result and marks cleanup unconfirmed', async (t) => {
  const controller = new AbortController()
  const url = await endpoint(t, async (req, res, request) => {
    if (req.method === 'DELETE') {
      controller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 40))
      return res.writeHead(204).end()
    }
    if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
    if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': 'cleanup-abort' })
    if (request?.method === 'notifications/initialized') return res.writeHead(202).end()
    return json(res, 200, complete(request?.id, 'kept'))
  })
  const result = await call(url, { q: 'cleanup' }, { signal: controller.signal })
  assert.equal(result.result.content[0]?.text, 'kept')
  assert.equal(result.cleanup, 'unconfirmed')
})

test('cleanup failure preserves a complete tool error result and does not relabel it', async (t) => {
  const url = await endpoint(t, (req, res, request) => {
    if (req.method === 'DELETE') return res.writeHead(500).end()
    if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
    if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': 'cleanup-500' })
    if (request?.method === 'notifications/initialized') return res.writeHead(202).end()
    return json(res, 200, complete(request?.id, 'tool failed', true))
  })
  const result = await call(url, { q: 'failure' })
  assert.equal(result.result.isError, true)
  assert.equal(result.result.content[0]?.text, 'tool failed')
  assert.equal(result.cleanup, 'unconfirmed')
})

test('input_required remains the original uncertain tool error when legacy cleanup also fails', async (t) => {
  const url = await endpoint(t, (req, res, request) => {
    if (req.method === 'DELETE') return res.writeHead(500).end()
    if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
    if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': 'input-cleanup' })
    if (request?.method === 'notifications/initialized') return res.writeHead(202).end()
    return json(res, 200, rpc(request?.id, { resultType: 'input_required', inputRequests: { secret: 'never surfaced' } }))
  })
  await assert.rejects(call(url), (error: unknown) => { assertCallError(error, 'input_required', true); return true })
})

test('tool 404 is uncertain and never reinitializes or retries', async (t) => {
  const methods: string[] = []
  const url = await endpoint(t, (_req, res, request) => {
    methods.push(request?.method ?? '')
    if (request?.method === 'server/discover') return json(res, 200, modernDiscovery(request.id))
    return res.writeHead(404).end()
  })
  await assert.rejects(call(url), (error: unknown) => { assertCallError(error, 'response', true); return true })
  assert.deepEqual(methods, ['server/discover', 'tools/call'])
})

test('legacy tool 404 uses the same private session once and never reinitializes', async (t) => {
  const methods: string[] = []
  const sessionId = 'legacy-404'
  const url = await endpoint(t, (req, res, request) => {
    methods.push(request?.method ?? req.method ?? '')
    if (req.method === 'DELETE') return res.writeHead(204).end()
    if (request?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'legacy' } })
    if (request?.method === 'initialize') return json(res, 200, rpc(request.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': sessionId })
    if (request?.method === 'notifications/initialized') return res.writeHead(202).end()
    assert.equal(request?.method, 'tools/call')
    assert.equal(req.headers['mcp-session-id'], sessionId)
    return res.writeHead(404).end()
  })
  await assert.rejects(call(url), (error: unknown) => { assertCallError(error, 'response', true); return true })
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'DELETE'])
})

test('server-initiated requests are refused during the handshake', async (t) => {
  const url = await endpoint(t, (_req, res, request) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request?.id, method: 'elicitation/create', params: { message: 'do not dispatch' } }))
  })
  await assert.rejects(call(url), (error: unknown) => { assertCallError(error, 'response', false); return true })
})

test('cancelling after the tool reaches the real peer closes its socket and retains uncertainty', { timeout: 5000 }, async (t) => {
  const controller = new AbortController()
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => { closed = resolve })
  const url = await endpoint(t, (req, res, request) => {
    if (request?.method === 'server/discover') return json(res, 200, modernDiscovery(request.id))
    assert.equal(request?.method, 'tools/call')
    req.socket.once('close', closed)
    controller.abort()
  })
  await assert.rejects(call(url, { q: 'abort' }, { signal: controller.signal }), (error: unknown) => { assertCallError(error, 'cancelled', true); return true })
  await disconnected
})

test('an exhausted handshake budget prevents a tool attempt, while an in-flight tool timeout remains uncertain', async () => {
  for (const expiresAtHandshake of [true, false]) {
    const methods: string[] = []
    const budgets: number[] = []
    let time = 0
    const session = createMcpToolSession({ now: () => time, post: async (_endpoint, message, options) => {
      methods.push(message.method)
      budgets.push(options.timeoutMs)
      if (message.method === 'server/discover') {
        time = expiresAtHandshake ? 50 : 42
        return { status: 200, message: modernDiscovery(message.id) }
      }
      assert.equal(message.method, 'tools/call')
      assert.equal(options.timeoutMs, 8)
      time = 50
      throw new McpHttpError('timeout', true)
    } })
    await assert.rejects(session('https://example.com/mcp', { tool, arguments: {} }, { scope: 'public', timeoutMs: 50 }),
      (error) => { assertCallError(error, 'timeout', !expiresAtHandshake); return true })
    assert.deepEqual(methods, expiresAtHandshake ? ['server/discover'] : ['server/discover', 'tools/call'])
    assert.deepEqual(budgets, expiresAtHandshake ? [50] : [50, 8])
  }
})

test('one legacy deadline shrinks across every phase and cleanup expiry preserves a complete tool error', async () => {
  let time = 0
  const methods: string[] = []
  const budgets: number[] = []
  const session = createMcpToolSession({ now: () => time, post: async (_endpoint, message, options) => {
    const method = message?.method ?? 'DELETE'
    methods.push(method)
    budgets.push(options.timeoutMs)
    if (method === 'server/discover') {
      time = 10
      return { status: 400, message: { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'legacy' } } }
    }
    if (method === 'initialize') {
      time = 25
      return { status: 200, sessionId: 'private-session', message: rpc(message.id, {
        protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} },
      }) }
    }
    assert.equal(options.sessionId, 'private-session')
    if (method === 'notifications/initialized') { time = 40; return { status: 202 } }
    if (method === 'tools/call') { time = 80; return { status: 200, message: complete(message.id, 'known failure', true) } }
    assert.equal(method, 'DELETE')
    assert.equal(message, null)
    time = 100
    throw new McpHttpError('timeout', true)
  } })
  const result = await session('https://example.com/mcp', { tool, arguments: {} }, { scope: 'public', timeoutMs: 100 })
  assert.equal(result.result.isError, true)
  assert.equal(result.result.content[0].text, 'known failure')
  assert.equal(result.cleanup, 'unconfirmed')
  assert.doesNotMatch(JSON.stringify(result), /private-session/)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'DELETE'])
  assert.deepEqual(budgets, [100, 90, 75, 60, 20])
})

test('input is snapshotted before a held handshake can observe caller mutation', async (t) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let seen: Body | null = null
  let seenHeaders: IncomingMessage['headers'] | undefined
  const url = await endpoint(t, async (req, res, request) => {
    if (request?.method === 'server/discover') { await held; return json(res, 200, modernDiscovery(request.id)) }
    seen = request
    seenHeaders = req.headers
    return json(res, 200, complete(request?.id, String(request.params.arguments.q)))
  })
  const args = { q: 'before' }
  const invocation = { tool: { name: 'echo', inputSchema: { type: 'object', properties: { q: { type: 'string', 'x-mcp-header': 'Query' } } } }, arguments: args }
  const options = { scope: 'loopback' as const, bearerToken: 'before-token', timeoutMs: 1_000 }
  const pending = createMcpToolSession()(url, invocation, options)
  invocation.tool.name = 'mutated-name'
  invocation.tool.inputSchema.properties.q.type = 'number'
  invocation.tool.inputSchema.properties.q['x-mcp-header'] = 'Changed'
  args.q = 'after'
  options.bearerToken = 'after-token'
  options.scope = 'public'
  release()
  const result = await pending
  assert.equal(result.result.content[0]?.text, 'before')
  assert.equal(seen?.params.name, 'echo')
  assert.equal(seen?.params.arguments.q, 'before')
  assert.equal(seenHeaders?.authorization, 'Bearer before-token')
  assert.equal(seenHeaders?.['mcp-param-query'], 'before')
  assert.equal(seenHeaders?.['mcp-param-changed'], undefined)
})

test('invalid input and pre-aborted calls perform zero network I/O', async () => {
  let calls = 0
  const post = async () => { calls += 1; throw new Error('must not call') }
  const session = createMcpToolSession({ post: post as any })
  await assert.rejects(session('http://127.0.0.1:1/mcp', { tool: { name: '', inputSchema: { type: 'object' } }, arguments: {} }, scope), (error: unknown) => { assertCallError(error, 'request', false); return true })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(session('http://127.0.0.1:1/mcp', { tool, arguments: {} }, { ...scope, signal: controller.signal }), (error: unknown) => { assertCallError(error, 'cancelled', false); return true })
  assert.equal(calls, 0)
})
