/** Messages retry waits stay within the configured budget and caller deadline. */
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { ProviderConfig } from '../data/providers.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'

const previousBudget = process.env.ANTHROPIC_MAX_RETRIES
process.env.ANTHROPIC_MAX_RETRIES = '1'
const generation = await import('../generate.ts')
if (previousBudget === undefined) delete process.env.ANTHROPIC_MAX_RETRIES
else process.env.ANTHROPIC_MAX_RETRIES = previousBudget

type Body = Record<string, any>
type Handler = (body: Body, index: number, pathname: string) => Response | Promise<Response>

function installMockPeer(t: TestContext, handler: Handler) {
  const requests: Array<{ body: Body; pathname: string }> = []
  const responseWaiters: Array<{ count: number; resolve: () => void }> = []
  let completedResponses = 0
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const source = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const url = new URL(source, 'http://provider.test')
    const requestBody = init?.body ?? (input instanceof Request ? input.body : undefined)
    const body = typeof requestBody === 'string' ? JSON.parse(requestBody) as Body : {}
    const index = requests.push({ body, pathname: url.pathname }) - 1
    const response = await handler(body, index, url.pathname)
    completedResponses++
    for (let i = responseWaiters.length - 1; i >= 0; i--) {
      const waiter = responseWaiters[i]!
      if (completedResponses >= waiter.count) {
        responseWaiters.splice(i, 1)
        waiter.resolve()
      }
    }
    return response
  })
  return {
    baseURL: 'http://provider.test',
    requests,
    waitForResponses(count: number) {
      if (completedResponses >= count) return Promise.resolve()
      return new Promise<void>(resolve => responseWaiters.push({ count, resolve }))
    },
  }
}

function provider(baseURL: string, model = 'messages-retry-fixture'): ProviderConfig {
  return { protocol: 'anthropic-messages', baseURL, model, capabilities: { toolUse: true } }
}

function unavailable(retryAfter = '0') {
  return Response.json({ error: { type: 'overloaded_error', message: 'Authored transient fixture.' } }, {
    status: 503, headers: { 'retry-after': retryAfter },
  })
}

function anthropicEvents(events: Array<{ type: string; [key: string]: unknown }>): string {
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

function textResponse(model: string, text: string, inputTokens: number, outputTokens: number) {
  return anthropicEvents([
    { type: 'message_start', message: { id: 'messages-retry-answer', type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens } },
    { type: 'message_stop' },
  ])
}

function toolResponse(model: string, name: string) {
  return anthropicEvents([
    { type: 'message_start', message: { id: 'messages-retry-tool-call', type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-once', name, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":{}}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ])
}

function stream(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

function invoke(baseURL: string, signal?: AbortSignal, usage: unknown[] = [], api?: any) {
  return generation.generateReply(
    { id: 'messages-retry-session', title: 'Messages retry test' },
    { ...DEFAULT_AGENT, tools: [] },
    'Use the reviewed fixture.',
    { onStart() {}, onDelta() {}, onUsage: entry => usage.push(entry) },
    signal,
    provider(baseURL),
    undefined,
    [],
    api,
  )
}

async function settlesWithin<T>(promise: Promise<T>, limitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = await Promise.race([
    promise.then(value => ({ kind: 'resolved' as const, value }), error => ({ kind: 'rejected' as const, error })),
    new Promise<{ kind: 'timeout' }>(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), limitMs) }),
  ])
  if (timer) clearTimeout(timer)
  return settled
}

for (const flavor of [
  { label: 'Claude Messages', baseURL: (origin: string) => origin, pathname: '/v1/messages' },
  { label: 'DeepSeek-compatible Messages', baseURL: (origin: string) => `${origin}/anthropic`, pathname: '/anthropic/v1/messages' },
]) {
  test(`${flavor.label} Stop interrupts an in-flight retry wait promptly`, async t => {
    const peer = installMockPeer(t, () => unavailable('5'))
    const controller = new AbortController()
    try {
      const work = invoke(flavor.baseURL(peer.baseURL), controller.signal)
      await peer.waitForResponses(1)
      // Let the SDK consume the completed 503 and enter its Retry-After delay.
      await new Promise<void>(resolve => setTimeout(resolve, 30))
      const began = performance.now()
      controller.abort(new DOMException('User stopped the turn.', 'AbortError'))
      const result = await settlesWithin(work, 500)
      assert.notEqual(result.kind, 'timeout', 'Stop must not wait out the provider backoff')
      assert.equal(result.kind, 'rejected', 'caller cancellation remains terminal')
      assert.ok(performance.now() - began < 500)
      assert.equal(peer.requests.length, 1, 'cancellation does not start another provider attempt')
      assert.equal(peer.requests[0]?.pathname, flavor.pathname, 'the adapter preserves the provider flavor root')
    } finally {
      controller.abort()
    }
  })
}

test('the original Messages deadline interrupts Retry-After without replacing the request budget', async t => {
  const previousTimeout = process.env.MODEL_TIMEOUT_MS
  process.env.MODEL_TIMEOUT_MS = '50'
  const peer = installMockPeer(t, () => unavailable('5'))
  const keepAlive = setTimeout(() => {}, 1_000)
  try {
    const work = invoke(peer.baseURL)
    await peer.waitForResponses(1)
    const result = await settlesWithin(work, 500)
    assert.notEqual(result.kind, 'timeout', 'the original call deadline must cancel an SDK retry wait')
    assert.equal(result.kind, 'resolved')
    assert.equal(result.value.outcome, 'fallback', 'deadline expiry degrades to the ordinary local fallback')
    assert.equal(result.value.failure, 'provider_rejected', 'a positive retry hint prevents Routine replay after the deadline')
    assert.equal(peer.requests.length, 1, 'deadline does not allow a retry to replace the original operation')
    assert.equal(peer.requests[0]?.pathname, '/v1/messages')
  } finally {
    clearTimeout(keepAlive)
    if (previousTimeout === undefined) delete process.env.MODEL_TIMEOUT_MS
    else process.env.MODEL_TIMEOUT_MS = previousTimeout
  }
})

test('Messages honors the configured retry budget and records only the successful response once', async t => {
  const model = 'messages-budget-fixture'
  const peer = installMockPeer(t, (_body, index) => {
    if (index === 0) return unavailable()
    return stream(textResponse(model, 'Recovered after one retry.', 17, 9))
  })
  const usage: unknown[] = []
  const result = await generation.generateReply(
    { id: 'messages-budget-session', title: 'Messages retry test' },
    { ...DEFAULT_AGENT, tools: [] }, 'Use the reviewed fixture.',
    { onStart() {}, onDelta() {}, onUsage: entry => usage.push(entry) },
    undefined, provider(peer.baseURL, model),
  )
  assert.equal(result.outcome, 'ok')
  assert.equal(peer.requests.length, 2, 'ANTHROPIC_MAX_RETRIES=1 permits one retry after the initial call')
  assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 9 }])
})

