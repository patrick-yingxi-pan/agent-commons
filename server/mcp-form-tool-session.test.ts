import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createMcpFormToolSession } from './mcpFormToolSession.ts'
import { createMcpToolSession } from './mcpToolSession.ts'
import { createMcpSession, createMcpFormSession } from './mcpSession.ts'
import { createMcpFormToolCaller, createMcpToolCaller, McpToolCallError } from './mcpToolCall.ts'
import { McpHttpError } from './mcpHttpTransport.ts'
import { MCP_MODERN_VERSION, MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'

const scope = { scope: 'loopback' as const }
const invocation = () => ({ tool: { name: 'plan.visit', inputSchema: { type: 'object', properties: {
  city: { type: 'string', 'x-mcp-header': 'City' },
} } }, arguments: { city: 'Paris' } })
const pending = (state: string | undefined = 'private-state') => ({
  resultType: 'input_required' as const,
  inputRequests: { details: { method: 'elicitation/create' as const, params: {
    message: 'Choose a date. https://untrusted.example/ is inert text.',
    requestedSchema: { type: 'object' as const, properties: {
      date: { type: 'string' as const, format: 'date' as const, default: '2026-10-11' },
      guests: { type: 'integer' as const, minimum: 1, maximum: 5 },
    }, required: ['date', 'guests'] },
  } } },
  ...(state === undefined ? {} : { requestState: state }),
})
const responses = () => ({ details: { action: 'accept' as const, content: { date: '2026-10-12', guests: 2 } } })
const complete = { resultType: 'complete', content: [{ type: 'text', text: 'Ready' }], isError: false }
const discovery = { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
const rpc = (request, result, status = 200) => ({ status, message: { jsonrpc: '2.0', id: request.id, result } })
function errorIs(code: string, mayHaveExecuted: boolean) {
  return (error: unknown) => {
    assert.ok(error instanceof McpToolCallError)
    assert.equal(error.code, code)
    assert.equal(error.mayHaveExecuted, mayHaveExecuted)
    assert.doesNotMatch(error.stack!, /private-state|private-answer|private-token|private-endpoint/)
    assert.deepEqual(Object.keys(error).sort(), ['code', 'mayHaveExecuted', 'name'])
    return true
  }
}
async function peer(t, handler) {
  const requests: any[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({ request, headers: req.headers, method: req.method })
    handler(req, res, request)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { url: `http://127.0.0.1:${(server.address() as any).port}/mcp?private-endpoint=1`, requests }
}
function json(res, request, result) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(rpc(request, result).message))
}

test('explicit form rounds use fresh RPC ids, exact original arguments and verbatim private state over real HTTP', async t => {
  let calls = 0
  const opaque = '  {"do-not-parse":"私密"}\u0000\n  '
  const server = await peer(t, (_req, res, request) => json(res, request,
    request.method === 'server/discover' ? discovery : ++calls === 1
      ? { ...pending(opaque), _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'untrusted-label', version: '1' } } }
      : complete))
  const call = createMcpFormToolSession()
  const first = await call(server.url, invocation(), { ...scope, bearerToken: 'private-token' })
  assert.equal(first.result.resultType, 'input_required')
  assert.equal(Object.hasOwn(first.result, '_meta'), false, 'result metadata is not continuation authority')
  assert.equal(first.cleanup, 'not-needed')
  assert.equal(calls, 1, 'input_required must return control, not continue or auto-answer defaults')
  assert.deepEqual(server.requests.map(row => row.request.method), ['server/discover', 'tools/call'])
  assert.equal(server.requests[1].request.params.inputResponses, undefined)
  const continuation = { pending: first.result, responses: responses() }
  const second = await call(server.url, { ...invocation(), continuation }, { ...scope, bearerToken: 'private-token' })
  assert.deepEqual(second.result, complete)
  assert.equal(calls, 2)
  assert.deepEqual(server.requests.map(row => row.request.method), ['server/discover', 'tools/call', 'server/discover', 'tools/call'])
  assert.equal(new Set(server.requests.map(row => row.request.id)).size, 4)
  const initial = server.requests[1].request.params
  const next = server.requests[3].request.params
  assert.deepEqual(next, { ...initial, inputResponses: responses(), requestState: opaque })
  for (const row of server.requests) {
    assert.deepEqual(row.request.params._meta['io.modelcontextprotocol/clientCapabilities'], { elicitation: { form: {} } })
    assert.equal(row.request.params._meta['io.modelcontextprotocol/protocolVersion'], MCP_MODERN_VERSION)
    assert.equal(row.headers.authorization, 'Bearer private-token')
    assert.equal(row.headers['mcp-session-id'], undefined)
    assert.equal(row.headers['mcp-param-requeststate'], undefined)
  }
  assert.equal(server.requests[3].headers['mcp-param-city'], 'Paris')
})

