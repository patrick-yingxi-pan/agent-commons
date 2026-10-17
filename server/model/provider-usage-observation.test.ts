import { beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCompactionSummaryPart, generateReply } from '../generate.ts'
import { providerUsage } from '../providerUsage.ts'
import type { ProviderConfig } from '../data/providers.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'

const keyRef = 'PROVIDER_MODEL_USAGE_TEST'
const originalKey = process.env[keyRef]
beforeEach(() => { providerUsage.clear(); process.env[keyRef] = 'private-model-usage-fixture' })
after(() => { if (originalKey === undefined) delete process.env[keyRef]; else process.env[keyRef] = originalKey })
const config = (patch: Partial<ProviderConfig> = {}): ProviderConfig => ({
  protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1', apiKeyEnv: keyRef,
  model: 'fixture-model', capabilities: { toolUse: false },
  usageIdentity: { providerId: 'fixture-provider', tenantId: 'fixture-tenant', connectionRevision: 1 }, ...patch,
})
const messages = () => config({ protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com' })
const result = (cfg: ProviderConfig, usage: unknown) => cfg.protocol === 'openai-responses' ? {
  id: 'resp_fixture', object: 'response', status: 'completed', model: cfg.model,
  output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'An authored fixture summary.', annotations: [] }] }], usage,
} : {
  id: 'msg_fixture', type: 'message', role: 'assistant', model: cfg.model,
  content: [{ type: 'text', text: 'An authored fixture summary.' }], stop_reason: 'end_turn', stop_sequence: null, usage,
}
const rate = (cfg: ProviderConfig) => cfg.protocol === 'openai-responses'
  ? { 'x-ratelimit-limit-requests': '20', 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1s' }
  : { 'anthropic-ratelimit-input-tokens-limit': '10000', 'anthropic-ratelimit-input-tokens-remaining': '0', 'anthropic-ratelimit-input-tokens-reset': '2026-10-17T01:00:00Z' }

function streamResponse(cfg: ProviderConfig): Response {
  const usage = { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 11 }
  const events = cfg.protocol === 'openai-responses' ? [
    { type: 'response.created', response: { ...result(cfg, null), status: 'in_progress', output: [] } },
    { type: 'response.completed', response: result(cfg, usage) },
  ] : [
    { type: 'message_start', message: { ...result(cfg, { ...usage, output_tokens: 0 }), content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'An authored fixture summary.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream', ...rate(cfg) } })
}

test('streamed conversation replies observe both provider protocols once using final cumulative usage', async t => {
  for (const cfg of [config(), messages()]) {
    let calls = 0, text = ''
    const mock = t.mock.method(globalThis, 'fetch', async (_input, init) => {
      calls++
      assert.equal(JSON.parse(String(init.body)).stream, true)
      return streamResponse(cfg)
    })
    const generated = await generateReply({ id: 'fixture-session', title: 'Fixture conversation' }, { ...DEFAULT_AGENT, tools: [] }, 'Fixture question', {
      onStart() {}, onDelta(delta) { text += delta },
    }, undefined, cfg)
    assert.equal(generated.outcome, 'ok')
    assert.equal(text, 'An authored fixture summary.')
    assert.equal(calls, 1)
    assert.equal(providerUsage.snapshot(cfg).lastRequest?.inputTokens, cfg.protocol === 'openai-responses' ? 5 : 23)
    assert.equal(providerUsage.snapshot(cfg).lastRequest?.outputTokens, 3)
    assert.equal(providerUsage.snapshot(cfg).rateLimits[0].remaining, 0)
    mock.mock.restore()
    providerUsage.clear()
  }
})

test('native Responses and Messages capture actual generation headers and normalized settled usage with no extra requests', async t => {
  for (const cfg of [config(), messages()]) {
    let calls = 0
    const usage = { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 11 }
    const mock = t.mock.method(globalThis, 'fetch', async (input, init) => {
      calls++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      assert.equal(url, cfg.protocol === 'openai-responses' ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages')
      assert.equal(init?.method?.toUpperCase(), 'POST')
      assert.equal(init?.redirect, 'error')
      const body = JSON.parse(String(init.body))
      assert.equal(body.model, cfg.model)
      return Response.json(result(cfg, usage), { headers: rate(cfg) })
    })
    const generated = await generateCompactionSummaryPart('Authored private summary input', cfg)
    assert.equal(generated.usage.inputTokens, cfg.protocol === 'openai-responses' ? 5 : 23)
    const snapshot = providerUsage.snapshot(cfg)
    assert.equal(snapshot.lastRequest?.inputTokens, generated.usage.inputTokens)
    assert.equal(snapshot.lastRequest?.outputTokens, 3)
    assert.equal(snapshot.rateLimits[0].remaining, 0)
    assert.equal(calls, 1)
    assert.doesNotMatch(JSON.stringify(snapshot), /private-model|Authored private|PROVIDER_MODEL|api\.openai|api\.anthropic/)
    mock.mock.restore()
    providerUsage.clear()
  }
})

test('cached generation clients isolate exact model/provider/tenant identity on the same endpoint', async t => {
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init.body))
    return Response.json(result(config({ model: body.model }), { input_tokens: body.model === 'other-model' ? 9 : 4, output_tokens: 2 }), { headers: rate(config()) })
  })
  const first = config()
  await generateCompactionSummaryPart('fixture', first)
  for (const cfg of [config({ model: 'other-model' }), config({ usageIdentity: { ...first.usageIdentity!, providerId: 'other-provider' } }), config({ usageIdentity: { ...first.usageIdentity!, tenantId: 'other-tenant' } })]) {
    assert.equal(providerUsage.snapshot(cfg).lastRequest, undefined)
    await generateCompactionSummaryPart('fixture', cfg)
    assert.equal(providerUsage.snapshot(cfg).lastRequest?.inputTokens, cfg.model === 'other-model' ? 9 : 4)
    assert.equal(providerUsage.snapshot(first).lastRequest?.inputTokens, 4)
  }
})

