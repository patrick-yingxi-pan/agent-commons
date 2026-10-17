import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderConfig } from '../data/providers.ts'

// Capture the ordinary configured budget before loading the generation seam.
// Single-shot workflows below must override this nonzero process default.
const previousBudget = process.env.ANTHROPIC_MAX_RETRIES
process.env.ANTHROPIC_MAX_RETRIES = '2'
const generation = await import('../generate.ts')
if (previousBudget === undefined) delete process.env.ANTHROPIC_MAX_RETRIES
else process.env.ANTHROPIC_MAX_RETRIES = previousBudget
const { DEFAULT_AGENT } = await import('../data/workers.ts')
const { ProviderProbeError } = await import('../data/providers.ts')
const { prepareAgentRequestArguments } = await import('../proxyArgumentPreparation.ts')
const { prepareAgentRequestReply } = await import('../proxyReplyPreparation.ts')
const { prepareCommissionMcpInput } = await import('../commissionMcpPreparation.ts')
const { mcpToolSchemaHash } = await import('../mcpToolAdmission.ts')

const session = { id: 'retry-integration', title: 'Retry integration' }
const agent = { ...DEFAULT_AGENT, tools: [] }
let serial = 0
function provider(protocol: ProviderConfig['protocol'] = 'openai-responses'): ProviderConfig {
  return { protocol, baseURL: 'http://127.0.0.1:1/v1', model: `retry-fixture-${++serial}`, capabilities: { toolUse: true } }
}
function unavailable(): Response {
  return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Authored transient fixture.' } },
    { status: 503, headers: { 'retry-after': '0' } })
}
function textOutput(text = 'Recovered answer.') {
  return { id: 'msg-retry', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
}
function completed(output = [textOutput()], usage = { input_tokens: 11, output_tokens: 7 }) {
  return { id: 'resp-retry', object: 'response', status: 'completed', model: 'fixture', output, usage }
}
function stream(output = [textOutput()], usage = { input_tokens: 11, output_tokens: 7 }): Response {
  const response = completed(output, usage)
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.completed', response },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } })
}
async function reply(config: ProviderConfig, usage: unknown[] = [], signal?: AbortSignal, api?: any) {
  return generation.generateReply(session, agent, 'Check the reviewed facts.', {
    onStart() {}, onDelta() {}, onUsage: row => usage.push(row),
  }, signal, config, undefined, [], api)
}

test('ordinary Responses reply honors configured retries and meters the successful response once', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls < 3 ? unavailable() : stream())
  const usage: unknown[] = []
  const result = await reply(provider(), usage)
  assert.equal(result.outcome, 'ok')
  assert.equal(calls, 3, 'two configured retries reach the third authored response')
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 7 }])
})

test('Responses continuation retries only its request, never an already executed tool batch', async t => {
  const bodies: any[] = []
  const usage: unknown[] = []
  let dispatches = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    if (bodies.length === 1) {
      const fn = body.tools.find((tool: any) => tool.name === 'api__get_usage')
      assert.ok(fn, 'the real generated API tool must be present')
      return stream([{ id: 'fc-retry', type: 'function_call', call_id: 'call-retry', name: fn.name,
        arguments: '{"query":{}}', status: 'completed' }] as any, { input_tokens: 11, output_tokens: 5 })
    }
    return bodies.length === 2 ? unavailable() : stream([textOutput('Tool facts received.')], { input_tokens: 13, output_tokens: 8 })
  })
  const result = await reply(provider(), usage, undefined, {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      dispatches++
      assert.equal(usage.length, 1, 'settled usage is recorded before the effect')
      return { status: 200, headers: {}, body: Buffer.from('{"remaining":42}') }
    },
  })
  assert.equal(result.outcome, 'ok')
  assert.equal(bodies.length, 3)
  assert.equal(dispatches, 1)
  assert.deepEqual(bodies[1], bodies[2], 'only the same continuation request is retried')
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 5 }, { inputTokens: 13, outputTokens: 8 }])
})

const changeset = { version: 4, at: 1_764_000_000_000, by: 'Fixture',
  entries: [{ id: 'entry-one', kind: 'instructions', target: 'release rule', before: 'old', after: 'new' }] }