test('empty versus absent opaque state is preserved and only current-round response IDs are admitted', async () => {
  const sent: any[] = []
  const call = createMcpFormToolCaller({ post: async (_url, request) => { sent.push(request); return rpc(request, complete) } })
  for (const state of ['', undefined]) {
    const previous = pending(state)
    if (state === undefined) delete previous.requestState // default argument is intentional in other fixtures
    await call('https://example.com/mcp', { ...invocation(), protocolVersion: MCP_MODERN_VERSION,
      continuation: { pending: previous, responses: { details: { action: 'decline' } } } }, { scope: 'public' })
    assert.equal(Object.hasOwn(sent.at(-1).params, 'requestState'), state !== undefined)
    if (state !== undefined) assert.equal(sent.at(-1).params.requestState, '')
    assert.deepEqual(sent.at(-1).params.inputResponses, { details: { action: 'decline' } })
  }
  await assert.rejects(call('https://example.com/mcp', { ...invocation(), protocolVersion: MCP_MODERN_VERSION,
    continuation: { pending: pending(), responses: { ...responses(), previousRound: { action: 'cancel' } } } }, { scope: 'public' }), errorIs('request', false))
  assert.equal(sent.length, 2)
})

test('the negotiated wrapper freezes tool, arguments, form and answers before the first handshake await', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let sent
  const call = createMcpFormToolSession({ post: async (_url, request) => {
    if (request.method === 'server/discover') { await gate; return rpc(request, discovery) }
    sent = request
    return rpc(request, complete)
  } })
  const intent = { ...invocation(), continuation: { pending: pending(), responses: responses() } }
  const work = call('https://example.com/mcp', intent, { scope: 'public' })
  intent.arguments.city = 'Changed'
  intent.tool.name = 'other.tool'
  intent.continuation.pending.requestState = 'retargeted'
  intent.continuation.responses.details.content.guests = 5
  intent.continuation.pending.inputRequests.details.params.requestedSchema.required = []
  release()
  await work
  assert.equal(sent.params.name, 'plan.visit')
  assert.deepEqual(sent.params.arguments, { city: 'Paris' })
  assert.equal(sent.params.requestState, 'private-state')
  assert.deepEqual(sent.params.inputResponses, responses())
})

test('invalid continuations and getter-bearing input refuse before discovery or other I/O', async () => {
  let posts = 0
  let getters = 0
  const call = createMcpFormToolSession({ post: async () => { posts++; throw new Error('must not call') } })
  const invalid = [
    { pending: pending(), responses: {} },
    { pending: pending(), responses: { details: { action: 'accept', content: { date: '2026-02-30', guests: 2 } } } },
    { pending: pending(), responses: { details: { action: 'decline', content: {} } } },
    { pending: pending(), responses: responses(), extra: true },
    { pending: { resultType: 'input_required', requestState: 'private-state' }, responses: {} },
  ]
  for (const continuation of invalid) await assert.rejects(call('https://example.com/mcp', { ...invocation(), continuation } as any,
    { scope: 'public' }), errorIs('request', false))
  const source = { ...invocation(), get continuation() { getters++; return { pending: pending(), responses: responses() } } }
  await assert.rejects(call('https://example.com/mcp', source, { scope: 'public' }), errorIs('request', false))
  assert.equal(posts, 0)
  assert.equal(getters, 0)
})

test('ordinary product-facing session and tool callers do not advertise forms or accept input-required results', async () => {
  const sent: any[] = []
  const post = async (_url, request) => { sent.push(request); return rpc(request, request.method === 'server/discover' ? discovery : pending()) }
  const call = createMcpToolSession({ post })
  await assert.rejects(call('https://example.com/mcp', invocation(), { scope: 'public' }), errorIs('input_required', true))
  assert.equal(sent.length, 2)
  assert.ok(sent.every(request => Object.keys(request.params._meta['io.modelcontextprotocol/clientCapabilities']).length === 0))
  const withContinuation = { ...invocation(), continuation: { pending: pending(), responses: responses() } }
  await assert.rejects(call('https://example.com/mcp', withContinuation, { scope: 'public' }), errorIs('request', false))
  await assert.rejects(createMcpToolCaller({ post })('https://example.com/mcp', {
    ...withContinuation, protocolVersion: MCP_MODERN_VERSION,
  }, { scope: 'public' }), errorIs('request', false))
  assert.equal(sent.length, 2, 'no silently stripped continuation may become a bare replay')
})

