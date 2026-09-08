import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import {
  discoverMcpTools,
  MCP_LEGACY_VERSIONS,
  McpDiscoveryError,
} from './mcpDiscovery.ts'
import { McpHttpError } from './mcpHttpTransport.ts'

type Body = Record<string, any>
type Handler = (req: IncomingMessage, res: ServerResponse, body: Body | null) => void | Promise<void>

const scope = { scope: 'loopback' as const }
const bearer = 'private-expiry-bearer'

function rpc(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

function tool(name: string): Record<string, unknown> {
  return { name, inputSchema: { type: 'object', properties: {} } }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
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
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}/mcp?audience=stable`
}

function legacyProbe(body: Body | null): boolean {
  return body?.method === 'server/discover'
}

function initResult(id: unknown, version: string, serverName: string): Record<string, unknown> {
  return rpc(id, {
    protocolVersion: version,
    serverInfo: { name: serverName, version: '1' },
    capabilities: { tools: {} },
  })
}

function assertPrivateHeaders(req: IncomingMessage, url: string): void {
  assert.equal(req.url, new URL(url).pathname + new URL(url).search)
  assert.equal(req.headers.authorization, `Bearer ${bearer}`)
}

test('legacy discovery renews an expired session once and restarts catalog from page one', { timeout: 5_000 }, async (t) => {
  for (const version of MCP_LEGACY_VERSIONS) {
    const calls: Array<{ method: string; session?: string; cursor?: unknown }> = []
    const oldSession = `expired-${version}`
    const newSession = `renewed-${version}`
    let initializeCount = 0
    const url = await endpoint(t, (req, res, body) => {
      assertPrivateHeaders(req, url)
      const method = body?.method ?? req.method ?? ''
      calls.push({ method, session: req.headers['mcp-session-id'], cursor: body?.params?.cursor })
      if (req.method === 'DELETE') return res.writeHead(204).end()
      if (legacyProbe(body)) return json(res, 400, { jsonrpc: '2.0', id: body!.id, error: { code: -32601, message: 'legacy' } })
      if (body?.method === 'initialize') {
        initializeCount += 1
        if (initializeCount === 1) {
          assert.equal(req.headers['mcp-session-id'], undefined)
          return json(res, 200, initResult(body.id, version, 'old-server'), { 'Mcp-Session-Id': oldSession })
        }
        assert.equal(req.headers['mcp-session-id'], undefined, 'renewal must not send expired session')
        return json(res, 200, initResult(body.id, version, 'renewed-server'), { 'Mcp-Session-Id': newSession })
      }
      if (body?.method === 'notifications/initialized') return res.writeHead(202).end()
      if (body?.method === 'tools/list') {
        if (req.headers['mcp-session-id'] === oldSession && body.params?.cursor === undefined) {
          return json(res, 200, rpc(body.id, { tools: [tool('abandoned-first')], nextCursor: 'stale-cursor' }), { 'Mcp-Session-Id': oldSession })
        }
        if (req.headers['mcp-session-id'] === oldSession) return res.writeHead(404).end()
        assert.equal(req.headers['mcp-session-id'], newSession)
        assert.equal(body.params?.cursor, undefined, 'renewal restarts at first page')
        return json(res, 200, rpc(body.id, { tools: [tool('renewed-tool')] }), { 'Mcp-Session-Id': newSession })
      }
      return json(res, 400, { jsonrpc: '2.0', id: body?.id, error: { code: -32601, message: 'unexpected' } })
    })

    const found = await discoverMcpTools(url, { ...scope, bearerToken: bearer })
    assert.equal(found.protocolVersion, version)
    assert.equal(found.serverInfo?.name, 'renewed-server')
    assert.deepEqual(found.tools.map((entry) => entry.name), ['renewed-tool'])
    assert.equal(found.cleanup, 'released')
    assert.equal(initializeCount, 2)
    assert.deepEqual(calls.map((call) => call.method), [
      'server/discover', 'initialize', 'notifications/initialized', 'tools/list',
      'tools/list', 'initialize', 'notifications/initialized', 'tools/list', 'DELETE',
    ])
    const deletes = calls.filter((call) => call.method === 'DELETE')
    assert.deepEqual(deletes.map((call) => call.session), [newSession], 'expired session is never cleaned up')
    for (const secret of [oldSession, newSession, bearer]) assert.ok(!JSON.stringify(found).includes(secret))
  }
})

test('legacy discovery does not renew for a recognizable modern RPC error at HTTP 404', { timeout: 5_000 }, async (t) => {
  const methods: string[] = []
  let initializeCount = 0
  const url = await endpoint(t, (req, res, body) => {
    methods.push(body?.method ?? req.method ?? '')
    if (req.method === 'DELETE') {
      assert.equal(req.headers['mcp-session-id'], 'private-session')
      return res.writeHead(204).end()
    }
    if (legacyProbe(body)) return json(res, 400, { jsonrpc: '2.0', id: body!.id, error: { code: -32601, message: 'legacy' } })
    if (body?.method === 'initialize') {
      initializeCount += 1
      return json(res, 200, initResult(body.id, MCP_LEGACY_VERSIONS[0], 'legacy'), { 'Mcp-Session-Id': 'private-session' })
    }
    if (body?.method === 'notifications/initialized') return res.writeHead(202).end()
    return json(res, 404, { jsonrpc: '2.0', id: body?.id, error: { code: -32020, message: 'modern refusal' } })
  })
  await assert.rejects(discoverMcpTools(url, { ...scope, bearerToken: bearer }), (error: unknown) => {
    assert.ok(error instanceof McpDiscoveryError)
    assert.equal(error.code, 'protocol')
    return true
  })
  assert.equal(initializeCount, 1)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'DELETE'])
})

test('a correlated legacy HTTP 404 also renews once, retaining the endpoint and bearer', { timeout: 5_000 }, async (t) => {
  const methods: string[] = []
  const sessions: Array<string | undefined> = []
  let initializeCount = 0
  const oldSession = 'correlated-old-session'
  const newSession = 'correlated-new-session'
  const url = await endpoint(t, (req, res, body) => {
    assertPrivateHeaders(req, url)
    const method = body?.method ?? req.method ?? ''
    methods.push(method)
    sessions.push(req.headers['mcp-session-id'])
    if (req.method === 'DELETE') {
      assert.equal(req.headers['mcp-session-id'], newSession)
      return res.writeHead(204).end()
    }
    if (legacyProbe(body)) return json(res, 400, { jsonrpc: '2.0', id: body!.id, error: { code: -32601, message: 'legacy' } })
    if (body?.method === 'initialize') {
      initializeCount += 1
      return json(res, 200, initResult(body.id, MCP_LEGACY_VERSIONS[0], initializeCount === 1 ? 'old' : 'new'), { 'Mcp-Session-Id': initializeCount === 1 ? oldSession : newSession })
    }
    if (body?.method === 'notifications/initialized') return res.writeHead(202).end()
    if (body?.method === 'tools/list' && req.headers['mcp-session-id'] === oldSession && body.params?.cursor === undefined) {
      return json(res, 200, rpc(body.id, { tools: [tool('abandoned')], nextCursor: 'expired' }), { 'Mcp-Session-Id': oldSession })
    }
    if (body?.method === 'tools/list' && req.headers['mcp-session-id'] === oldSession) {
      return json(res, 404, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'expired legacy session' } })
    }
    assert.equal(req.headers['mcp-session-id'], newSession)
    return json(res, 200, rpc(body?.id, { tools: [tool('replacement')] }), { 'Mcp-Session-Id': newSession })
  })
  const found = await discoverMcpTools(url, { ...scope, bearerToken: bearer })
  assert.deepEqual(found.tools.map((entry) => entry.name), ['replacement'])
  assert.equal(found.cleanup, 'released')
  assert.equal(initializeCount, 2)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'initialize', 'notifications/initialized', 'tools/list', 'DELETE'])
  assert.equal(sessions.at(-1), newSession)
})

test('stateless HTTP 404 and authentication failures never renew a legacy discovery', { timeout: 5_000 }, async (t) => {
  for (const mode of ['stateless', 'authentication'] as const) {
    const methods: string[] = []
    let initializeCount = 0
    const url = await endpoint(t, (_req, res, body) => {
      methods.push(body?.method ?? _req.method ?? '')
      if (_req.method === 'DELETE') return res.writeHead(204).end()
      if (legacyProbe(body)) return json(res, 400, { jsonrpc: '2.0', id: body!.id, error: { code: -32601, message: 'legacy' } })
      if (body?.method === 'initialize') {
        initializeCount += 1
        return json(res, 200, initResult(body.id, MCP_LEGACY_VERSIONS[0], 'stateless'), mode === 'stateless' ? {} : { 'Mcp-Session-Id': 'private-session' })
      }
      if (body?.method === 'notifications/initialized') return res.writeHead(202).end()
      return res.writeHead(mode === 'stateless' ? 404 : 401).end()
    })
    await assert.rejects(discoverMcpTools(url, { ...scope, bearerToken: bearer }), (error: unknown) => {
      assert.ok(error instanceof McpHttpError)
      assert.equal(error.code, mode === 'stateless' ? 'response' : 'authentication')
      return true
    })
    assert.equal(initializeCount, 1)
    assert.deepEqual(methods, mode === 'stateless'
      ? ['server/discover', 'initialize', 'notifications/initialized', 'tools/list']
      : ['server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'DELETE'])
  }
})

test('a second legacy HTTP 404 fails without a third initialize or old-session cleanup', { timeout: 5_000 }, async (t) => {
  const methods: string[] = []
  const sessions: Array<string | undefined> = []
  let initializeCount = 0
  let oldListCount = 0
  const oldSession = 'old-session'
  const newSession = 'new-session'
  const url = await endpoint(t, (req, res, body) => {
    const method = body?.method ?? 'DELETE'
    methods.push(method)
    sessions.push(req.headers['mcp-session-id'])
    if (method === 'DELETE') return res.writeHead(204).end()
    if (legacyProbe(body)) return json(res, 400, { jsonrpc: '2.0', id: body!.id, error: { code: -32601, message: 'legacy' } })
    if (body?.method === 'initialize') {
      initializeCount += 1
      return json(res, 200, initResult(body.id, MCP_LEGACY_VERSIONS[0], 'legacy'), { 'Mcp-Session-Id': initializeCount === 1 ? oldSession : newSession })
    }
    if (body?.method === 'notifications/initialized') return res.writeHead(202).end()
    if (body?.method === 'tools/list' && req.headers['mcp-session-id'] === oldSession && oldListCount++ === 0) {
      return json(res, 200, rpc(body.id, { tools: [tool('old')], nextCursor: 'old-next' }), { 'Mcp-Session-Id': oldSession })
    }
    return res.writeHead(404).end()
  })
  await assert.rejects(discoverMcpTools(url, { ...scope, bearerToken: bearer }), (error: unknown) => {
    assert.ok(error instanceof McpDiscoveryError)
    assert.equal(error.code, 'session_expired')
    return true
  })
  assert.equal(initializeCount, 2)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'initialize', 'notifications/initialized', 'tools/list'])
  assert.ok(sessions.includes(oldSession))
  assert.equal(methods.includes('DELETE'), false)
})