const draftAgent = { id: 'retry-agent', label: 'Fixture', systemPrompt: 'Use reviewed facts.', instructions: 'Be concise.', tools: [] }
const tool = { name: 'search', description: 'Search reviewed sources.', inputSchema: {
  type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string' } }, required: ['query', 'scope'], additionalProperties: false,
} }
const judgment = {
  policy: { actKind: 'approve-envelope', mode: 'decide', policy: 'Approve one read-only change.', escalation: ['effectful', 'unreviewed'], revision: 7, expiresAt: 1_800_000_000_000 },
  changeset, envelope: null, risk: { effectful: false, unreviewed: false, stranger: false, readOnlyEnvelope: true },
}
const singleShot = [
  ['Contribution review', (config: ProviderConfig) => generation.generateContributionReview(changeset as any, draftAgent, config, () => {}), 'ContributionReviewTransportError'],
  ['delegated judgment', (config: ProviderConfig) => generation.generateDelegatedJudgment(judgment as any, config, () => {}), 'DelegatedJudgmentTransportError'],
  ['Agent Request arguments', (config: ProviderConfig) => generation.generateAgentRequestArguments(
    prepareAgentRequestArguments({ task: 'Find reviewed notes.', agent: draftAgent, tool }), config, undefined, () => {}), 'ProxyArgumentPreparationTransportError'],
  ['Agent Request reply', (config: ProviderConfig) => generation.generateAgentRequestReply(
    prepareAgentRequestReply({ task: 'Explain delivery status.', agent: draftAgent, notes: 'Use reviewed notes.' }), config, undefined, () => {}), 'ProxyReplyPreparationTransportError'],
  ['Commission arguments', (config: ProviderConfig) => generation.generateCommissionMcpArguments(prepareCommissionMcpInput({
    agent: draftAgent,
    project: { id: 'retry-project', name: 'Reviewed project', description: 'A small workspace.', instructions: 'Use primary sources.', updatedAt: 1, scheduled: [], contexts: [], sessionIds: [] },
    work: { itemId: 'item-a', subGoal: 'Search reviewed source', type: 'mcp.mutate', target: 'search', note: 'Use recent findings.' },
    tool, permission: { connectionId: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', connectionRevision: 7, toolName: 'search', schemaHash: mcpToolSchemaHash(tool), fixedArguments: { scope: 'project' } },
  }), config, undefined, () => {}), 'CommissionMcpPreparationTransportError'],
  ['connection probe', (config: ProviderConfig) => generation.probeProviderEndpoint(config), 'ProviderProbeError'],
] as const

for (const protocol of ['openai-responses', 'anthropic-messages'] as const) {
  for (const [label, invoke, errorName] of singleShot) {
    test(`${protocol} ${label} stays single-shot despite a nonzero configured retry budget`, async t => {
      let calls = 0
      t.mock.method(globalThis, 'fetch', async () => { calls++; return unavailable() })
      await assert.rejects(invoke(provider(protocol)), errorName === 'ProviderProbeError' ? ProviderProbeError : { name: errorName })
      assert.equal(calls, 1, 'the request was admitted exactly once, with no automatic transport or capability retry')
    })
  }
  for (const status of [400, 422]) {
    test(`${protocol} probe retains its intentional ${status} no-tools capability fallback`, async t => {
      const bodies: any[] = []
      t.mock.method(globalThis, 'fetch', async (_url, options) => {
        const body = JSON.parse(options.body)
        bodies.push(body)
        if (bodies.length === 1) return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Authored tool rejection.' } }, { status })
        return Response.json(protocol === 'openai-responses' ? completed([textOutput('ok')]) : {
          id: 'msg-probe', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 11, output_tokens: 7 },
        })
      })
      assert.deepEqual(await generation.probeProviderEndpoint(provider(protocol)), { toolUse: false })
      assert.equal(bodies.length, 2)
      assert.ok(bodies[0].tools?.length)
      assert.equal(bodies[1].tools, undefined)
    })
  }
}

test('ordinary Responses retry exhaustion respects the configured attempt bound without recording usage', async t => {
  let calls = 0
  const usage: unknown[] = []
  t.mock.method(globalThis, 'fetch', async () => { calls++; return unavailable() })
  const result = await reply(provider(), usage)
  assert.equal(result.outcome, 'fallback')
  assert.equal(calls, 3)
  assert.deepEqual(usage, [])
})

test('known Responses quota refusal makes one request and publishes only static terminal billing guidance', async t => {
  let calls = 0
  let shown = ''
  const usage: unknown[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'PRIVATE_UPSTREAM_BILLING_CANARY' } },
      { status: 429, headers: { 'retry-after': '0' } })
  })
  const result = await generation.generateReply(session, agent, 'Check reviewed facts.', {
    onStart() {}, onDelta: delta => { shown += delta }, onUsage: row => usage.push(row),
  }, undefined, provider())
  assert.equal(result.outcome, 'fallback')
  assert.equal(result.failure, 'provider_rejected', 'background work must not defer and automatically retry a quota refusal')
  assert.equal(calls, 1)
  assert.deepEqual(usage, [])
  assert.match(shown, /billing or quota change.*HTTP 429/)
  assert.match(shown, /will not be retried automatically/)
  assert.doesNotMatch(JSON.stringify(result) + shown, /PRIVATE_UPSTREAM_BILLING_CANARY|insufficient_quota/)
})

test('Responses server wait beyond the supported bound is terminal without retrying early or exposing diagnostics', async t => {
  let calls = 0
  let shown = ''
  const usage: unknown[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ error: { type: 'server_error', message: 'PRIVATE_LONG_WAIT_CANARY' } },
      { status: 503, headers: { 'retry-after': '61' } })
  })
  const result = await generation.generateReply(session, agent, 'Check reviewed facts.', {
    onStart() {}, onDelta: delta => { shown += delta }, onUsage: row => usage.push(row),
  }, undefined, provider())
  assert.equal(result.outcome, 'fallback')
  assert.equal(result.failure, 'provider_rejected', 'an outer workflow must not retry before the requested wait')
  assert.equal(calls, 1)
  assert.deepEqual(usage, [])
  assert.match(shown, /longer wait.*supports/)
  assert.match(shown, /will not retry sooner than requested/)
  assert.match(shown, /will not be retried automatically/)
  assert.doesNotMatch(JSON.stringify(result) + shown, /PRIVATE_LONG_WAIT_CANARY|server_error/)
})

