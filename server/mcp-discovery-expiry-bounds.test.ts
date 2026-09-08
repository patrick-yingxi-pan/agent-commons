import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpDiscovery, McpDiscoveryError, MAX_MCP_DISCOVERY_PAGES } from './mcpDiscovery.ts'
import { createMcpSession, McpSessionError } from './mcpSession.ts'
import { McpHttpError } from './mcpHttpTransport.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION } from './mcpProtocol.ts'

const endpoint = 'https://example.com/mcp?audience=exact'
const options = { scope: 'public' as const, bearerToken: 'private-bearer', timeoutMs: 1_000 }
const tool = (name: string) => ({ name, inputSchema: { type: 'object' } })
const result = (message, value) => ({ status: 200, message: { jsonrpc: '2.0', id: message.id, result: value } })
const expired = () => new McpHttpError('response', true, 404)
const isExpired = error => error instanceof McpSessionError && error.code === 'session_expired'
const isCatalog = error => error instanceof McpDiscoveryError && error.code === 'catalog'

function peer(list, { initialize = undefined, now = () => 0, step = () => {} } = {}) {
  const calls = []
  let generation = 0
  const post = async (url, message, input) => {
    calls.push({ url, message, input: { ...input }, method: message?.method ?? 'DELETE' })
    step()
    if (!message) return { status: 204 }
    if (message.method === 'server/discover') return { status: 400, message: { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'legacy' } } }
    if (message.method === 'initialize') {
      generation++
      return initialize?.(message, generation) ?? {
        ...result(message, { protocolVersion: MCP_LEGACY_VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: `server-${generation}`, version: '1' } }),
        sessionId: `private-session-${generation}`,
      }
    }
    if (message.method === 'notifications/initialized') return { status: 202 }
    assert.equal(message.method, 'tools/list')
    return list(message, generation)
  }
  return { calls, discover: createMcpDiscovery({ post, now }), withSession: createMcpSession({ post, now }) }
}

test('expiry renewal shares one diminishing deadline, audience, authority and fresh request identity', async () => {
  let clock = 0
  const fixture = peer((message, generation) => {
    if (generation === 1 && message.params.cursor) throw expired()
    return result(message, generation === 1 ? { tools: [tool('old')], nextCursor: 'old-cursor' } : { tools: [tool('new')] })
  }, { now: () => clock, step: () => { clock += 50 } })
  const found = await fixture.discover(endpoint, options)
  assert.deepEqual(found.tools.map(tool => tool.name), ['new'])
  assert.deepEqual(fixture.calls.map(call => call.method), [
    'server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'tools/list',
    'initialize', 'notifications/initialized', 'tools/list', 'DELETE',
  ])
  assert.deepEqual(fixture.calls.map(call => call.input.timeoutMs), [1000, 950, 900, 850, 800, 750, 700, 650, 600])
  assert.deepEqual(fixture.calls.map(call => call.input.sessionId), [undefined, undefined, 'private-session-1', 'private-session-1', 'private-session-1', undefined, 'private-session-2', 'private-session-2', 'private-session-2'])
  for (const call of fixture.calls) {
    assert.equal(call.url, endpoint)
    assert.equal(call.input.bearerToken, options.bearerToken)
    assert.equal(call.input.scope, options.scope)
    assert.equal(call.input.signal, fixture.calls[0].input.signal)
    assert.equal(call.input.protocolVersion, call.method === 'server/discover' ? MCP_MODERN_VERSION : MCP_LEGACY_VERSIONS[0])
  }
  const ids = fixture.calls.flatMap(call => call.message?.id ? [call.message.id] : [])
  assert.equal(ids.length, 6)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(fixture.calls[7].message.params.cursor, undefined)
  for (const secret of ['private-session-1', 'private-session-2', options.bearerToken]) assert.ok(!JSON.stringify(found).includes(secret))
})

test('cancellation or deadline exhaustion at expiry cannot start a replacement handshake', async () => {
  for (const mode of ['cancelled', 'timeout']) {
    const controller = new AbortController()
    let clock = 0
    const fixture = peer(() => {
      if (mode === 'cancelled') controller.abort()
      else clock = options.timeoutMs
      throw expired()
    }, { now: () => clock })
    await assert.rejects(fixture.discover(endpoint, { ...options, signal: controller.signal }), error => error instanceof McpHttpError && error.code === mode)
    assert.deepEqual(fixture.calls.map(call => call.method), ['server/discover', 'initialize', 'notifications/initialized', 'tools/list'])
  }
})

test('a replacement catalog may reuse old tool names and cursors without carrying old pages', async () => {
  const fixture = peer((message, generation) => {
    if (message.params.cursor) {
      if (generation === 1) throw expired()
      return result(message, { tools: [tool('last')] })
    }
    return result(message, { tools: [{ ...tool('same'), description: `generation-${generation}` }], nextCursor: 'same-cursor' })
  })
  const found = await fixture.discover(endpoint, options)
  assert.deepEqual(found.tools.map(tool => [tool.name, tool.description]), [['same', 'generation-2'], ['last', undefined]])
  assert.equal(fixture.calls.filter(call => call.method === 'tools/list').length, 4)
})