test('form sessions refuse every legacy fallback before initialize and never send prior form state', async () => {
  const replies = [
    ...[400, 404, 405].map(status => () => { throw new McpHttpError('response', true, status) }),
    ...[400, 405].map(status => request => ({ status, message: { jsonrpc: '2.0', id: request.id,
      error: { code: -32601, message: 'legacy' } } })),
    request => ({ status: 400, message: { jsonrpc: '2.0', id: request.id, error: { code: -32022,
      message: 'unsupported', data: { requested: MCP_MODERN_VERSION, supported: [...MCP_LEGACY_VERSIONS] } } } }),
  ]
  for (const reply of replies) {
    const sent: any[] = []
    const call = createMcpFormToolSession({ post: async (_url, request) => { sent.push(request); return reply(request) } })
    await assert.rejects(call('https://example.com/mcp', { ...invocation(), continuation: { pending: pending(), responses: responses() } },
      { scope: 'public' }), errorIs('unsupported_version', false))
    assert.deepEqual(sent.map(request => request.method), ['server/discover'])
    assert.equal(sent[0].params.requestState, undefined)
    assert.equal(sent[0].params.inputResponses, undefined)
  }
})

test('both method names share a consumed attempt slot, including wrong-mode, concurrent and closed calls', async () => {
  for (const enabled of [false, true]) {
    let calls = 0
    const withSession = (enabled ? createMcpFormSession : createMcpSession)({ post: async (_url, request) => {
      if (request.method === 'server/discover') return rpc(request, discovery)
      calls++
      return rpc(request, complete)
    } })
    let escaped
    await withSession('https://example.com/mcp', { scope: 'public' }, async context => {
      escaped = context
      const first = enabled ? context.callToolWithForms(invocation()) : context.callTool(invocation())
      await assert.rejects(context.callTool(invocation()), errorIs('request', false))
      await assert.rejects(context.callToolWithForms(invocation()), errorIs('request', false))
      await first
    })
    await assert.rejects(escaped.callToolWithForms(invocation()), errorIs('request', false))
    await assert.rejects(escaped.callTool(invocation()), errorIs('request', false))
    assert.equal(calls, 1)
    await withSession('https://example.com/mcp', { scope: 'public' }, async context => {
      await assert.rejects(enabled ? context.callTool(invocation()) : context.callToolWithForms(invocation()), errorIs('request', false))
      await assert.rejects(enabled ? context.callToolWithForms(invocation()) : context.callTool(invocation()), errorIs('request', false))
    })
    assert.equal(calls, 1, 'an incorrect API cannot reset the attempt latch')
  }
})

test('discovery and listing never accept input_required even in an explicit form-capable session', async () => {
  for (const stage of ['server/discover', 'tools/list']) {
    const sent: any[] = []
    const withSession = createMcpFormSession({ post: async (_url, request) => {
      sent.push(request)
      return rpc(request, request.method === stage ? pending() : discovery)
    } })
    await assert.rejects(withSession('https://example.com/mcp', { scope: 'public' }, async context => context.listTools()),
      error => error.code === 'input_required')
    assert.deepEqual(sent.map(request => request.method), stage === 'server/discover' ? [stage] : ['server/discover', stage])
    assert.ok(sent.every(request => request.params._meta['io.modelcontextprotocol/clientCapabilities'].elicitation.form))
  }
})

test('direct session methods cannot execute accessors or erase a non-enumerable continuation before validation', async () => {
  let calls = 0
  let getters = 0
  const post = async (_url, request) => {
    if (request.method === 'server/discover') return rpc(request, discovery)
    calls++
    return rpc(request, complete)
  }
  await createMcpFormSession({ post })('https://example.com/mcp', { scope: 'public' }, async context => {
    const source = { ...invocation(), get continuation() { getters++; return { pending: pending(), responses: responses() } } }
    await assert.rejects(context.callToolWithForms(source), errorIs('request', false))
    await assert.rejects(context.callToolWithForms(invocation()), errorIs('request', false))
  })
  const source = invocation()
  Object.defineProperty(source, 'continuation', { value: { pending: pending(), responses: responses() }, enumerable: false })
  await createMcpSession({ post })('https://example.com/mcp', { scope: 'public' }, async context => {
    await assert.rejects(context.callTool(source), errorIs('request', false))
    await assert.rejects(context.callTool(invocation()), errorIs('request', false))
  })
  assert.equal(getters, 0)
  assert.equal(calls, 0)
})

