/** Retry policy for native Responses is budgeted, bounded and pre-body only. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openaiResponsesClient, EndpointHttpError } from './openaiResponses.ts'

type Reply = { status: number; body: string; headers?: Record<string, string> }

const MESSAGE_REQUEST = {
  model: 'gpt-retry-fixture',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'Retry only before a successful response.' }],
} as never

function completed(id = 'resp-retry-fixture', text = 'completed') {
  return JSON.stringify({
    id,
    object: 'response',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 2, output_tokens: 1 },
  })
}

function scriptedFetch(replies: Reply[], seenSignals: Array<AbortSignal | null | undefined> = []) {
  let calls = 0
  const fetcher: typeof fetch = async (_input, init) => {
    seenSignals.push(init?.signal)
    const reply = replies[calls++]
    if (!reply) throw new Error('fetch fixture exhausted')
    return new Response(reply.body, { status: reply.status, headers: reply.headers })
  }
  return { fetcher, calls: () => calls }
}

function trackedResponse(status: number, content: Uint8Array, headers: Record<string, string> = {}) {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(content) },
    cancel() { cancelled = true },
  })
  return { response: new Response(body, { status, headers }), wasCancelled: () => cancelled }
}

function responseClient(replies: Reply[], retries: number, seenSignals?: Array<AbortSignal | null | undefined>) {
  const scripted = scriptedFetch(replies, seenSignals)
  const client = openaiResponsesClient('https://responses.invalid/v1', 'test-secret-key', scripted.fetcher, retries)
  return { ...scripted, client }
}

const unavailable = (headers: Record<string, string> = {}): Reply => ({
  status: 503,
  body: 'temporary fixture failure',
  headers,
})

test('messages.create honors a retry-attempt budget of zero, one, two, and exhausted', async (t) => {
  await t.test('zero retries means one fetch', async () => {
    const { client, calls } = responseClient([unavailable({ 'retry-after': '0' }), { status: 200, body: completed() }], 0)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      return true
    })
    assert.equal(calls(), 1)
  })

  await t.test('one retry succeeds on the second fetch', async () => {
    const signal = new AbortController().signal
    const seenSignals: Array<AbortSignal | null | undefined> = []
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '0' }), { status: 200, body: completed() },
    ], 1, seenSignals)
    assert.equal((await client.messages.create(MESSAGE_REQUEST, { signal })).id, 'resp-retry-fixture')
    assert.equal(calls(), 2)
    assert.deepEqual(seenSignals, [signal, signal], 'both attempts retain the caller operation signal')
  })

  await t.test('two retries succeed on the third fetch', async () => {
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '0' }), unavailable({ 'retry-after': '0' }),
      { status: 200, body: completed() },
    ], 2)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).id, 'resp-retry-fixture')
    assert.equal(calls(), 3)
  })

  await t.test('retry exhaustion performs at most budget plus one fetches', async () => {
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '0' }), unavailable({ 'retry-after': '0' }), unavailable({ 'retry-after': '0' }),
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      return true
    })
    assert.equal(calls(), 3)
  })
})

test('create, stream and catalog list all retry transient HTTP responses', async (t) => {
  await t.test('non-streaming create retries before decoding JSON', async () => {
    const { client, calls } = responseClient([unavailable({ 'retry-after': '0' }), { status: 200, body: completed('create-retry') }], 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).id, 'create-retry')
    assert.equal(calls(), 2)
  })

  await t.test('stream retries before any successful response body is consumed', async () => {
    const stream = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"stream-retry","status":"in_progress","output":[],"usage":null}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"streamed"}\n\n',
      `event: response.completed\ndata: {"type":"response.completed","response":${completed('stream-retry', 'streamed')}}\n\n`,
    ].join('')
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '0' }),
      { status: 200, body: stream, headers: { 'content-type': 'text/event-stream' } },
    ], 1)
    const deltas: string[] = []
    const pending = client.messages.stream(MESSAGE_REQUEST).on('text', delta => deltas.push(delta)).finalMessage()
    const message = await pending
    assert.equal(message.id, 'stream-retry')
    assert.equal(message.stop_reason, 'end_turn')
    assert.deepEqual(deltas, ['streamed'])
    assert.equal(calls(), 2)
  })

  await t.test('models.list retries and returns the successful catalog', async () => {
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '0' }),
      { status: 200, body: JSON.stringify({ object: 'list', data: [{ id: 'gpt-retried' }] }) },
    ], 1)
    assert.deepEqual(await client.models.list({ limit: 20 }), { data: [{ id: 'gpt-retried' }] })
    assert.equal(calls(), 2)
  })
})

test('eligible HTTP statuses retry before handing off a response', async (t) => {
  for (const status of [408, 409, 429, 500] as const) {
    await t.test(`HTTP ${status}`, async () => {
      const body = status === 429
        ? JSON.stringify({ error: { code: 'rate_limit_exceeded', type: 'rate_limit_error' } })
        : 'temporary endpoint failure'
      const { client, calls } = responseClient([
        { status, body, headers: { 'retry-after': '0' } },
        { status: 200, body: completed(`eligible-${status}`) },
      ], 1)
      assert.equal((await client.messages.create(MESSAGE_REQUEST)).id, `eligible-${status}`)
      assert.equal(calls(), 2)
    })
  }
})

test('Retry-After zero seconds and HTTP date are honored without delaying unnecessarily', async (t) => {
  await t.test('zero seconds permits the next attempt', async () => {
    const { client, calls } = responseClient([unavailable({ 'retry-after': '0' }), { status: 200, body: completed() }], 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
    assert.equal(calls(), 2)
  })

  await t.test('a past HTTP date permits the next attempt', async () => {
    const past = new Date(Date.now() - 5_000).toUTCString()
    const { client, calls } = responseClient([unavailable({ 'retry-after': past }), { status: 200, body: completed() }], 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
    assert.equal(calls(), 2)
  })

  await t.test('a future HTTP date is respected', async () => {
    const retryAt = Math.ceil((Date.now() + 1_500) / 1_000) * 1_000
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': new Date(retryAt).toUTCString() }),
      { status: 200, body: completed() },
    ], 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
    assert.equal(calls(), 2)
    assert.ok(Date.now() >= retryAt, 'the retry must not precede the HTTP date')
  })
})

test('invalid or absent Retry-After falls back to a bounded retry', async (t) => {
  for (const [label, headers] of [['invalid value', { 'retry-after': 'not-a-date' }], ['missing value', {}]] as const) {
    await t.test(label, async () => {
      const { client, calls } = responseClient([unavailable(headers), { status: 200, body: completed() }], 1)
      assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
      assert.equal(calls(), 2)
    })
  }
})

test('an unfulfilled Retry-After is surfaced instead of retrying early', async () => {
  const controller = new AbortController()
  const { client, calls } = responseClient([unavailable({ 'retry-after': '61' }), { status: 200, body: completed() }], 2)
  const stopLongWait = setTimeout(() => controller.abort(new DOMException('test guard', 'TimeoutError')), 100)
  try {
    await assert.rejects(client.messages.create(MESSAGE_REQUEST, { signal: controller.signal }), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      assert.equal(error.retryWaitUnfulfilled, true)
      return true
    })
  } finally {
    clearTimeout(stopLongWait)
  }
  assert.equal(calls(), 1)
})

test('invalid numeric Retry-After values do not overflow or masquerade as dates', async (t) => {
  await t.test('a very long numeric delay is excessive and refuses retry', async () => {
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '9'.repeat(400) }), { status: 200, body: completed() },
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      assert.equal(error.retryWaitUnfulfilled, true)
      return true
    })
    assert.equal(calls(), 1)
  })

  await t.test('negative numeric value is invalid and uses exponential fallback', async () => {
    const began = Date.now()
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '-1' }), { status: 200, body: completed() },
    ], 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
    assert.equal(calls(), 2)
    assert.ok(Date.now() - began >= 375, 'negative numeric input does not parse as an HTTP date')
  })

  await t.test('retry-after-ms combines with Retry-After using the greater hint', async () => {
    const began = Date.now()
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '0', 'retry-after-ms': '50' }),
      { status: 200, body: completed() },
    ], 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
    assert.equal(calls(), 2)
    assert.ok(Date.now() - began >= 50, 'the retry honors the greater millisecond hint')
  })
})

test('explicit x-should-retry false and permanent/quota refusals are terminal', async (t) => {
  for (const status of [400, 401, 403, 404, 422] as const) {
    await t.test(`HTTP ${status}`, async () => {
      const { client, calls } = responseClient([
        { status, body: 'permanent refusal', headers: { 'retry-after': '0' } },
        { status: 200, body: completed() },
      ], 2)
      await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
        assert.ok(error instanceof EndpointHttpError)
        assert.equal(error.status, status)
        return true
      })
      assert.equal(calls(), 1)
    })
  }

  await t.test('transient status is explicitly marked non-retryable', async () => {
    const { client, calls } = responseClient([
      { status: 503, body: 'do not retry', headers: { 'x-should-retry': 'false', 'retry-after': '0' } },
      { status: 200, body: completed() },
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), EndpointHttpError)
    assert.equal(calls(), 1)
  })

  await t.test('quota 429 with an explicit terminal retry hint is not replayed', async () => {
    const { client, calls } = responseClient([
      { status: 429, body: '{"error":{"code":"insufficient_quota"}}', headers: { 'x-should-retry': 'false' } },
      { status: 200, body: completed() },
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 429)
      return true
    })
    assert.equal(calls(), 1)
  })

  await t.test('known quota 429 codes/types are terminal without a retry header', async (t) => {
    const knownQuotaErrors = [
      ['credit_balance_exhausted code', { error: { code: 'credit_balance_exhausted' } }],
      ['organization_spend_limit_exceeded code', { error: { code: 'organization_spend_limit_exceeded' } }],
      ['project_spend_limit_exceeded code', { error: { code: 'project_spend_limit_exceeded' } }],
      ['organization_usage_limit_exceeded code', { error: { code: 'organization_usage_limit_exceeded' } }],
      ['insufficient_quota code', { error: { code: 'insufficient_quota' } }],
      ['insufficient_quota type', { error: { type: 'insufficient_quota' } }],
    ] as const
    for (const [label, body] of knownQuotaErrors) {
      await t.test(label, async () => {
        const { client, calls } = responseClient([
          { status: 429, body: JSON.stringify(body) },
          { status: 200, body: completed() },
        ], 2)
        await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
          assert.ok(error instanceof EndpointHttpError)
          assert.equal(error.status, 429)
          assert.equal((error as EndpointHttpError & { quotaExceeded?: boolean }).quotaExceeded, true)
          assert.equal(error.message.includes(JSON.stringify(body)), false)
          return true
        })
        assert.equal(calls(), 1)
      })
    }
  })
})

test('retry uses the caller signal and cancellation interrupts Retry-After backoff', async () => {
  const controller = new AbortController()
  const signals: Array<AbortSignal | null | undefined> = []
  const { client, calls } = responseClient([
    unavailable({ 'retry-after': '5' }),
    { status: 200, body: completed() },
  ], 1, signals)
  const pending = client.messages.create(MESSAGE_REQUEST, { signal: controller.signal })
  const cancel = setTimeout(() => controller.abort(new DOMException('deadline reached', 'TimeoutError')), 20)
  try {
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  } finally {
    clearTimeout(cancel)
  }
  assert.equal(calls(), 1, 'cancellation during backoff prevents another fetch')
  assert.deepEqual(signals, [controller.signal], 'the retry loop preserves the original operation signal')
})

test('positive Retry-After remains visible when this transport cannot honor it', async (t) => {
  await t.test('zero retry budget marks the required wait unfulfilled', async () => {
    const { client, calls } = responseClient([
      unavailable({ 'retry-after': '5' }), { status: 200, body: completed() },
    ], 0)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      assert.equal(error.retryWaitUnfulfilled, true)
      return true
    })
    assert.equal(calls(), 1)
  })

  await t.test('explicit no-retry hint does not erase the provider wait requirement', async () => {
    const { client, calls } = responseClient([
      { status: 503, body: 'terminal response', headers: { 'x-should-retry': 'false', 'retry-after': '5' } },
      { status: 200, body: completed() },
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      assert.equal(error.retryWaitUnfulfilled, true)
      return true
    })
    assert.equal(calls(), 1)
  })

  await t.test('ordinary 503 without a positive server hint keeps its generic classification', async () => {
    const { client, calls } = responseClient([{ status: 503, body: 'ordinary failure' }], 0)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 503)
      assert.equal(error.retryWaitUnfulfilled, false)
      return true
    })
    assert.equal(calls(), 1)
  })
})

test('network rejection may retry, but a pre-aborted operation performs no fetch', async (t) => {
  await t.test('network error retries within the attempt budget', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      if (calls === 1) throw new TypeError('socket reset before response headers')
      return new Response(completed('network-recovered'), { status: 200 })
    }
    const client = openaiResponsesClient('https://responses.invalid/v1', 'test-secret-key', fetcher, 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).id, 'network-recovered')
    assert.equal(calls, 2)
  })

  await t.test('pre-aborted deadline stops before transport', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('deadline already elapsed', 'TimeoutError'))
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      return new Response(completed(), { status: 200 })
    }
    const client = openaiResponsesClient('https://responses.invalid/v1', 'test-secret-key', fetcher, 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST, { signal: controller.signal }),
      (error: unknown) => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    assert.equal(calls, 0)
  })
})

test('failed HTTP response bodies are cancelled before retry or terminal return', async (t) => {
  await t.test('nonempty transient error body is cancelled before a retry', async () => {
    const failed = trackedResponse(503, new TextEncoder().encode('temporary gateway detail'), { 'retry-after': '0' })
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      return calls === 1 ? failed.response : new Response(completed(), { status: 200 })
    }
    const client = openaiResponsesClient('https://responses.invalid/v1', 'test-secret-key', fetcher, 1)
    assert.equal((await client.messages.create(MESSAGE_REQUEST)).stop_reason, 'end_turn')
    assert.equal(calls, 2)
    assert.equal(failed.wasCancelled(), true)
  })

  await t.test('oversized 429 error body is cancelled and never exposed', async () => {
    const oversized = trackedResponse(429, new Uint8Array(8 * 1024 * 1024 + 1))
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      return oversized.response
    }
    const client = openaiResponsesClient('https://responses.invalid/v1', 'test-secret-key', fetcher, 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes('error'), false)
      return true
    })
    assert.equal(calls, 1)
    assert.equal(oversized.wasCancelled(), true)
  })

  await t.test('deadline while reading a nonempty error body cancels its reader', async () => {
    let cancelled = false
    let calls = 0
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')) },
      pull() { return new Promise<void>(() => {}) },
      cancel() { cancelled = true },
    })
    const fetcher: typeof fetch = async () => {
      calls += 1
      return new Response(body, { status: 429, headers: { 'content-type': 'application/json' } })
    }
    const controller = new AbortController()
    const client = openaiResponsesClient('https://responses.invalid/v1', 'test-secret-key', fetcher, 2)
    const pending = client.messages.create(MESSAGE_REQUEST, { signal: controller.signal })
    const cancel = setTimeout(() => controller.abort(new DOMException('operation deadline', 'TimeoutError')), 20)
    try {
      await assert.rejects(pending, (error: unknown) => error instanceof Error
        && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    } finally {
      clearTimeout(cancel)
    }
    assert.equal(calls, 1)
    assert.equal(cancelled, true)
  })
})

test('successful HTTP responses are never replayed for invalid JSON or stream failures', async (t) => {
  await t.test('invalid JSON from create is terminal', async () => {
    const { client, calls } = responseClient([
      { status: 200, body: 'not valid JSON' }, { status: 200, body: completed() },
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), /invalid JSON/i)
    assert.equal(calls(), 1)
  })

  await t.test('malformed successful SSE is terminal', async () => {
    const { client, calls } = responseClient([
      { status: 200, body: 'event: response.created\ndata: {not-json}\n\n', headers: { 'content-type': 'text/event-stream' } },
      { status: 200, body: completed() },
    ], 2)
    await assert.rejects(client.messages.stream(MESSAGE_REQUEST).finalMessage(), /invalid JSON/i)
    assert.equal(calls(), 1)
  })

  await t.test('partial text followed by an in-band stream error is not replayed', async () => {
    const body = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"partial","status":"in_progress","output":[],"usage":null}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial text"}\n\n',
      'event: error\ndata: {"type":"error","error":{"message":"fixture stream failed"}}\n\n',
    ].join('')
    const { client, calls } = responseClient([
      { status: 200, body, headers: { 'content-type': 'text/event-stream' } },
      { status: 200, body: completed() },
    ], 2)
    const deltas: string[] = []
    const pending = client.messages.stream(MESSAGE_REQUEST).on('text', delta => deltas.push(delta)).finalMessage()
    await assert.rejects(pending, /stream reported an error/i)
    assert.deepEqual(deltas, ['partial text'])
    assert.equal(calls(), 1)
  })
})

test('transport errors and HTTP bodies never disclose credentials', async (t) => {
  await t.test('fetch exception is replaced with safe text and no cause', async () => {
    const secret = 'fixture-super-secret-token'
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      throw new Error(`failed for https://user:${secret}@host Authorization: Bearer ${secret}`)
    }
    const client = openaiResponsesClient('https://responses.invalid/v1', secret, fetcher, 0)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'The model endpoint request failed.')
      assert.equal(error.cause, undefined)
      assert.equal(error.message.includes(secret), false)
      return true
    })
    assert.equal(calls, 1, 'a valid request reached the throwing transport exactly once')
  })

  await t.test('credential-bearing URL validation is rejected before fetch', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      return new Response(completed(), { status: 200 })
    }
    const client = openaiResponsesClient('https://user:password@responses.invalid/v1', 'safe-key', fetcher, 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), /request failed/i)
    assert.equal(calls, 0)
  })

  await t.test('HTTP error body is neither exposed nor attached as a cause', async () => {
    const secret = 'fixture-super-secret-token'
    const { client, calls } = responseClient([
      { status: 401, body: `invalid key ${secret}`, headers: { 'x-should-retry': 'false' } },
    ], 2)
    await assert.rejects(client.messages.create(MESSAGE_REQUEST), (error: unknown) => {
      assert.ok(error instanceof EndpointHttpError)
      assert.equal(error.status, 401)
      assert.equal(error.message.includes(secret), false)
      assert.equal(error.cause, undefined)
      return true
    })
    assert.equal(calls(), 1)
  })
})
