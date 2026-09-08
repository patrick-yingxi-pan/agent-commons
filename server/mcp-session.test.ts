import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpSession, McpSessionError } from './mcpSession.ts'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { createMcpToolSession } from './mcpToolSession.ts'
import { createMcpHttpTransport, McpHttpError } from './mcpHttpTransport.ts'

const invocation = { tool: { name: 'lookup', inputSchema: { type: 'object' } }, arguments: {} }
function fixture() {
  const methods: string[] = []
  const withSession = createMcpSession({ post: async (_endpoint, message) => {
    methods.push(message.method)
    const result = message.method === 'server/discover' ? { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
      : message.method === 'tools/list' ? { tools: [] } : { resultType: 'complete', content: [] }
    return { status: 200, message: { jsonrpc: '2.0', id: message.id, result } }
  } })
  return { withSession, methods }
}

test('an escaped internal session facade loses all request authority when its scope closes', async () => {
  const { withSession, methods } = fixture()
  let retained
  const result = await withSession('https://example.com/mcp', { scope: 'public', bearerToken: 'private-token' }, async (session) => {
    retained = session
    return session.listTools()
  })
  assert.deepEqual(result, { protocolVersion: MCP_MODERN_VERSION, value: { tools: [] }, cleanup: 'not-needed' })
  assert.deepEqual(Object.keys(retained).sort(), ['callTool', 'listTools', 'protocolVersion'])
  await assert.rejects(retained.listTools(), McpSessionError)
  await assert.rejects(retained.callTool(invocation), (error) => error instanceof McpToolCallError && error.code === 'request' && error.mayHaveExecuted === false)
  assert.deepEqual(methods, ['server/discover', 'tools/list'])
})

test('one session scope cannot replay a tool or refresh its catalog after the attempt', async () => {
  const { withSession, methods } = fixture()
  const completed = await withSession('https://example.com/mcp', { scope: 'public' }, async (session) => {
    const result = await session.callTool(invocation)
    await assert.rejects(session.callTool(invocation), McpToolCallError)
    await assert.rejects(session.listTools(), McpSessionError)
    return result
  })
  assert.equal(completed.value.isError, false)
  assert.deepEqual(methods, ['server/discover', 'tools/call'])
})

test('tool DNS cancellation is definitely unsent even after a successful submitted handshake', async () => {
  let resolving
  let release
  let sockets = 0
  const observed = new Promise((resolve) => { resolving = resolve })
  const held = new Promise((resolve) => { release = resolve })
  const transport = createMcpHttpTransport({
    resolve: async () => { resolving(); return held }, https: () => { sockets++; throw new Error('must not connect') },
  })
  const call = createMcpToolSession({ post: (endpoint, message, options) => message.method === 'server/discover'
    ? Promise.resolve({ status: 200, message: { jsonrpc: '2.0', id: message.id,
      result: { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } } } })
    : transport(endpoint, message, options) })
  const controller = new AbortController()
  const pending = call('https://example.com/mcp', invocation, { scope: 'public', signal: controller.signal })
  await observed
  controller.abort()
  await assert.rejects(pending, (error) => error instanceof McpToolCallError && error.code === 'cancelled' && error.mayHaveExecuted === false)
  release([{ address: '93.184.216.34', family: 4 }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sockets, 0)
})

function legacyHandshake(message) {
  if (message?.method === 'server/discover') return { status: 400, message: { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'legacy' } } }
  if (message?.method === 'initialize') return { status: 200, sessionId: 'private-session', message: { jsonrpc: '2.0', id: message.id,
    result: { protocolVersion: MCP_LEGACY_VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } } }
  if (message?.method === 'notifications/initialized') return { status: 202 }
}