test('new missing headers replace old rate readings while independently preserving settled request usage', async t => {
  const cfg = config()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => Response.json(result(cfg, { input_tokens: ++calls, output_tokens: 0 }), { headers: calls === 1 ? rate(cfg) : {} }))
  await generateCompactionSummaryPart('fixture', cfg)
  assert.equal(providerUsage.snapshot(cfg).rateLimits.length, 1)
  await generateCompactionSummaryPart('fixture', cfg)
  assert.deepEqual(providerUsage.snapshot(cfg).rateLimits, [])
  assert.equal(providerUsage.snapshot(cfg).lastRequest?.inputTokens, 2)
  assert.equal(providerUsage.snapshot(cfg).lastRequest?.outputTokens, 0)
})

test('invalid usage never becomes a zero-valued observed request', async t => {
  for (const cfg of [config(), messages()]) {
    for (const usage of [{ input_tokens: -1, output_tokens: 2 }, { input_tokens: 1 }, { input_tokens: 1, output_tokens: '2' }]) {
      const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(result(cfg, usage), { headers: rate(cfg) }))
      await assert.rejects(generateCompactionSummaryPart('fixture', cfg))
      assert.equal(providerUsage.snapshot(cfg).lastRequest, undefined)
      mock.mock.restore()
    }
  }
})

test('credential rotation while generation awaits fences late headers and usage from the new connection', async t => {
  for (const cfg of [config(), messages()]) {
    let release!: (value: Response) => void, began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const mock = t.mock.method(globalThis, 'fetch', async () => { began(); return await new Promise<Response>(resolve => { release = resolve }) })
    const pending = generateCompactionSummaryPart('fixture', cfg)
    await started
    process.env[keyRef] = 'rotated-private-model-fixture'
    release(Response.json(result(cfg, { input_tokens: 8, output_tokens: 4 }), { headers: rate(cfg) }))
    await pending
    assert.equal(providerUsage.snapshot(cfg).lastRequest, undefined)
    assert.deepEqual(providerUsage.snapshot(cfg).rateLimits, [])
    mock.mock.restore()
    process.env[keyRef] = 'private-model-usage-fixture'
  }
})
