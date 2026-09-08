import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once, EventEmitter } from 'node:events'
import { createServer as createHttpsServer } from 'node:https'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createMcpHttpTransport, postMcpHttp, McpHttpError } from './mcpHttpTransport.ts'
import { MAX_MCP_RESPONSE_BYTES } from './mcpHttpResponse.ts'

const request = { jsonrpc: '2.0', id: 'call-1', method: 'tools/list', params: {} }
const success = { jsonrpc: '2.0', id: 'call-1', result: { tools: [] } }
const loopback = { scope: 'loopback' as const }
const failure = (code: string, mayHaveExecuted: boolean) => (error: unknown) => {
  assert.ok(error instanceof McpHttpError)
  assert.equal(error.code, code)
  assert.equal(error.mayHaveExecuted, mayHaveExecuted)
  assert.doesNotMatch(error.stack!, /secret|credential|private\/|169\.254|upstream detail/)
  return true
}
async function endpoint(t, handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  return `http://127.0.0.1:${server.address().port}/mcp?private=not-for-errors`
}

test('real HTTP POST sends exact bounded JSON and scoped headers, then accepts its correlated result', async (t) => {
  let received
  const url = await endpoint(t, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      received = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' })
      res.end(JSON.stringify(success))
    })
  })
  assert.deepEqual(await postMcpHttp(url, request, { ...loopback, protocolVersion: '2025-11-25', sessionId: 'session-0', bearerToken: 'secret-token' }), {
    status: 200, sessionId: 'session-1', message: success,
  })
  assert.deepEqual(received.body, request)
  assert.equal(received.method, 'POST')
  assert.equal(received.headers.accept, 'application/json, text/event-stream')
  assert.equal(received.headers['accept-encoding'], 'identity')
  assert.equal(received.headers.authorization, 'Bearer secret-token')
  assert.equal(received.headers['mcp-protocol-version'], '2025-11-25')
  assert.equal(received.headers['mcp-session-id'], 'session-0')
  assert.equal(received.headers.cookie, undefined)
})

test('real SSE accepts notifications and split UTF-8, settles at the response, and closes an open stream', { timeout: 5_000 }, async (t) => {
  let closed!: () => void
  const observedClose = new Promise<void>((resolve) => { closed = resolve })
  const url = await endpoint(t, (_req, res) => {
    res.on('close', closed)
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    res.write('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\n')
    const packet = Buffer.from(`data: ${JSON.stringify({ ...success, result: { text: 'café 世界 😀' } })}\n\n`)
    for (const byte of packet) res.write(Buffer.from([byte]))
    // Deliberately do not end: the matching response, not EOF, settles MCP.
  })
  const reply = await postMcpHttp(url, request, loopback)
  assert.deepEqual(reply.message?.result, { text: 'café 世界 😀' })
  await observedClose
})

test('request and options are snapshots even when the caller mutates them during asynchronous setup', async (t) => {
  let received
  const url = await endpoint(t, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString())
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(success))
    })
  })
  const input = { ...request, params: { name: 'original' } }
  const options = { scope: 'loopback' as 'loopback' | 'public' }
  const pending = postMcpHttp(url, input, options)
  input.id = 'changed'
  input.params.name = 'changed'
  options.scope = 'public'
  assert.deepEqual((await pending).message, success)
  assert.equal(received.id, 'call-1')
  assert.equal(received.params.name, 'original')
})

test('real HTTPS refuses an untrusted certificate without sending the request or bearer', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-test-tls-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const key = join(root, 'key.pem')
  const cert = join(root, 'cert.pem')
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'])
  assert.equal(generated.status, 0, 'test-only local TLS certificate generated')
  let requests = 0
  const server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => { requests++; res.end('unexpected') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  try {
    // Even a permissive parent environment must not disable this boundary.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    await assert.rejects(postMcpHttp(`https://127.0.0.1:${server.address().port}/mcp`, request, { ...loopback, bearerToken: 'secret-token' }), failure('network', true))
  } finally {
    if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting
  }
  assert.equal(requests, 0, 'TLS refusal happened before HTTP headers/body reached the server')
})