test('a successful Messages response that later fails parsing is never replayed', async t => {
  const peer = installMockPeer(t, () => stream('event: message_start\ndata: {not-json}\n\n'))
  const usage: unknown[] = []
  const result = await invoke(peer.baseURL, undefined, usage)
  assert.equal(result.outcome, 'fallback')
  assert.equal(peer.requests.length, 1, 'HTTP 200 admission prevents transport replay even when its body is invalid')
  assert.deepEqual(usage, [])
})

test('Messages continuation retries preserve the one completed tool effect and its usage', async t => {
  const model = 'messages-tool-retry-fixture'
  const bodies: Body[] = []
  const peer = installMockPeer(t, (body, index) => {
    bodies.push(body)
    if (index === 0) {
      const tool = body.tools.find((item: Body) => item.name === 'api__get_usage')
      assert.ok(tool, 'the generated API tool is present in the initial authored request')
      return stream(toolResponse(model, tool.name))
    } else if (index === 1) return unavailable()
    return stream(textResponse(model, 'Tool facts received.', 13, 4))
  })
  const usage: unknown[] = []
  let dispatches = 0
  const result = await generation.generateReply(
    { id: 'messages-tool-retry-session', title: 'Messages retry tool test' },
    { ...DEFAULT_AGENT, tools: [] }, 'Use the reviewed fixture.',
    { onStart() {}, onDelta() {}, onUsage: entry => usage.push(entry) },
    undefined, provider(peer.baseURL, model), undefined, [], {
      catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
      dispatch: async () => {
        dispatches++
        assert.equal(usage.length, 1, 'the completed tool-call response is metered before executing its effect')
        return { status: 200, headers: {}, body: Buffer.from('{"remaining":42}') }
      },
    },
  )
  assert.equal(result.outcome, 'ok')
  assert.equal(peer.requests.length, 3, 'the continuation gets one retry within the configured budget')
  assert.deepEqual(bodies[1], bodies[2], 'the retry replays only the exact failed continuation request')
  assert.equal(dispatches, 1, 'the successful initial tool call is not repeated during continuation retry')
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 2 }, { inputTokens: 13, outputTokens: 4 }])
})
