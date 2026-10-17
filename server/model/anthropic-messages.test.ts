/** Adapter-only authored fetches: no network and no paid provider calls. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anthropicMessagesClient } from './anthropicMessages.ts'
import { EndpointHttpError, EndpointRetryWaitError } from './endpointRequest.ts'

const PRIVATE = 'AUTHORED_PRIVATE_PROVIDER_DIAGNOSTIC'
const request = (model: string) => ({ model, max_tokens: 32, messages: [{ role: 'user' as const, content: 'Reviewed input.' }] })
const message = { id: 'authored-message', type: 'message', role: 'assistant', model: 'success',
  content: [{ type: 'text', text: 'A successful independent operation.' }], stop_reason: 'end_turn',
  stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } }

for (const streamFailure of [false, true]) {
  test(`shared Messages client isolates overlapping quota and HTTP failures; stream refusal ${streamFailure}`, async t => {
    let release = () => {}
    const controller = new AbortController()
    const options = { signal: controller.signal }
    t.after(() => { controller.abort(); release() })
    let started!: () => void
    const quotaEntered = new Promise<void>(resolve => { started = resolve })
    const calls: string[] = []
    const client = anthropicMessagesClient('https://api.anthropic.com', PRIVATE, async (_url, options) => {
      const model = JSON.parse(String(options?.body)).model
      calls.push(model)
      if (model === 'quota') {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { type: 'insufficient_quota', message: PRIVATE } })))
            release = () => { try { controller.close() } catch { /* Already cancelled by failure cleanup. */ } }
            started()
          },
        }), { status: 429 })
      }
      if (model === 'refused') return Response.json({ error: { type: 'invalid_request_error', message: PRIVATE } }, { status: 422 })
      if (model === 'malformed') return new Response('{not-json', { headers: { 'content-type': 'application/json' } })
      return Response.json(message)
    }, 2)
    const quota = client.messages.create(request('quota'), options)
    // Attach rejection handling before awaiting another operation.
    const quotaOutcome = quota.then(() => { throw new Error('Quota refusal unexpectedly succeeded') }, error => error)
    await quotaEntered
    const refused = streamFailure
      ? client.messages.stream(request('refused'), options).finalMessage()
      : client.messages.create(request('refused'), options)
    await assert.rejects(refused, error => {
      assert.ok(error instanceof EndpointHttpError, 'the exact trusted local error survives SDK wrapping')
      assert.equal(error.status, 422)
      assert.equal(error.quotaExceeded, false, 'the other operation must not lend this one a quota flag')
      assert.equal(error.retryWaitUnfulfilled, false)
      assert.equal(error.cause, undefined)
      assert.doesNotMatch(error.message, new RegExp(PRIVATE))
      return true
    })
    release()
    const quotaError = await quotaOutcome
    assert.ok(quotaError instanceof EndpointHttpError)
    assert.equal(quotaError.status, 429)
    assert.equal(quotaError.quotaExceeded, true)
    assert.equal(quotaError.retryWaitUnfulfilled, false)
    assert.equal(quotaError.cause, undefined)
    assert.doesNotMatch(quotaError.message, new RegExp(PRIVATE))
    assert.equal((await client.messages.create(request('success'), options)).id, message.id, 'a later success cannot inherit a settled failure')
    await assert.rejects(client.messages.create(request('malformed'), options), error => {
      assert.equal(error instanceof EndpointHttpError, false, 'a later parser error cannot inherit a previous operation HTTP/quota failure')
      assert.equal(error instanceof EndpointRetryWaitError, false)
      return true
    })
    assert.deepEqual(calls, ['quota', 'refused', 'success', 'malformed'])
  })
}

test('simultaneously failing create and stream operations retain their own trusted HTTP status', async () => {
  const client = anthropicMessagesClient('https://api.anthropic.com', PRIVATE, async (_url, options) => {
    const status = JSON.parse(String(options?.body)).model === 'first' ? 401 : 422
    return Response.json({ error: { type: 'invalid_request_error', message: PRIVATE } }, { status })
  }, 2)
  const settled = await Promise.allSettled([
    client.messages.create(request('first')),
    client.messages.stream(request('second')).finalMessage(),
  ])
  for (const [index, result] of settled.entries()) {
    assert.equal(result.status, 'rejected')
    if (result.status !== 'rejected') throw new Error('Authored HTTP refusal unexpectedly succeeded')
    assert.ok(result.reason instanceof EndpointHttpError)
    assert.equal(result.reason.status, index === 0 ? 401 : 422)
    assert.equal(result.reason.quotaExceeded, false)
    assert.equal(result.reason.retryWaitUnfulfilled, false)
  }
})

for (const streaming of [false, true]) {
  test(`Messages original deadline retains trusted retry-wait failure despite SDK abort wrapping; stream ${streaming}`, async () => {
    let calls = 0
    const client = anthropicMessagesClient('https://api.anthropic.com', PRIVATE, async () => {
      calls++
      return Response.json({ error: { type: 'overloaded_error', message: PRIVATE } }, { status: 503, headers: { 'retry-after': '5' } })
    }, 2)
    const signal = AbortSignal.timeout(20)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const operation = streaming ? client.messages.stream(request('deadline'), { signal }).finalMessage()
        : client.messages.create(request('deadline'), { signal })
      await assert.rejects(Promise.race([
        operation,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Original deadline did not interrupt retry wait')), 500) }),
      ]), error => {
        assert.ok(error instanceof EndpointRetryWaitError, 'SDK APIUserAbortError must not erase the unfulfilled server minimum')
        assert.equal(error.name, 'TimeoutError')
        assert.equal(error.cause, undefined)
        assert.doesNotMatch(error.message, new RegExp(PRIVATE))
        return true
      })
      assert.equal(calls, 1)
    } finally { if (timer) clearTimeout(timer) }
  })
}

test('Messages already-aborted create, stream and catalog operations perform no fetch', async () => {
  let calls = 0
  const client = anthropicMessagesClient('https://api.anthropic.com', PRIVATE, async () => {
    calls++
    throw new Error('No preflight-aborted operation may reach this fetcher')
  }, 2)
  const controller = new AbortController()
  controller.abort()
  for (const invoke of [
    () => client.messages.create(request('aborted'), { signal: controller.signal }),
    () => client.messages.stream(request('aborted'), { signal: controller.signal }).finalMessage(),
    () => client.models.list({ limit: 100 }, { signal: controller.signal }),
  ]) await assert.rejects(invoke(), /aborted/i)
  assert.equal(calls, 0)
})