test('notifications accept only HTTP 202, while requests require a complete correlated RPC response', async (t) => {
  let status = 202
  let body = ''
  const url = await endpoint(t, (_req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body) })
  assert.deepEqual(await postMcpHttp(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, loopback), { status: 202 })
  await assert.rejects(postMcpHttp(url, request, loopback), failure('response', true))
  status = 200
  body = JSON.stringify({ ...success, id: 'different-call' })
  await assert.rejects(postMcpHttp(url, request, loopback), failure('response', true))
  await assert.rejects(postMcpHttp(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, loopback), failure('response', true))
})

test('redirects and authentication challenges never follow a second URL or leak upstream content', async (t) => {
  let destinationHits = 0
  const destination = await endpoint(t, (_req, res) => { destinationHits++; res.end('must not run') })
  let status = 307
  const url = await endpoint(t, (_req, res) => {
    res.writeHead(status, { Location: destination, 'Content-Type': 'application/json' })
    res.end('{"upstream detail":"credential=secret"}')
  })
  await assert.rejects(postMcpHttp(url, request, loopback), failure('redirect', true))
  status = 401
  await assert.rejects(postMcpHttp(url, request, loopback), failure('authentication', true))
  assert.equal(destinationHits, 0)
})

test('HTTP failures cannot smuggle a successful tool result through JSON or SSE', async (t) => {
  let sse = false
  const url = await endpoint(t, (_req, res) => {
    res.writeHead(500, { 'Content-Type': sse ? 'text/event-stream' : 'application/json' })
    res.end(sse ? `data: ${JSON.stringify(success)}\n\n` : JSON.stringify(success))
  })
  await assert.rejects(postMcpHttp(url, request, loopback), failure('response', true))
  sse = true
  await assert.rejects(postMcpHttp(url, request, loopback), failure('response', true))
})

test('bounds declared and streamed response bytes, refuses compression and invalid UTF-8', async (t) => {
  let kind = 'declared'
  const url = await endpoint(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json',
      ...(kind === 'declared' ? { 'Content-Length': String(MAX_MCP_RESPONSE_BYTES + 1) } : {}),
      ...(kind === 'compressed' ? { 'Content-Encoding': 'gzip' } : {}),
    })
    if (kind === 'streamed') res.end('x'.repeat(MAX_MCP_RESPONSE_BYTES + 1))
    else if (kind === 'utf8') res.end(Buffer.from([0xc0, 0xaf]))
    else res.end(JSON.stringify(success))
  })
  for (kind of ['declared', 'streamed', 'compressed', 'utf8']) {
    await assert.rejects(postMcpHttp(url, request, loopback), failure('response', true))
  }
})

test('a stalled call times out, closes the real socket, and reports uncertain execution without retrying', { timeout: 5_000 }, async (t) => {
  let calls = 0
  let observed!: () => void
  const arrived = new Promise<void>((resolve) => { observed = resolve })
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => { closed = resolve })
  const url = await endpoint(t, (req) => { calls++; req.socket.on('close', closed); observed() })
  const pending = postMcpHttp(url, request, { ...loopback, timeoutMs: 200 })
  await arrived
  await assert.rejects(pending, failure('timeout', true))
  await disconnected
  assert.equal(calls, 1)
})

test('caller cancellation closes a live response; pre-abort and header injection cause no network work', async (t) => {
  let calls = 0
  let observed!: () => void
  const arrived = new Promise<void>((resolve) => { observed = resolve })
  const url = await endpoint(t, (_req, res) => { calls++; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders(); observed() })
  const controller = new AbortController()
  const pending = postMcpHttp(url, request, { ...loopback, signal: controller.signal })
  await arrived
  controller.abort('credential=secret')
  await assert.rejects(pending, failure('cancelled', true))
  await assert.rejects(postMcpHttp(url, request, { ...loopback, signal: controller.signal }), failure('cancelled', false))
  await assert.rejects(postMcpHttp(url, request, { ...loopback, bearerToken: 'x\r\nCookie: bad' }), failure('request', false))
  assert.equal(calls, 1)
})

