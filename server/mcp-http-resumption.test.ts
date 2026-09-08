import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { Buffer } from 'node:buffer'
import { postMcpHttp, McpHttpError } from './mcpHttpTransport.ts'
import { MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'

type Call = {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Buffer
}

type Peer = {
  endpoint: string
  calls: Call[]
}

const loopback = { scope: 'loopback' as const }
const bearer = 'resume-bearer'
const request = {
  jsonrpc: '2.0', id: 'call-resume', method: 'tools/call',
  params: { name: 'lookup', arguments: { query: 'one' } },
}
const result = {
  jsonrpc: '2.0', id: 'call-resume', result: { content: [{ type: 'text', text: 'ok' }] },
}

function sseFrame(value: string, id?: string, retry?: number): string {
  return `${id === undefined ? '' : `id: ${id}\n`}${retry === undefined ? '' : `retry: ${retry}\n`}data: ${value}\n\n`
}

function priming(id: string): string {
  return `id: ${id}\nretry: 0\ndata:\n\n`
}

function assertHttpError(error: unknown, code = 'response'): asserts error is McpHttpError {
  assert.ok(error instanceof McpHttpError)
  assert.equal(error.code, code)
  assert.equal(error.mayHaveExecuted, true)
}

async function startPeer(t: TestContext, handler: (call: Call, response: ServerResponse, calls: Call[]) => void | Promise<void>): Promise<Peer> {
  const calls: Call[] = []
  const server = createServer((requestMessage, response) => {
    const chunks: Buffer[] = []
    requestMessage.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    requestMessage.on('end', () => {
      const call: Call = {
        method: requestMessage.method ?? '',
        url: requestMessage.url ?? '',
        headers: requestMessage.headers,
        body: Buffer.concat(chunks),
      }
      calls.push(call)
      void Promise.resolve(handler(call, response, calls)).catch(() => response.destroy())
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('resumption peer did not bind')
  return { endpoint: `http://127.0.0.1:${address.port}/mcp?cursor=keep`, calls }
}

function headersFor(call: Call): Record<string, string | undefined> {
  return {
    authorization: call.headers.authorization,
    version: call.headers['mcp-protocol-version'],
    session: call.headers['mcp-session-id'],
    cursor: call.headers['last-event-id'],
  }
}

test('legacy tool calls resume the same request over GET for every supported version, including stateless peers', { timeout: 5_000 }, async (t) => {
  for (const protocolVersion of MCP_LEGACY_VERSIONS) {
    const peer = await startPeer(t, (call, response) => {
      if (call.method === 'POST') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(priming(`first-${protocolVersion ?? 'stateless'}`))
      } else {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(sseFrame(JSON.stringify(result), 'result-1'))
      }
    })
    const options = {
      ...loopback,
      bearerToken: bearer,
      protocolVersion,
    }
    const reply = await postMcpHttp(peer.endpoint, request, options)

    assert.deepEqual(reply.message, result)
    assert.deepEqual(peer.calls.map((call) => call.method), ['POST', 'GET'])
    assert.deepEqual(peer.calls.map((call) => call.url), ['/mcp?cursor=keep', '/mcp?cursor=keep'])
    assert.equal(peer.calls[0]!.body.toString(), JSON.stringify(request))
    assert.equal(peer.calls[1]!.body.byteLength, 0)
    assert.deepEqual(headersFor(peer.calls[0]!), {
      authorization: `Bearer ${bearer}`,
      version: protocolVersion,
      session: undefined,
      cursor: undefined,
    })
    assert.deepEqual(headersFor(peer.calls[1]!), {
      authorization: `Bearer ${bearer}`,
      version: protocolVersion,
      session: undefined,
      cursor: `first-${protocolVersion ?? 'stateless'}`,
    })
  }
})

test('resumption advances across repeated GETs and ignores a partial event id', { timeout: 5_000 }, async (t) => {
  const peer = await startPeer(t, (call, response, calls) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (call.method === 'POST') response.end(`${priming('complete-1')}id: partial\n`)
    else if (calls.filter((entry) => entry.method === 'GET').length === 1) response.end(priming('complete-2'))
    else response.end(sseFrame(JSON.stringify(result), 'complete-3'))
  })
  const reply = await postMcpHttp(peer.endpoint, request, { ...loopback, protocolVersion: MCP_LEGACY_VERSIONS[0], bearerToken: bearer })

  assert.deepEqual(reply.message, result)
  assert.deepEqual(peer.calls.map((call) => call.method), ['POST', 'GET', 'GET'])
  assert.equal(peer.calls[0]!.body.toString(), JSON.stringify(request))
  assert.deepEqual(peer.calls.slice(1).map((call) => call.body.byteLength), [0, 0])
  assert.deepEqual(peer.calls.slice(1).map((call) => call.headers['last-event-id']), ['complete-1', 'complete-2'])
})

test('Unicode SSE ids are sent as their exact UTF-8 bytes in Last-Event-ID', { timeout: 5_000 }, async (t) => {
  const cursor = '✓-😀'
  const peer = await startPeer(t, (call, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(call.method === 'POST' ? priming(cursor) : sseFrame(JSON.stringify(result), 'done'))
  })
  await postMcpHttp(peer.endpoint, request, { ...loopback, protocolVersion: MCP_LEGACY_VERSIONS[1], bearerToken: bearer })

  assert.equal(peer.calls.length, 2)
  assert.equal(peer.calls[1]!.body.byteLength, 0)
  assert.deepEqual(Buffer.from(peer.calls[1]!.headers['last-event-id']!, 'latin1'), Buffer.from(cursor, 'utf8'))
})

test('wrong RPC ids and resumed session ids fail closed without another GET', { timeout: 5_000 }, async (t) => {
  const initialize = {
    jsonrpc: '2.0', id: 'initialize-resume', method: 'initialize', params: { protocolVersion: MCP_LEGACY_VERSIONS[0] },
  }
  const initializeResult = { jsonrpc: '2.0', id: 'initialize-resume', result: { protocolVersion: MCP_LEGACY_VERSIONS[0] } }
  for (const scenario of ['rpc-id', 'session-id'] as const) {
    const peer = await startPeer(t, (call, response) => {
      const sessionId = call.method === 'POST' ? 'session-1' : scenario === 'rpc-id' ? 'session-1' : 'session-wrong'
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': sessionId })
      response.end(call.method === 'POST'
        ? priming(`${scenario}-start`)
        : sseFrame(JSON.stringify(scenario === 'rpc-id' ? { ...initializeResult, id: 'other' } : initializeResult), 'finish'))
    })
    await assert.rejects(
      postMcpHttp(peer.endpoint, initialize, { ...loopback, protocolVersion: MCP_LEGACY_VERSIONS[0] }),
      (error: unknown) => { assertHttpError(error); return true },
    )
    assert.deepEqual(peer.calls.map((call) => call.method), ['POST', 'GET'])
  }
})

test('GET refusal statuses, media, encoding, malformed UTF-8, and server requests never resume again', { timeout: 5_000 }, async (t) => {
  const scenarios: Array<{ name: string; status: number; expectedCode: string; headers?: Record<string, string>; body?: string | Buffer }> = [
    { name: '401', status: 401, expectedCode: 'authentication', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    { name: '403', status: 403, expectedCode: 'authentication', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    { name: 'redirect', status: 307, expectedCode: 'redirect', headers: { Location: 'http://127.0.0.1/never' }, body: '' },
    { name: '404', status: 404, expectedCode: 'response', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    { name: '405', status: 405, expectedCode: 'response', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    { name: 'wrong-media', status: 200, expectedCode: 'response', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) },
    { name: 'encoding', status: 200, expectedCode: 'response', headers: { 'Content-Type': 'text/event-stream', 'Content-Encoding': 'gzip' }, body: sseFrame(JSON.stringify(result), 'done') },
    { name: 'bad-utf8', status: 200, expectedCode: 'response', headers: { 'Content-Type': 'text/event-stream' }, body: Buffer.from([0xc0, 0xaf]) },
    { name: 'server-request', status: 200, expectedCode: 'response', headers: { 'Content-Type': 'text/event-stream' }, body: sseFrame(JSON.stringify({ jsonrpc: '2.0', id: 'server', method: 'tools/call', params: {} }), 'server') },
  ]
  for (const scenario of scenarios) {
    const peer = await startPeer(t, (call, response) => {
      if (call.method === 'POST') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(priming(`start-${scenario.name}`))
        return
      }
      response.writeHead(scenario.status, scenario.headers)
      response.end(scenario.body)
    })
    await assert.rejects(
      postMcpHttp(peer.endpoint, request, { ...loopback, protocolVersion: MCP_LEGACY_VERSIONS[0], bearerToken: bearer }),
      (error: unknown) => { assertHttpError(error, scenario.expectedCode); return true },
    )
    assert.deepEqual(peer.calls.map((call) => call.method), ['POST', 'GET'], scenario.name)
    assert.equal(peer.calls[1]!.body.byteLength, 0, scenario.name)
  }
})

test('modern, unversioned, notification, no-event-id, JSON, and bad-SSE responses never resume', { timeout: 5_000 }, async (t) => {
  const cases: Array<{ name: string; options: Record<string, unknown>; message: Record<string, unknown>; response: (response: ServerResponse) => void; succeeds: boolean }> = [
    {
      name: 'modern',
      options: { protocolVersion: '2026-07-28' },
      message: { ...request, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
      response: (response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`id: modern-start\nretry: 0\n${sseFrame(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }))}`)
      },
      succeeds: false,
    },
    {
      name: 'unversioned', options: {}, message: request,
      response: (response) => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(priming('none')) }, succeeds: false,
    },
    {
      name: 'notification', options: { protocolVersion: MCP_LEGACY_VERSIONS[0] }, message: request,
      response: (response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(sseFrame(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })))
      }, succeeds: false,
    },
    {
      name: 'no-event-id', options: { protocolVersion: MCP_LEGACY_VERSIONS[0] }, message: request,
      response: (response) => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(sseFrame(JSON.stringify(result))) }, succeeds: true,
    },
    {
      name: 'initial-json', options: { protocolVersion: MCP_LEGACY_VERSIONS[0] }, message: request,
      response: (response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)) }, succeeds: true,
    },
    {
      name: 'bad-sse', options: { protocolVersion: MCP_LEGACY_VERSIONS[0] }, message: request,
      response: (response) => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end('data: {not-json}\n\n') }, succeeds: false,
    },
  ]
  for (const scenario of cases) {
    const peer = await startPeer(t, (call, response) => {
      if (call.method === 'POST') scenario.response(response)
      else {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(sseFrame(JSON.stringify(result)))
      }
    })
    const pending = postMcpHttp(peer.endpoint, scenario.message, { ...loopback, bearerToken: bearer, ...scenario.options })
    if (scenario.succeeds) await pending
    else await assert.rejects(pending, (error: unknown) => { assertHttpError(error); return true })
    assert.deepEqual(peer.calls.map((call) => call.method), ['POST'], scenario.name)
  }
})

