import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  OPENAI_SMOKE_KEY,
  OPENAI_SMOKE_MODEL,
  OPENAI_SMOKE_REASONING,
  OPENAI_SMOKE_REPLACEMENT_KEY,
  startOpenAIResponsesSmokeFixture,
} from './openaiResponsesSmokeFixture.mjs'

function probeBody() {
  return {
    model: OPENAI_SMOKE_MODEL,
    stream: false,
    store: false,
    tools: [{ type: 'function', name: 'probe_noop', parameters: { type: 'object' } }],
    input: [{ role: 'user', content: 'Conformance check.' }],
  }
}

function streamBody(input = [{ role: 'user', content: 'Check my usage.' }]) {
  return {
    model: OPENAI_SMOKE_MODEL,
    stream: true,
    store: false,
    tools: [{ type: 'function', name: 'api__get_usage', parameters: { type: 'object' } }],
    input,
  }
}

function sseEvents(raw: string) {
  return raw.trim().split(/\r?\n\r?\n/).map(frame => {
    const lines = frame.split(/\r?\n/)
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.find(line => line.startsWith('data:'))?.slice(5).trim()
    assert.ok(event)
    assert.ok(data)
    return { event, body: JSON.parse(data!) as Record<string, any> }
  })
}

const post = (origin: string, body: unknown, key = OPENAI_SMOKE_KEY) => fetch(`${origin}/responses`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

test('fixture serves an authenticated catalog and a valid detached nonstream probe without capturing headers', async () => {
  const fixture = await startOpenAIResponsesSmokeFixture()
  try {
    const catalog = await fetch(`${fixture.origin}/models`, { headers: { authorization: `Bearer ${OPENAI_SMOKE_KEY}` } })
    assert.equal(catalog.status, 200)
    assert.equal((await catalog.json()).data[0].id, OPENAI_SMOKE_MODEL)
    assert.equal(fixture.catalogCount, 1)

    const body = probeBody()
    const response = await post(fixture.origin, body)
    const result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 1 })
    body.input[0].content = 'changed after request'
    assert.deepEqual(fixture.requests, [probeBody()])
    const captured = JSON.stringify(fixture.requests)
    assert.doesNotMatch(captured, /authorization|agent-commons-openai-(?:smoke-not-a-real-key|rejected-not-a-real-key)/i)
  } finally {
    await fixture.close()
  }
})

test('rejects wrong credentials and accepts the replacement key only for its failed nonstream probe', async () => {
  const fixture = await startOpenAIResponsesSmokeFixture()
  try {
    assert.equal((await fetch(`${fixture.origin}/models`, { headers: { authorization: 'Bearer wrong-key' } })).status, 401)
    assert.equal((await post(fixture.origin, probeBody(), 'Bearer malformed')).status, 401)
    assert.equal(fixture.catalogCount, 0)
    assert.equal(fixture.requests.length, 0)

    fixture.setMode('failed-probe')
    const probe = await post(fixture.origin, probeBody(), OPENAI_SMOKE_REPLACEMENT_KEY)
    assert.equal(probe.status, 200)
    assert.equal((await probe.json()).status, 'failed')
    assert.equal(fixture.requests.length, 1)

    const regular = await post(fixture.origin, streamBody(), OPENAI_SMOKE_REPLACEMENT_KEY)
    assert.equal(regular.status, 401, 'the replacement key never authorizes a regular turn')
    assert.equal(fixture.requests.length, 1, 'rejected turn is not captured')

    const models = await fetch(`${fixture.origin}/models`, { headers: { authorization: `Bearer ${OPENAI_SMOKE_REPLACEMENT_KEY}` } })
    assert.equal(models.status, 401, 'the replacement key cannot read the catalog')
  } finally {
    await fixture.close()
  }
})