test('DNS answers are all validated and the actual socket uses the admitted address without a second resolution', async () => {
  let resolutions = 0
  let sockets = 0
  const transport = createMcpHttpTransport({
    resolve: async () => { resolutions++; return [{ address: '93.184.216.34', family: 4 }] },
    https: (url, options, _callback) => {
      sockets++
      assert.equal(url.hostname, 'example.com', 'TLS identity remains the original hostname')
      assert.equal(options.agent, false, 'no shared environment-proxy/pooling agent')
      assert.equal(options.autoSelectFamily, false)
      assert.equal(options.rejectUnauthorized, true, 'TLS verification is required independently of the environment')
      options.lookup(url.hostname, {}, (error, address, family) => {
        assert.equal(error, null)
        assert.equal(address, '93.184.216.34')
        assert.equal(family, 4)
      })
      const req = new EventEmitter()
      req.destroy = () => {}
      req.end = () => { queueMicrotask(() => req.emit('error', new Error('upstream detail secret'))) }
      return req
    },
  })
  await assert.rejects(transport('https://example.com/mcp', request, { scope: 'public' }), failure('network', true))
  assert.equal(resolutions, 1)
  assert.equal(sockets, 1)
  for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]]) {
    const denied = createMcpHttpTransport({ resolve: async () => addresses, https: () => { throw new Error('must not open a socket') } })
    await assert.rejects(denied('https://example.com/mcp', request, { scope: 'public' }), failure('destination', false))
  }
})

test('DNS has the same deadline and a late answer cannot start network work', async () => {
  let release!: (value: Array<{ address: string; family: number }>) => void
  let sockets = 0
  const transport = createMcpHttpTransport({
    resolve: () => new Promise((resolve) => { release = resolve }),
    https: () => { sockets++; throw new Error('late request') },
  })
  await assert.rejects(transport('https://example.com/mcp', request, { scope: 'public', timeoutMs: 15 }), failure('timeout', false))
  release([{ address: '93.184.216.34', family: 4 }])
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(sockets, 0)
})

test('modern discovery mirrors its method and version without accepting caller-defined headers', async (t) => {
  let calls = 0
  const url = await endpoint(t, (req, res) => {
    calls++
    assert.equal(req.headers['mcp-method'], 'tools/list')
    assert.equal(req.headers['mcp-protocol-version'], '2026-07-28')
    assert.equal(req.headers['mcp-session-id'], undefined)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(success))
  })
  const modern = { ...request, params: { _meta: {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
  } } }
  const options = { ...loopback, protocolVersion: '2026-07-28' }
  await postMcpHttp(url, modern, options)
  await assert.rejects(postMcpHttp(url, request, options), failure('request', false))
  await assert.rejects(postMcpHttp(url, modern, { ...options, sessionId: 'legacy-credential' }), failure('request', false))
  await assert.rejects(postMcpHttp(url, { ...modern, method: 'tools/call' }, options), failure('request', false))
  assert.equal(calls, 1, 'only supported discovery metadata reaches the network')
})

test('explicit legacy session cleanup uses DELETE with no RPC body and no redirects', async (t) => {
  let calls = 0
  let status = 204
  const url = await endpoint(t, (req, res) => {
    calls++
    assert.equal(req.method, 'DELETE')
    assert.equal(req.headers['mcp-session-id'], 'session-to-close')
    assert.equal(req.headers['content-length'], '0')
    req.on('data', () => assert.fail('cleanup has no RPC body'))
    req.on('end', () => { res.writeHead(status, { Location: 'http://127.0.0.1/never-follow' }); res.end() })
  })
  const options = { ...loopback, protocolVersion: '2025-11-25', sessionId: 'session-to-close' }
  for (status of [204, 404, 405]) assert.deepEqual(await postMcpHttp(url, null, options), { status })
  status = 307
  await assert.rejects(postMcpHttp(url, null, options), failure('redirect', true))
  await assert.rejects(postMcpHttp(url, null, loopback), failure('request', false))
  assert.equal(calls, 4)
})

test('HTTP error metadata allows an unread request id without relaxing successful response correlation', async (t) => {
  let status = 400
  const error = { jsonrpc: '2.0', error: { code: -32022, message: 'unsupported', data: { supported: ['2025-11-25'], requested: '2026-07-28' } } }
  const url = await endpoint(t, (_req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(error)) })
  assert.deepEqual((await postMcpHttp(url, request, loopback)).message, error)
  status = 200
  await assert.rejects(postMcpHttp(url, request, loopback), failure('response', true))
})