test('initialize SSE resumption carries the first session id into GET and returns the complete result', { timeout: 5_000 }, async (t) => {
  const initialize = {
    jsonrpc: '2.0', id: 'initialize-1', method: 'initialize', params: { protocolVersion: '2025-11-25' },
  }
  const initializeResult = {
    jsonrpc: '2.0', id: 'initialize-1', result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'peer', version: '1' } },
  }
  const peer = await startPeer(t, (call, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'init-session' })
    response.end(call.method === 'POST' ? priming('init-1') : sseFrame(JSON.stringify(initializeResult), 'init-2'))
  })
  const reply = await postMcpHttp(peer.endpoint, initialize, { ...loopback, protocolVersion: MCP_LEGACY_VERSIONS[0], bearerToken: bearer })

  assert.deepEqual(reply.message, initializeResult)
  assert.equal(reply.sessionId, 'init-session')
  assert.deepEqual(peer.calls.map((call) => call.method), ['POST', 'GET'])
  assert.equal(peer.calls[1]!.body.byteLength, 0)
  assert.deepEqual(headersFor(peer.calls[1]!), {
    authorization: `Bearer ${bearer}`,
    version: MCP_LEGACY_VERSIONS[0],
    session: 'init-session',
    cursor: 'init-1',
  })
})
