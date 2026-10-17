import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startMessagesSmokeFixture, MESSAGES_SMOKE_KEY, MESSAGES_SMOKE_MODEL,
  MESSAGES_SMOKE_PRIVATE_ERROR, MESSAGES_SMOKE_TOOL_REPLY, MESSAGES_SMOKE_TEXT_REPLY } from './messagesSmokeFixture.mjs'

const body = (messages: unknown[] = [{ role: 'user', content: 'Check usage.' }]) => ({
  model: MESSAGES_SMOKE_MODEL, max_tokens: 128, stream: true, messages,
  tools: [{ name: 'api__get_usage', input_schema: { type: 'object' } }],
})
const probe = () => ({ ...body(), stream: false, tools: [{ name: 'probe_noop', input_schema: { type: 'object' } }] })
const post = (baseURL: string, value: unknown, key = MESSAGES_SMOKE_KEY) => fetch(`${baseURL}/v1/messages`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
  body: typeof value === 'string' ? value : JSON.stringify(value),
})
const events = (raw: string): any[] => raw.trim().split('\n\n').map(frame => JSON.parse(frame.split('\n').find(line => line.startsWith('data: '))!.slice(6)))

for (const family of ['claude', 'deepseek'] as const) {
  test(`${family} fixture mounts exact authenticated paginated catalog and isolated probe`, async t => {
    const fixture = await startMessagesSmokeFixture({ family })
    t.after(() => fixture.close())
    assert.equal(new URL(fixture.baseURL).hostname, '127.0.0.1')
    assert.equal(new URL(fixture.baseURL).pathname, family === 'deepseek' ? '/anthropic' : '/')
    assert.equal((await fetch(`${fixture.baseURL}/v1/models`)).status, 401)
    const headers = { 'x-api-key': MESSAGES_SMOKE_KEY }
    const first = await (await fetch(`${fixture.baseURL}/v1/models?limit=1000`, { headers })).json()
    assert.equal(first.has_more, true)
    assert.notEqual(first.data[0].id, MESSAGES_SMOKE_MODEL)
    const second = await (await fetch(`${fixture.baseURL}/v1/models?limit=1000&after_id=${first.last_id}`, { headers })).json()
    assert.equal(second.has_more, false)
    assert.equal(second.data[0].id, MESSAGES_SMOKE_MODEL)
    assert.deepEqual(second.data[0].capabilities.effort, { supported: false })
    assert.equal(fixture.catalogCount, 2)
    assert.equal((await fetch(`${fixture.baseURL}/v1/models?after_id=wrong`, { headers })).status, 400)
    assert.equal((await post(fixture.baseURL, probe(), 'wrong-key')).status, 401)
    assert.equal(fixture.requests.length, 0)
    fixture.setMode('quota')
    const checked = await (await post(fixture.baseURL, probe())).json()
    assert.equal(checked.stop_reason, 'end_turn')
    assert.deepEqual(checked.content, [{ type: 'text', text: 'ok' }])
    assert.deepEqual(checked.usage, { input_tokens: 1, output_tokens: 1 })
    assert.deepEqual(fixture.requests, [probe()])
    assert.ok(!JSON.stringify(fixture.requests).includes(MESSAGES_SMOKE_KEY))
    const foreign = family === 'deepseek' ? '/v1/messages' : '/anthropic/v1/messages'
    assert.equal((await fetch(`${new URL(fixture.baseURL).origin}${foreign}`, { method: 'POST' })).status, 404)
  })

  test(`${family} tool continuation retries exactly once and streams cache-aware usage`, async t => {
    const fixture = await startMessagesSmokeFixture({ family })
    t.after(() => fixture.close())
    for (let cycle = 0; cycle < 2; cycle++) {
      fixture.setMode('retry-tools')
      const initial = events(await (await post(fixture.baseURL, body())).text())
      assert.deepEqual(initial.map(event => event.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'])
      assert.deepEqual(initial[0].message.usage, { input_tokens: 11, output_tokens: 0, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 })
      assert.equal(initial[1].content_block.name, 'api__get_usage')
      assert.deepEqual(JSON.parse(initial[2].delta.partial_json), { query: {} })
      assert.deepEqual(initial.at(-2).usage, { output_tokens: 4 })
      assert.equal(initial.at(-2).delta.stop_reason, 'tool_use')
      const continuation = body([{ role: 'assistant', content: [{ type: 'tool_use', id: initial[1].content_block.id, name: 'api__get_usage', input: { query: {} } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: initial[1].content_block.id, content: '{"remaining":42}' }] }])
      const failed = await post(fixture.baseURL, continuation)
      assert.equal(failed.status, 503)
      assert.equal(failed.headers.get('retry-after'), '0')
      assert.equal((await failed.json()).error.message, MESSAGES_SMOKE_PRIVATE_ERROR)
      const completed = events(await (await post(fixture.baseURL, continuation)).text())
      assert.equal(completed[2].delta.text, MESSAGES_SMOKE_TOOL_REPLY)
      assert.equal(completed.at(-2).delta.stop_reason, 'end_turn')
      assert.deepEqual(fixture.requests.slice(-3), [body(), continuation, continuation])
    }
    fixture.setMode('text')
    assert.equal(events(await (await post(fixture.baseURL, body())).text())[2].delta.text, MESSAGES_SMOKE_TEXT_REPLY)
    const capture = JSON.stringify(fixture.requests)
    assert.ok(!capture.includes(MESSAGES_SMOKE_PRIVATE_ERROR))
    assert.ok(!capture.includes(MESSAGES_SMOKE_KEY))
    assert.doesNotMatch(capture, /x-api-key|service_unavailable_error/)
  })

  test(`${family} quota and retry wait refuse streams but retain normal probes and reset counters`, async t => {
    const fixture = await startMessagesSmokeFixture({ family })
    t.after(() => fixture.close())
    for (const mode of ['quota', 'retry-wait'] as const) {
      fixture.setMode(mode)
      assert.equal(fixture.retryWaitResponses, 0)
      assert.equal(fixture.retryWaitStartedAt, 0)
      assert.equal((await post(fixture.baseURL, probe())).status, 200)
      assert.equal(fixture.retryWaitStartedAt, 0, 'probes do not start an ordinary retry wait')
      const before = Date.now()
      const refused = await post(fixture.baseURL, body())
      assert.equal(refused.status, mode === 'quota' ? 429 : 503)
      assert.equal(refused.headers.get('retry-after'), mode === 'quota' ? null : '5')
      const error = (await refused.json()).error
      assert.equal(error.message, MESSAGES_SMOKE_PRIVATE_ERROR)
      if (mode === 'quota') assert.equal(error.code, 'insufficient_quota')
      assert.equal(fixture.retryWaitResponses, mode === 'quota' ? 0 : 1)
      if (mode === 'quota') assert.equal(fixture.retryWaitStartedAt, 0)
      else {
        const startedAt = fixture.retryWaitStartedAt
        assert.ok(startedAt >= before && startedAt <= Date.now())
        await new Promise(resolve => setTimeout(resolve, 5))
        assert.equal((await post(fixture.baseURL, body())).status, 503)
        assert.equal(fixture.retryWaitResponses, 2)
        assert.equal(fixture.retryWaitStartedAt, startedAt, 'later refusals do not extend the original wait timestamp')
      }
    }
    assert.throws(() => { fixture.retryWaitResponses = 5 }, TypeError)
    assert.throws(() => { fixture.retryWaitStartedAt = 5 }, TypeError)
    assert.throws(() => fixture.setMode('unknown'), TypeError)
    fixture.setMode('text')
    assert.equal(fixture.retryWaitResponses, 0)
    assert.equal(fixture.retryWaitStartedAt, 0)
  })
}

test('Messages fixture bounds malformed bodies and retained captures, and closes idempotently', async t => {
  const fixture = await startMessagesSmokeFixture({ family: 'claude' })
  t.after(() => fixture.close())
  assert.equal((await post(fixture.baseURL, '{broken')).status, 400)
  assert.equal((await post(fixture.baseURL, 'x'.repeat(260 * 1024))).status, 413)
  assert.equal((await post(fixture.baseURL, { ...body(), model: 'wrong' })).status, 400)
  assert.equal((await post(fixture.baseURL, { ...body(), messages: {} })).status, 400)
  assert.equal((await post(fixture.baseURL, { ...body(), output_config: { effort: 'high' } })).status, 400)
  assert.equal((await post(fixture.baseURL, { ...body(), stream: false })).status, 400)
  assert.equal(fixture.requests.length, 0)
  for (let index = 0; index < 32; index++) assert.equal((await post(fixture.baseURL, probe())).status, 200)
  assert.equal((await post(fixture.baseURL, probe())).status, 429)
  assert.equal(fixture.requests.length, 32)
  await Promise.all([fixture.close(), fixture.close()])
  await assert.rejects(fetch(`${fixture.baseURL}/v1/models`))
  await assert.rejects(startMessagesSmokeFixture({ family: 'other' }), TypeError)
})
