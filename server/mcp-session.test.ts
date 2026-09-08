import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpSession, McpSessionError } from './mcpSession.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { createMcpToolSession } from './mcpToolSession.ts'
import { createMcpHttpTransport } from './mcpHttpTransport.ts'

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
