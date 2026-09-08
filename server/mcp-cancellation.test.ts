import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'
import { createMcpSession } from './mcpSession.ts'
import { createMcpToolSession } from './mcpToolSession.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { McpHttpError } from './mcpHttpTransport.ts'

type Body = Record<string, any>
type Handler = (req: IncomingMessage, res: ServerResponse, body: Body | null) => void | Promise<void>
const scope = { scope: 'loopback' as const }
const tool = { name: 'echo', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }

function rpc(id: unknown, result: unknown): Record<string, unknown> { return { jsonrpc: '2.0', id, result } }
function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(value))
}
async function readBody(req: IncomingMessage): Promise<Body | null> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) as Body : null
}
async function endpoint(t: { after: (fn: () => void | Promise<void>) => void }, handler: Handler): Promise<string> {
  const server = createServer(async (req, res) => handler(req, res, await readBody(req)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}/mcp`
}

function assertCancelled(error: unknown): void {
  assert.ok(error instanceof McpToolCallError)
  assert.equal(error.code, 'cancelled')
  assert.equal(error.mayHaveExecuted, true)
}

async function legacyFixture(
  t: { after: (fn: () => void | Promise<void>) => void },
  version: string,
  controller: AbortController,
  mode: 'call' | 'list',
  cancellationStatus = 202,
  stateless = false,
) {
  const sessionId = stateless ? undefined : `cancel-${version}`
  const methods: string[] = []
  const requests: Array<{ method: string; body: Body | null; headers: IncomingMessage['headers']; url?: string }> = []
  let resolveCallClosed!: () => void
  const callClosed = new Promise<void>((resolve) => { resolveCallClosed = resolve })
  const url = await endpoint(t, (req, res, body) => {
    const method = body?.method ?? (req.method === 'DELETE' ? 'DELETE' : '')
    methods.push(method)
    requests.push({ method, body, headers: req.headers, url: req.url })
    if (method === 'notifications/cancelled') {
      if (cancellationStatus === 302) return res.writeHead(302, { location: '/elsewhere' }).end()
      return res.writeHead(cancellationStatus).end()
    }
    if (method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: body?.id, error: { code: -32601, message: 'legacy' } })
    if (method === 'initialize') return json(res, 200, rpc(body?.id, { protocolVersion: version, serverInfo: { name: 'cancel-fixture', version: '1' }, capabilities: { tools: {} } }), sessionId ? { 'Mcp-Session-Id': sessionId } : {})
    if (method === 'notifications/initialized') return res.writeHead(202).end()
    if ((mode === 'call' && method === 'tools/call') || (mode === 'list' && method === 'tools/list')) {
      req.socket.once('close', resolveCallClosed)
      controller.abort()
      // Leave the response open: only the client can supply our socket-close
      // proof. Destroying it here would manufacture a passing cancellation.
      return
    }
    return json(res, 500, { error: 'unexpected method' })
  })
  return { url, methods, requests, callClosed, sessionId }
}

function assertNotification(fixture: Awaited<ReturnType<typeof legacyFixture>>, method: string, version: string): void {
  assert.deepEqual(fixture.methods, ['server/discover', 'initialize', 'notifications/initialized', method, 'notifications/cancelled'])
  const original = fixture.requests.find(request => request.method === method)!
  const notification = fixture.requests.at(-1)!
  assert.equal(typeof original.body?.id, 'string')
  assert.deepEqual(notification.body, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: original.body?.id } })
  assert.equal(notification.url, '/mcp')
  for (const request of [original, notification]) {
    assert.equal(request.headers['mcp-session-id'], fixture.sessionId)
    assert.equal(request.headers.authorization, 'Bearer cancel-token')
    assert.equal(request.headers['mcp-protocol-version'], version)
  }
}

test('tools/call cancellation is exact for every legacy version and stateless legacy session', { timeout: 5_000 }, async (t) => {
  for (const [version, stateless] of [...MCP_LEGACY_VERSIONS.map((entry) => [entry, false] as const), [MCP_LEGACY_VERSIONS[0], true] as const]) {
    const controller = new AbortController()
    const fixture = await legacyFixture(t, version, controller, 'call', 202, stateless)
    await assert.rejects(createMcpToolSession()(fixture.url, { tool, arguments: { q: 'cancel' } }, { ...scope, bearerToken: 'cancel-token', signal: controller.signal }), (error: unknown) => { assertCancelled(error); return true })
    await fixture.callClosed
    assertNotification(fixture, 'tools/call', version)
  }
})

test('late peer completion after cancellation cannot replace the original uncertain error', { timeout: 5_000 }, async (t) => {
  const controller = new AbortController()
  const methods: string[] = []
  const requests: Array<{ method: string; body: Body | null; headers: IncomingMessage['headers'] }> = []
  let resolveCancelled!: () => void
  const cancelled = new Promise<void>((resolve) => { resolveCancelled = resolve })
  let resolveOriginalClosed!: () => void
  const originalClosed = new Promise<void>((resolve) => { resolveOriginalClosed = resolve })
  let activeRequestId: unknown
  let lateResultAttempted = false
  const sessionId = 'late-result-session'
  const url = await endpoint(t, async (req, res, body) => {
    const method = body?.method ?? (req.method === 'DELETE' ? 'DELETE' : '')
    methods.push(method)
    requests.push({ method, body, headers: req.headers })
    if (method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: body?.id, error: { code: -32601, message: 'legacy' } })
    if (method === 'initialize') return json(res, 200, rpc(body?.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'late-result', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': sessionId })
    if (method === 'notifications/initialized') return res.writeHead(202).end()
    if (method === 'notifications/cancelled') {
      resolveCancelled()
      return res.writeHead(202).end()
    }
    if (method === 'tools/call') {
      activeRequestId = body?.id
      req.socket.once('close', resolveOriginalClosed)
      controller.abort()
      await cancelled
      lateResultAttempted = true
      try { json(res, 200, rpc(body?.id, { resultType: 'complete', content: [{ type: 'text', text: 'late' }] })) } catch { /* The caller should have closed the original socket. */ }
      return
    }
    return res.writeHead(500).end()
  })
  await assert.rejects(createMcpToolSession()(url, { tool, arguments: { q: 'late' } }, { ...scope, bearerToken: 'cancel-token', signal: controller.signal }), (error: unknown) => { assertCancelled(error); return true })
  await originalClosed
  assert.equal(lateResultAttempted, true)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'notifications/cancelled'])
  assert.deepEqual(requests.at(-1)?.body, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: activeRequestId } })
  assert.equal(requests.at(-1)?.headers['mcp-session-id'], sessionId)
})

test('tools/list cancellation uses the same request id and does not become a tool call', { timeout: 5_000 }, async (t) => {
  const controller = new AbortController()
  const fixture = await legacyFixture(t, MCP_LEGACY_VERSIONS[0], controller, 'list')
  const session = createMcpSession()
  await assert.rejects(session(fixture.url, { ...scope, bearerToken: 'cancel-token', signal: controller.signal }, async (active) => active.listTools()), (error: unknown) => {
    assert.ok(error instanceof McpHttpError)
    assert.equal(error.code, 'cancelled')
    assert.equal(error.mayHaveExecuted, true)
    return true
  })
  await fixture.callClosed
  assertNotification(fixture, 'tools/list', MCP_LEGACY_VERSIONS[0])
})

test('failed cancellation responses preserve the primary cancelled error without replay or cleanup', { timeout: 5_000 }, async (t) => {
  for (const status of [500, 302]) {
    const controller = new AbortController()
    const fixture = await legacyFixture(t, MCP_LEGACY_VERSIONS[1], controller, 'call', status)
    await assert.rejects(createMcpToolSession()(fixture.url, { tool, arguments: { q: 'cancel-failure' } }, { ...scope, bearerToken: 'cancel-token', signal: controller.signal }), (error: unknown) => { assertCancelled(error); return true })
    await fixture.callClosed
    assertNotification(fixture, 'tools/call', MCP_LEGACY_VERSIONS[1])
  }
})

test('pre-aborted and handshake-stage cancellation cannot send notifications/cancelled', { timeout: 5_000 }, async (t) => {
  const controller = new AbortController()
  controller.abort()
  let requests = 0
  const url = await endpoint(t, (_req, _res) => { requests += 1 })
  await assert.rejects(createMcpToolSession()(url, { tool, arguments: {} }, { ...scope, signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof McpToolCallError)
    assert.equal(error.code, 'cancelled')
    assert.equal(error.mayHaveExecuted, false)
    return true
  })
  assert.equal(requests, 0)

  for (const phase of ['initialize', 'notifications/initialized'] as const) {
    const handshakeController = new AbortController()
    const methods: string[] = []
    const handshakeUrl = await endpoint(t, (_req, res, body) => {
      methods.push(body?.method ?? '')
      if (body?.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'legacy' } })
      if (body?.method === phase) { handshakeController.abort(); return res.destroy() }
      if (body?.method === 'initialize') return json(res, 200, rpc(body.id, { protocolVersion: MCP_LEGACY_VERSIONS[0], serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }), { 'Mcp-Session-Id': `handshake-${phase}` })
      return res.writeHead(500).end()
    })
    await assert.rejects(createMcpToolSession()(handshakeUrl, { tool, arguments: {} }, { ...scope, signal: handshakeController.signal }), (error: unknown) => {
      assert.ok(error instanceof McpToolCallError)
      assert.equal(error.code, 'cancelled')
      assert.equal(error.mayHaveExecuted, false)
      return true
    })
    assert.equal(methods.includes('notifications/cancelled'), false)
    assert.equal(methods.includes('tools/call'), false)
  }
})

test('aborting after a completed modern transaction emits no cancellation', async (t) => {
  const controller = new AbortController()
  const methods: string[] = []
  let releaseReply!: () => void
  let resolveCall!: () => void
  const callArrived = new Promise<void>((resolve) => { resolveCall = resolve })
  const replyGate = new Promise<void>((resolve) => { releaseReply = resolve })
  const url = await endpoint(t, async (_req, res, body) => {
    const method = body?.method ?? ''
    methods.push(method)
    if (method === 'server/discover') return json(res, 200, rpc(body?.id, { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }))
    if (method === 'tools/call') {
      resolveCall()
      await replyGate
      return json(res, 200, rpc(body?.id, { resultType: 'complete', content: [{ type: 'text', text: 'done' }] }))
    }
    return res.writeHead(500).end()
  })
  const pending = createMcpToolSession()(url, { tool, arguments: {} }, { ...scope, signal: controller.signal })
  await callArrived
  releaseReply()
  const result = await pending
  controller.abort()
  assert.equal(result.result.content[0]?.text, 'done')
  assert.equal(methods.includes('notifications/cancelled'), false)
})