test('legacy tool DNS cancellation does not send a cancellation notification for an unsent request', async () => {
  const controller = new AbortController()
  const methods = []
  let resolving
  let release
  let sockets = 0
  const observed = new Promise(resolve => { resolving = resolve })
  const held = new Promise(resolve => { release = resolve })
  const transport = createMcpHttpTransport({
    resolve: async () => { resolving(); return held }, https: () => { sockets++; throw new Error('must not connect') },
  })
  const call = createMcpToolSession({ post: (endpoint, message, options) => {
    methods.push(message?.method ?? 'DELETE')
    const handshake = legacyHandshake(message)
    return handshake ? Promise.resolve(handshake) : transport(endpoint, message, options)
  } })
  const pending = call('https://example.com/mcp', invocation, { scope: 'public', signal: controller.signal })
  await observed
  controller.abort()
  await assert.rejects(pending, error => error instanceof McpToolCallError && error.code === 'cancelled' && error.mayHaveExecuted === false)
  release([{ address: '93.184.216.34', family: 4 }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sockets, 0)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call'])
})

test('legacy cancellation uses only the remaining transaction budget and never carries tool parameters', async () => {
  const controller = new AbortController()
  const methods = []
  let clock = 0
  let callId
  let notification
  const call = createMcpToolSession({ now: () => clock, post: async (endpoint, message, options) => {
    methods.push(message?.method ?? 'DELETE')
    const handshake = legacyHandshake(message)
    if (handshake) return handshake
    if (message?.method === 'tools/call') {
      callId = message.id
      clock = 29_925
      controller.abort()
      throw new McpHttpError('cancelled', true)
    }
    notification = { endpoint, message, options, abortedAtStart: options.signal.aborted }
    return { status: 202 }
  } })
  await assert.rejects(call('https://example.com/mcp', invocation, { scope: 'public', signal: controller.signal, bearerToken: 'private-bearer' }),
    error => error instanceof McpToolCallError && error.code === 'cancelled' && error.mayHaveExecuted === true)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'notifications/cancelled'])
  // Assert outside the injected cancellation post: notification failure is
  // deliberately swallowed, so an assertion thrown there is not a test lock.
  assert.deepEqual(notification.message, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: callId } })
  assert.equal(notification.endpoint, 'https://example.com/mcp')
  assert.equal(notification.options.scope, 'public')
  assert.equal(notification.options.bearerToken, 'private-bearer')
  assert.equal(notification.options.sessionId, 'private-session')
  assert.equal(notification.options.protocolVersion, MCP_LEGACY_VERSIONS[0])
  assert.equal(notification.abortedAtStart, false)
  assert.notEqual(notification.options.signal, controller.signal)
  assert.equal(notification.options.timeoutMs, 75)
  assert.equal(notification.options.toolInputSchema, undefined)
})

test('a spent absolute deadline cannot start legacy cancellation traffic', async () => {
  const controller = new AbortController()
  const methods = []
  let clock = 0
  const call = createMcpToolSession({ now: () => clock, post: async (_endpoint, message) => {
    methods.push(message?.method ?? 'DELETE')
    const handshake = legacyHandshake(message)
    if (handshake) return handshake
    assert.equal(message?.method, 'tools/call')
    clock = 30_000
    controller.abort()
    throw new McpHttpError('cancelled', true)
  } })
  await assert.rejects(call('https://example.com/mcp', invocation, { scope: 'public', signal: controller.signal }),
    error => error instanceof McpToolCallError && error.code === 'cancelled' && error.mayHaveExecuted === true)
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call'])
})

test('deadline expiry while delivering cancellation cannot replace the original user-cancel outcome', { timeout: 5000 }, async () => {
  const controller = new AbortController()
  let cancellationStarted = false
  let cancellationClosed = false
  const call = createMcpToolSession({ now: () => 0, post: async (_endpoint, message, options) => {
    const handshake = legacyHandshake(message)
    if (handshake) return handshake
    if (message?.method === 'tools/call') {
      controller.abort()
      throw new McpHttpError('cancelled', true)
    }
    assert.equal(message?.method, 'notifications/cancelled')
    assert.equal(options.timeoutMs, 1000, 'Cancellation has its own ceiling inside the total budget.')
    assert.equal(options.signal.aborted, false)
    cancellationStarted = true
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
      cancellationClosed = true
      reject(new McpHttpError('cancelled', true))
    }, { once: true }))
  } })
  await assert.rejects(call('https://example.com/mcp', invocation, { scope: 'public', signal: controller.signal, timeoutMs: 1000 }),
    error => error instanceof McpToolCallError && error.code === 'cancelled' && error.mayHaveExecuted === true)
  assert.equal(cancellationStarted, true)
  assert.equal(cancellationClosed, true, 'The control POST must finish before the transaction returns.')
})

test('a fulfilled legacy tool response wins a queued caller abort without cancellation or DELETE', async () => {
  const controller = new AbortController()
  const methods = []
  const call = createMcpToolSession({ post: (_endpoint, message) => {
    methods.push(message?.method ?? 'DELETE')
    const handshake = legacyHandshake(message)
    if (handshake) return Promise.resolve(handshake)
    const reply = Promise.resolve({ status: 200, message: { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'known complete result' }] } } })
    queueMicrotask(() => controller.abort())
    return reply
  } })
  const result = await call('https://example.com/mcp', invocation, { scope: 'public', signal: controller.signal })
  assert.equal(result.result.content[0].text, 'known complete result')
  assert.equal(result.cleanup, 'unconfirmed')
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call'])
})