test('unsupported URL, sampling, roots, state-only and malformed forms are uncertain after one tool submission', async () => {
  const invalid = [
    { resultType: 'input_required', requestState: 'private-state' },
    { resultType: 'input_required', inputRequests: { a: { method: 'roots/list', params: {} } } },
    { resultType: 'input_required', inputRequests: { a: { method: 'sampling/createMessage', params: {} } } },
    { resultType: 'input_required', inputRequests: { a: { method: 'elicitation/create', params: { mode: 'url', message: 'private-answer', url: 'https://example.com' } } } },
    { ...pending(), requestState: { secret: 'private-state' } },
  ]
  for (const result of invalid) {
    const methods: string[] = []
    const call = createMcpFormToolSession({ post: async (_url, request) => {
      methods.push(request.method)
      return rpc(request, request.method === 'server/discover' ? discovery : result)
    } })
    await assert.rejects(call('https://example.com/mcp', invocation(), { scope: 'public' }), errorIs('input_required', true))
    assert.deepEqual(methods, ['server/discover', 'tools/call'])
  }
})

test('explicit cancel response is data for one continuation, not a transport rollback or implicit dispatch', async () => {
  const sent: any[] = []
  const call = createMcpFormToolSession({ post: async (_url, request) => {
    sent.push(request)
    return rpc(request, request.method === 'server/discover' ? discovery : pending('next-private-state'))
  } })
  const result = await call('https://example.com/mcp', { ...invocation(), continuation: {
    pending: pending(), responses: { details: { action: 'cancel' } },
  } }, { scope: 'public' })
  assert.equal(result.result.resultType, 'input_required')
  assert.equal(result.result.requestState, 'next-private-state')
  assert.deepEqual(sent[1].params.inputResponses, { details: { action: 'cancel' } })
  assert.equal(sent.length, 2)
})

test('one original deadline covers discovery and final dispatch; late authorization refusal never reaches tools/call', async () => {
  let clock = 0
  const sent: any[] = []
  const call = createMcpFormToolSession({ now: () => clock, post: async (_url, request) => {
    sent.push(request)
    clock = 30_001
    return rpc(request, discovery)
  } })
  await assert.rejects(call('https://example.com/mcp', invocation(), { scope: 'public', timeoutMs: 30_000 }), errorIs('timeout', false))
  assert.deepEqual(sent.map(request => request.method), ['server/discover'])
  clock = 0
  await assert.rejects(call('https://example.com/mcp', invocation(), { scope: 'public', beforeCall: () => {
    throw new McpToolCallError('request', false)
  } }), errorIs('request', false))
  assert.equal(sent.length, 2)
})

test('post-submission transport failure preserves uncertainty without replay; pre-abort sends nothing', async () => {
  const sent: any[] = []
  const call = createMcpFormToolSession({ post: async (_url, request) => {
    sent.push(request)
    if (request.method === 'server/discover') return rpc(request, discovery)
    throw new McpHttpError('timeout', true)
  } })
  const intent = { ...invocation(), continuation: { pending: pending(), responses: responses() } }
  await assert.rejects(call('https://example.com/mcp', intent, { scope: 'public' }), errorIs('timeout', true))
  await assert.rejects(call('https://example.com/mcp', intent, { scope: 'public', signal: AbortSignal.abort('private-answer') }), errorIs('cancelled', false))
  assert.deepEqual(sent.map(request => request.method), ['server/discover', 'tools/call'])
})

test('a fulfilled form response is retained over a subsequent cancellation, with no automatic continuation', async () => {
  const controller = new AbortController()
  const call = createMcpFormToolCaller({ post: async (_url, request) => {
    queueMicrotask(() => controller.abort())
    return rpc(request, pending())
  } })
  const result = await call('https://example.com/mcp', { ...invocation(), protocolVersion: MCP_MODERN_VERSION },
    { scope: 'public', signal: controller.signal })
  assert.deepEqual(result, pending())
  assert.equal(controller.signal.aborted, true)
})