test('streams a reasoning-bearing usage tool call and its text continuation with ordered Responses events', async () => {
  const fixture = await startOpenAIResponsesSmokeFixture()
  try {
    const firstBody = streamBody()
    const first = await post(fixture.origin, firstBody)
    assert.equal(first.status, 200)
    assert.match(first.headers.get('content-type') ?? '', /text\/event-stream/i)
    const events = sseEvents(await first.text())
    assert.deepEqual(events.map(event => event.event), [
      'response.created', 'response.output_item.added', 'response.output_item.done',
      'response.output_item.added', 'response.function_call_arguments.delta',
      'response.function_call_arguments.done', 'response.output_item.done', 'response.completed',
    ])
    assert.deepEqual(events.map(event => event.body.sequence_number), [0, 1, 2, 3, 4, 5, 6, 7])
    const completed = events.at(-1)!.body.response
    assert.equal(completed.status, 'completed')
    assert.deepEqual(completed.output[0], OPENAI_SMOKE_REASONING)
    assert.deepEqual(completed.output[1], {
      id: 'fc_item_openai_smoke', type: 'function_call', call_id: 'openai-smoke-usage',
      name: 'api__get_usage', arguments: '{"query":{}}', status: 'completed',
    })
    assert.deepEqual(completed.usage, { input_tokens: 17, output_tokens: 13 })

    const continuationBody = streamBody([
      { id: OPENAI_SMOKE_REASONING.id, type: 'reasoning', summary: [], encrypted_content: OPENAI_SMOKE_REASONING.encrypted_content },
      { type: 'function_call', call_id: 'openai-smoke-usage', name: 'api__get_usage', arguments: '{"query":{}}' },
      { type: 'function_call_output', call_id: 'openai-smoke-usage', output: '{"remaining":42}' },
    ])
    const continuation = await post(fixture.origin, continuationBody)
    assert.equal(continuation.status, 200)
    const finalEvents = sseEvents(await continuation.text())
    assert.equal(finalEvents.at(-1)?.body.response.output[0].content[0].text, 'The packaged OpenAI tool round completed.')
    assert.deepEqual(fixture.requests, [firstBody, continuationBody])
    assert.ok(fixture.requests.every(body => body.store === false))
    assert.doesNotMatch(JSON.stringify(fixture.requests), /authorization|agent-commons-openai-(?:smoke-not-a-real-key|rejected-not-a-real-key)/i)
  } finally {
    await fixture.close()
  }
})

test('text mode returns the post-relaunch turn and failed mode never stores credentials in captures', async () => {
  const fixture = await startOpenAIResponsesSmokeFixture()
  try {
    fixture.setMode('text')
    const response = await post(fixture.origin, streamBody())
    const events = sseEvents(await response.text())
    assert.equal(events.at(-1)?.body.response.output[0].content[0].text, 'The restored OpenAI connection completed another turn.')
    assert.equal(events.at(-1)?.body.response.usage.input_tokens, 17)

    fixture.setMode('failed-probe')
    const failed = await post(fixture.origin, probeBody(), OPENAI_SMOKE_REPLACEMENT_KEY)
    assert.equal((await failed.json()).status, 'failed')
    assert.equal(fixture.requests.length, 2)
    assert.doesNotMatch(JSON.stringify(fixture.requests), /authorization|agent-commons-openai-(?:smoke-not-a-real-key|rejected-not-a-real-key)/i)
  } finally {
    await fixture.close()
  }
})

test('rejects unsupported model, non-array input, and store=true on probes and streamed turns', async () => {
  const fixture = await startOpenAIResponsesSmokeFixture()
  try {
    const invalidBodies = [
      { ...probeBody(), model: 'another-model' },
      { ...probeBody(), input: { role: 'user', content: 'not an array' } },
      { ...probeBody(), store: true },
      { ...streamBody(), model: 'another-model' },
      { ...streamBody(), input: { role: 'user', content: 'not an array' } },
      { ...streamBody(), store: true },
    ]

    for (const body of invalidBodies) {
      const response = await post(fixture.origin, body)
      assert.equal(response.status, 400)
      assert.equal(fixture.requests.length, 0, 'invalid request is not captured')
    }
  } finally {
    await fixture.close()
  }
})

test('refuses malformed and oversized POST bodies and closes its loopback sockets idempotently', async (t) => {
  const fixture = await startOpenAIResponsesSmokeFixture()
  t.after(() => fixture.close())
  assert.equal((await post(fixture.origin, '{not json')).status, 400)
  const oversized = JSON.stringify({ filler: 'x'.repeat(260 * 1024) })
  const large = await post(fixture.origin, oversized)
  assert.equal(large.status, 413)
  assert.equal(fixture.requests.length, 0)
  assert.equal((await fetch(`${fixture.origin}/not-responses`)).status, 404)
  await Promise.all([fixture.close(), fixture.close()])
  await assert.rejects(fetch(`${fixture.origin}/models`))
})