for (const scenario of [
  { label: 'positive wait on the exhausted final attempt', expectedRequests: 3, retryAfter: '30' },
  { label: 'long wait combined with x-should-retry false', expectedRequests: 1, retryAfter: '61', noRetry: true },
  { label: 'positive wait interrupted by the internal deadline', expectedRequests: 1, retryAfter: '30', deadlineMs: 20 },
] as const) {
  test(`Responses ${scenario.label} prevents an earlier outer workflow retry`, async t => {
    const previousTimeout = process.env.MODEL_TIMEOUT_MS
    if ('deadlineMs' in scenario) process.env.MODEL_TIMEOUT_MS = String(scenario.deadlineMs)
    let calls = 0
    let shown = ''
    const usage: unknown[] = []
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      return Response.json({ error: { type: 'server_error', message: 'PRIVATE_PENDING_WAIT_CANARY' } }, { status: 503, headers: {
        'retry-after': calls < scenario.expectedRequests ? '0' : scenario.retryAfter,
        ...('noRetry' in scenario ? { 'x-should-retry': 'false' } : {}),
      } })
    })
    const keepAlive = setTimeout(() => {}, 1_000)
    try {
      const result = await generation.generateReply(session, agent, 'Check reviewed facts.', {
        onStart() {}, onDelta: delta => { shown += delta }, onUsage: row => usage.push(row),
      }, undefined, provider())
      assert.equal(calls, scenario.expectedRequests)
      assert.deepEqual(usage, [])
      assert.equal(result.outcome, 'fallback')
      assert.equal(result.failure, 'provider_rejected', 'an unfulfilled server wait cannot become an earlier outer retry')
      assert.match(shown, /will not be retried automatically/)
      assert.doesNotMatch(JSON.stringify(result) + shown, /PRIVATE_PENDING_WAIT_CANARY|server_error/)
    } finally {
      clearTimeout(keepAlive)
      if (previousTimeout === undefined) delete process.env.MODEL_TIMEOUT_MS
      else process.env.MODEL_TIMEOUT_MS = previousTimeout
    }
  })
}

test('ordinary Responses compaction uses the configured budget and records only settled usage', async t => {
  let calls = 0
  const usage: unknown[] = []
  t.mock.method(globalThis, 'fetch', async () => ++calls < 3 ? unavailable() : Response.json(completed([textOutput('Reviewed summary.')], { input_tokens: 17, output_tokens: 9 })))
  const result = await generation.generateCompactionSummaryPart('Summarize reviewed facts.', provider(), undefined, row => usage.push(row))
  assert.equal(result.text, 'Reviewed summary.')
  assert.equal(calls, 3)
  assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 9 }])
})

test('Responses successful HTTP admission never replays malformed SSE or JSON bodies', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response('event: response.completed\ndata: {not-json}\n\n', { headers: { 'content-type': 'text/event-stream' } })
  })
  assert.equal((await reply(provider())).outcome, 'fallback')
  assert.equal(calls, 1)
  await assert.rejects(generation.generateCompactionSummaryPart('Summarize reviewed facts.', provider()))
  assert.equal(calls, 2, 'malformed successful JSON is not transport retryable')
})

test('caller cancellation during Responses backoff stops the original attempt sequence', async t => {
  const controller = new AbortController()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    setTimeout(() => controller.abort(new DOMException('Fixture cancellation', 'AbortError')), 10)
    return Response.json({ error: { type: 'server_error' } }, { status: 503, headers: { 'retry-after': '5' } })
  })
  await assert.rejects(reply(provider(), [], controller.signal), { name: 'AbortError' })
  assert.equal(calls, 1, 'cancellation must not start a fresh request or deadline')
})

test('the original generation deadline expires during Responses backoff without starting another attempt', async t => {
  const previousTimeout = process.env.MODEL_TIMEOUT_MS
  process.env.MODEL_TIMEOUT_MS = '20'
  let calls = 0
  const usage: unknown[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ error: { type: 'server_error' } }, { status: 503, headers: { 'retry-after': '5' } })
  })
  // Keep the test process alive for the unref'ed AbortSignal timeout itself.
  const keepAlive = setTimeout(() => {}, 1_000)
  try {
    assert.equal((await reply(provider(), usage)).outcome, 'fallback')
    assert.equal(calls, 1, 'retry must not replace the operation deadline')
    assert.deepEqual(usage, [])
  } finally {
    clearTimeout(keepAlive)
    if (previousTimeout === undefined) delete process.env.MODEL_TIMEOUT_MS
    else process.env.MODEL_TIMEOUT_MS = previousTimeout
  }
})
