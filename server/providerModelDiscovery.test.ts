import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { discoverProviderModels, providerModelDiscoveryRequest, ProviderModelDiscoveryError } from './providerModelDiscovery.ts'
import { probeProviderEndpoint } from './generate.ts'
import { providerUsage } from './providerUsage.ts'

const secret = 'PRIVATE_DISCOVERY_CREDENTIAL_CANARY'
const reference = 'PROVIDER_DISCOVERY_FIXTURE'
const input = { protocol: 'openai-responses' as const, baseURL: 'https://discovery.invalid/v1' }

function env(t: TestContext, name: string, value: string | undefined) {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]; else process.env[name] = value
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous })
}

test('discovery normalizes only explicit fields and rejects input without echoing private values', () => {
  assert.deepEqual(providerModelDiscoveryRequest({ protocol: 'anthropic-messages', baseURL: ' https://discovery.invalid/anthropic ', apiKeyEnv: ` ${reference} ` }),
    { protocol: 'anthropic-messages', baseURL: 'https://discovery.invalid/anthropic', apiKeyEnv: reference })
  for (const value of [undefined, null, [], {}, { ...input, [secret]: true }, { ...input, apiKeyEnv: secret },
    { ...input, protocol: secret }, { ...input, baseURL: `https://${secret}:password@discovery.invalid` }]) {
    assert.throws(() => providerModelDiscoveryRequest(value), error => {
      assert.ok(error instanceof Error)
      assert.ok(!`${error.message}\n${error.stack}`.includes(secret))
      return true
    })
  }
})

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  test(`${protocol} discovery uses only its declared credential, with no usage observation`, async t => {
    env(t, reference, secret)
    env(t, 'ANTHROPIC_API_KEY', 'AMBIENT_SECRET_MUST_NOT_ESCAPE')
    const observedHeaders: unknown[] = [], observedUsage: unknown[] = []
    t.mock.method(providerUsage, 'observeHeaders', (...args) => observedHeaders.push(args))
    t.mock.method(providerUsage, 'observeUsage', (...args) => observedUsage.push(args))
    const hits: Array<{ url: string; headers: Headers }> = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      hits.push({ url: String(url), headers: new Headers(init?.headers) })
      assert.equal(init?.method?.toUpperCase() ?? 'GET', 'GET')
      assert.equal(init?.body, undefined)
      return Response.json({ data: [{ id: 'chosen-later', display_name: 'Choose explicitly' }], has_more: false },
        { headers: { 'x-ratelimit-limit-tokens': '12345' } })
    })
    const result = await discoverProviderModels({ ...input, protocol, apiKeyEnv: reference })
    assert.deepEqual(result, { models: [{ id: 'chosen-later', label: 'Choose explicitly' }] })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].headers.get(protocol === 'anthropic-messages' ? 'x-api-key' : 'authorization'),
      protocol === 'anthropic-messages' ? secret : `Bearer ${secret}`)
    assert.ok(!JSON.stringify(result).includes(secret))
    assert.deepEqual(observedHeaders, [])
    assert.deepEqual(observedUsage, [])
  })

  test(`${protocol} discovery never inherits ambient credentials and refuses missing references before egress`, async t => {
    env(t, reference, undefined)
    env(t, 'ANTHROPIC_API_KEY', secret)
    env(t, 'ANTHROPIC_BASE_URL', 'https://ambient.invalid')
    const hits: string[] = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      hits.push(String(url))
      assert.ok(!JSON.stringify([...new Headers(init?.headers)]).includes(secret))
      return Response.json({ data: [{ id: 'explicit-endpoint' }] })
    })
    assert.deepEqual(await discoverProviderModels({ ...input, protocol }), { models: [{ id: 'explicit-endpoint', label: 'explicit-endpoint' }] })
    assert.equal(hits.length, 1)
    assert.ok(hits[0].startsWith(input.baseURL))
    await assert.rejects(discoverProviderModels({ ...input, protocol, apiKeyEnv: reference }), ProviderModelDiscoveryError)
    assert.equal(hits.length, 1)
  })
}

test('listing without a model does not loosen the OpenAI generation wall', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return Response.json({ data: [{ id: 'choose-later' }] }) })
  assert.deepEqual(await discoverProviderModels(input), { models: [{ id: 'choose-later', label: 'choose-later' }] })
  await assert.rejects(probeProviderEndpoint(input), /explicit endpoint and model/)
  assert.equal(requests, 1, 'only the list GET leaves the process')
})

for (const status of [401, 403, 404, 429, 500, 503]) test(`discovery HTTP ${status} is one attempt and a sanitized typed refusal`, async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1
    return Response.json({ error: { message: secret } }, { status, headers: { 'retry-after': '1' } })
  })
  await assert.rejects(discoverProviderModels(input), error => {
    assert.ok(error instanceof ProviderModelDiscoveryError)
    assert.equal(error.name, 'ProviderModelDiscoveryError')
    assert.equal(error.cause, undefined)
    assert.ok(!`${error.message}\n${error.stack}`.includes(secret))
    return true
  })
  assert.equal(requests, 1)
})

test('one original deadline bounds paginated discovery with no retry', async t => {
  env(t, 'PROVIDER_PROBE_TIMEOUT_MS', '20')
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests += 1
    if (requests === 1) return Response.json({ data: [{ id: 'first' }], has_more: true, last_id: 'first' })
    await new Promise<void>((_resolve, reject) => {
      const signal = init?.signal
      assert.ok(signal)
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      // AbortSignal.timeout is unref'ed: keep this synthetic pending transport
      // alive only until its abort, rather than allowing the runner to cancel it.
      const keepAlive = setTimeout(() => reject(new Error('deadline failed')), 1_000)
      signal.addEventListener('abort', () => clearTimeout(keepAlive), { once: true })
    })
    throw new Error('unreachable')
  })
  await assert.rejects(discoverProviderModels({ protocol: 'anthropic-messages', baseURL: 'https://discovery.invalid' }), ProviderModelDiscoveryError)
  assert.equal(requests, 2)
})