test('catalog page attempts remain cumulative across expiry, including the failed page', async () => {
  let pages = 0
  const fixture = peer((message, generation) => {
    pages++
    if (pages === 3) throw expired()
    return result(message, { tools: [tool(`tool-${pages}`)], nextCursor: `cursor-${generation}-${pages}` })
  })
  await assert.rejects(fixture.discover(endpoint, options), isCatalog)
  assert.equal(pages, MAX_MCP_DISCOVERY_PAGES)
  assert.equal(fixture.calls.filter(call => call.method === 'initialize').length, 2)
  assert.equal(fixture.calls.at(-1).input.sessionId, 'private-session-2')
})

test('expiry at the last catalog attempt does not open an unusable replacement session', async () => {
  let pages = 0
  const fixture = peer(message => {
    if (++pages === MAX_MCP_DISCOVERY_PAGES) throw expired()
    return result(message, { tools: [], nextCursor: `page-${pages}` })
  })
  await assert.rejects(fixture.discover(endpoint, options), isCatalog)
  assert.equal(pages, MAX_MCP_DISCOVERY_PAGES)
  assert.equal(fixture.calls.filter(call => call.method === 'initialize').length, 1)
  assert.equal(fixture.calls.filter(call => call.method === 'DELETE').length, 0)
})

test('catalog byte and tool budgets cannot be replenished by expiry', async () => {
  for (const budget of ['bytes', 'tools']) {
    const fixture = peer((message, generation) => {
      if (generation === 1 && message.params.cursor) throw expired()
      // Each page is individually admissible; only their combined work exceeds
      // the transaction limit, even though the first projection is discarded.
      return result(message, {
        tools: budget === 'tools' ? Array.from({ length: 65 }, (_, i) => tool(`tool-${i}`)) : [],
        ...(budget === 'bytes' ? { _meta: { padding: 'x'.repeat(270_000) } } : {}),
        ...(generation === 1 ? { nextCursor: 'old' } : {}),
      })
    })
    await assert.rejects(fixture.discover(endpoint, options), isCatalog)
    assert.equal(fixture.calls.filter(call => call.method === 'initialize').length, 2)
    assert.equal(fixture.calls.filter(call => call.method === 'tools/list').length, 3)
  }
})

test('a rejected replacement handshake only cleans up its own newly issued credential', async () => {
  const fixture = peer(() => { throw expired() }, { initialize: (message, generation) => generation === 1 ? undefined : {
    ...result(message, { protocolVersion: '1900-01-01', capabilities: { tools: {} }, serverInfo: { name: 'bad', version: '1' } }),
    sessionId: 'private-rejected-replacement',
  } })
  await assert.rejects(fixture.discover(endpoint, options), error => error instanceof McpDiscoveryError && error.code === 'unsupported_version')
  const deletes = fixture.calls.filter(call => call.method === 'DELETE')
  assert.equal(deletes.length, 1)
  assert.equal(deletes[0].input.sessionId, 'private-rejected-replacement')
  assert.equal(fixture.calls.filter(call => call.method === 'tools/list').length, 1)
})

test('expired and renewing facades reject concurrent work and expose replacement metadata only after initialization', async () => {
  let release
  let entered
  const pendingInitialization = new Promise(resolve => { release = resolve })
  const observedInitialization = new Promise(resolve => { entered = resolve })
  const fixture = peer((message, generation) => {
    if (generation === 1) throw expired()
    return result(message, { tools: [] })
  }, { initialize: async (message, generation) => {
    if (generation === 2) { entered(); await pendingInitialization }
    return {
      ...result(message, { protocolVersion: MCP_LEGACY_VERSIONS[generation - 1], capabilities: { tools: {} }, serverInfo: { name: `server-${generation}`, version: '1' } }),
      sessionId: `private-session-${generation}`,
    }
  } })
  const found = await fixture.withSession(endpoint, options, async session => {
    const invocation = { tool: tool('forbidden'), arguments: {} }
    await assert.rejects(session.restartExpiredSession(), McpSessionError)
    await assert.rejects(session.listTools(), isExpired)
    await assert.rejects(session.listTools(), McpSessionError)
    await assert.rejects(session.callTool(invocation), error => error instanceof McpToolCallError && !error.mayHaveExecuted)
    const renewal = session.restartExpiredSession()
    await observedInitialization
    assert.equal(session.serverInfo.name, 'server-1')
    await assert.rejects(session.restartExpiredSession(), McpSessionError)
    await assert.rejects(session.listTools(), McpSessionError)
    await assert.rejects(session.callTool(invocation), error => error instanceof McpToolCallError && !error.mayHaveExecuted)
    release()
    await renewal
    assert.equal(session.serverInfo.name, 'server-2')
    assert.equal(session.protocolVersion, MCP_LEGACY_VERSIONS[1])
    return session.listTools()
  })
  assert.equal(found.serverInfo.name, 'server-2')
  assert.equal(found.protocolVersion, MCP_LEGACY_VERSIONS[1])
  assert.equal(fixture.calls.filter(call => call.method === 'initialize').length, 2)
  assert.equal(fixture.calls.filter(call => call.method === 'tools/call').length, 0)
  assert.equal(fixture.calls.at(-1).input.protocolVersion, MCP_LEGACY_VERSIONS[1])
})
