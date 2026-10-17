import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProviderUsageRegistry, providerUsageCacheKey } from './providerUsage.ts'
import type { ProviderConfig } from './data/providers.ts'

const reference = 'PROVIDER_USAGE_UNIT_KEY'
process.env[reference] = 'synthetic-unit-key'
const config = (patch: Partial<ProviderConfig> = {}): ProviderConfig => ({
  protocol: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: reference,
  model: 'unit-model', usageIdentity: { providerId: 'p', tenantId: 't', connectionRevision: 1 }, ...patch,
})
const balance = () => ({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '2.00', granted_balance: '0.00', topped_up_balance: '2.00' }] })
const headers = (remaining = '0') => new Headers({ 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': remaining, 'x-ratelimit-reset-requests': '1m2.5s' })
const openai = () => config({ protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1' })

test('rate observations preserve zero, normalize durations, and replace malformed/missing newer headers', () => {
  let time = 1000
  const registry = new ProviderUsageRegistry({ now: () => time })
  registry.observeHeaders(openai(), headers())
  assert.deepEqual(registry.snapshot(openai()).rateLimits, [{ key: 'requests', limit: 10, remaining: 0, observedAt: 1000, resetAt: 63500 }])
  time = 100000
  assert.equal(registry.snapshot(openai()).rateLimits[0].remaining, 0)
  for (const value of ['-1', '1e2', 'NaN', '9007199254740992', '11', '']) {
    registry.observeHeaders(openai(), headers(value))
    assert.deepEqual(registry.snapshot(openai()).rateLimits, [])
  }
  registry.observeHeaders(openai(), headers('4'))
  registry.observeHeaders(openai(), new Headers())
  assert.deepEqual(registry.snapshot(openai()).rateLimits, [])
})

test('Claude rates normalize absolute dates and discard malformed resets without inventing dates', () => {
  const registry = new ProviderUsageRegistry({ now: () => 5 })
  const cfg = config({ protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com' })
  registry.observeHeaders(cfg, new Headers({ 'anthropic-ratelimit-input-tokens-limit': '1000', 'anthropic-ratelimit-input-tokens-remaining': '0', 'anthropic-ratelimit-input-tokens-reset': '2026-01-01T00:00:00Z' }))
  assert.equal(registry.snapshot(cfg).rateLimits[0].resetAt, Date.parse('2026-01-01T00:00:00Z'))
  registry.observeHeaders(cfg, new Headers({ 'anthropic-ratelimit-tokens-limit': '0', 'anthropic-ratelimit-tokens-remaining': '0', 'anthropic-ratelimit-tokens-reset': 'tomorrow' }))
  assert.deepEqual(registry.snapshot(cfg).rateLimits, [{ key: 'tokens', limit: 0, remaining: 0, observedAt: 5 }])
})

test('rate parser bounds malformed and overflow values and handles each supported header family', () => {
  const registry = new ProviderUsageRegistry({ now: () => 100 })
  for (const reset of ['-1s', '1e30s', '999999999999999999999999h', 'tomorrow', '', '1mgarbage']) {
    const reading = headers('3')
    reading.set('x-ratelimit-reset-requests', reset)
    registry.observeHeaders(openai(), reading)
    assert.equal(registry.snapshot(openai()).rateLimits[0].resetAt, undefined)
  }
  for (const [value, offset] of [['250ms', 250], ['2h3m4s5ms', 7384005], ['1d', 86400000], ['0s', 0]]) {
    const reading = headers('3')
    reading.set('x-ratelimit-reset-requests', String(value))
    registry.observeHeaders(openai(), reading)
    assert.equal(registry.snapshot(openai()).rateLimits[0].resetAt, 100 + Number(offset))
  }
  const project = new Headers({ 'x-ratelimit-limit-project-tokens': '4000', 'x-ratelimit-remaining-project-tokens': '0', 'x-ratelimit-reset-project-tokens': '3s' })
  registry.observeHeaders(openai(), project)
  assert.deepEqual(registry.snapshot(openai()).rateLimits, [{ key: 'project-tokens', limit: 4000, remaining: 0, observedAt: 100, resetAt: 3100 }])
  const custom = config({ baseURL: 'https://custom.example' })
  registry.observeHeaders(custom, project)
  assert.deepEqual(registry.snapshot(custom).rateLimits, [])
})

test('private identity, credentials and connection/model/tenant/provider partitions cannot alias', () => {
  const registry = new ProviderUsageRegistry()
  const cfg = config()
  registry.observeUsage(cfg, { inputTokens: 1, outputTokens: 2 })
  const firstKey = providerUsageCacheKey(cfg)
  for (const changed of [config({ model: 'other' }), config({ baseURL: 'https://custom.example/v1' }), config({ usageIdentity: { ...cfg.usageIdentity!, connectionRevision: 2 } }), config({ usageIdentity: { ...cfg.usageIdentity!, providerId: 'q' } }), config({ usageIdentity: { ...cfg.usageIdentity!, tenantId: 'u' } })]) {
    assert.equal(registry.snapshot(changed).lastRequest, undefined)
    assert.notEqual(providerUsageCacheKey(changed), firstKey)
  }
  process.env[reference] = 'rotated-unit-key'
  assert.equal(registry.snapshot(cfg).lastRequest, undefined)
  assert.notEqual(providerUsageCacheKey(cfg), firstKey)
  process.env[reference] = 'synthetic-unit-key'
  assert.doesNotMatch(firstKey, /synthetic|unit-model|deepseek|PROVIDER_/)
  const shared = config({ usageIdentity: undefined })
  registry.observeUsage(shared, { inputTokens: 5, outputTokens: 6 })
  assert.equal(registry.snapshot(shared).availability, 'shared')
  assert.equal(registry.snapshot(shared).lastRequest, undefined)
})

test('missing/invalid official credentials are unconfigured; custom keyless usage remains observable', () => {
  const registry = new ProviderUsageRegistry()
  for (const cfg of [config({ apiKeyEnv: undefined }), config({ apiKeyEnv: 'PATH' }), config({ apiKeyEnv: 'PROVIDER_MISSING_UNIT' })]) {
    registry.observeUsage(cfg, { inputTokens: 1, outputTokens: 2 })
    assert.equal(registry.snapshot(cfg).availability, 'unconfigured')
    assert.equal(registry.snapshot(cfg).lastRequest, undefined)
  }
  const custom = config({ baseURL: 'http://127.0.0.1:9', apiKeyEnv: undefined })
  registry.observeUsage(custom, { inputTokens: 1, outputTokens: 2 })
  assert.equal(registry.snapshot(custom).lastRequest?.inputTokens, 1)
  assert.equal(registry.snapshot(custom).provider, 'other')
  for (const usage of [{ inputTokens: -1, outputTokens: 2 }, { inputTokens: Infinity, outputTokens: 2 }, { inputTokens: 1.5, outputTokens: 2 }]) registry.observeUsage(custom, usage)
  assert.equal(registry.snapshot(custom).lastRequest?.inputTokens, 1)
})

test('balance fetch is fixed-origin, bounded and coalesced across models for sixty seconds', async () => {
  let time = 0, calls = 0
  let finish!: (value: Response) => void
  const registry = new ProviderUsageRegistry({ now: () => time, fetch: async (url, init) => {
    calls++
    assert.equal(url, 'https://api.deepseek.com/user/balance')
    assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-unit-key')
    assert.ok(init?.signal)
    return await new Promise<Response>(resolve => { finish = resolve })
  } })
  const first = registry.refreshBalance(config())
  const second = registry.refreshBalance(config({ model: 'another' }))
  assert.equal(calls, 1)
  finish(Response.json(balance()))
  assert.equal((await first).balance.status, 'available')
  assert.equal((await second).balance.status, 'available')
  await registry.refreshBalance(config())
  assert.equal(calls, 1)
  time = 60000
  const third = registry.refreshBalance(config())
  assert.equal(calls, 2)
  finish(Response.json(balance()))
  await third
})

test('foreign hosts, paths, protocols, credentials, session and shared config never trigger balance I/O', async () => {
  let calls = 0
  const registry = new ProviderUsageRegistry({ fetch: async () => { calls++; throw new Error('must not fetch') } })
  for (const cfg of [openai(), config({ baseURL: 'https://api.deepseek.com.evil.example/anthropic' }), config({ baseURL: 'https://api.deepseek.com/custom' }), config({ baseURL: 'http://api.deepseek.com/anthropic' }), config({ baseURL: 'https://user@api.deepseek.com/anthropic' }), config({ baseURL: 'https://api.deepseek.com/anthropic?extra' }), config({ protocol: 'openai-responses' }), config({ kind: 'session' }), config({ usageIdentity: undefined }), config({ apiKeyEnv: 'PATH' })]) await registry.refreshBalance(cfg)
  assert.equal(calls, 0)
})

test('balance failures are static, cached and never expose upstream diagnostics', async () => {
  let time = 0, calls = 0
  const registry = new ProviderUsageRegistry({ now: () => time, fetch: async () => { calls++; return new Response('private-upstream-body', { status: 401 }) } })
  const first = await registry.refreshBalance(config())
  assert.deepEqual(first.balance, { status: 'error', checkedAt: 0, reason: 'authentication' })
  assert.doesNotMatch(JSON.stringify(first), /private|synthetic|PROVIDER_/)
  time = 59999
  await registry.refreshBalance(config())
  assert.equal(calls, 1)
  time++
  await registry.refreshBalance(config())
  assert.equal(calls, 2)
})

test('captured observations decline late responses after credential rotation', () => {
  const registry = new ProviderUsageRegistry()
  const cfg = openai()
  const capture = providerUsageCacheKey(cfg)
  process.env[reference] = 'rotated-for-late-capture'
  try {
    registry.observeHeaders(cfg, headers('2'), capture)
    registry.observeUsage(cfg, { inputTokens: 5, outputTokens: 6 }, capture)
    assert.deepEqual(registry.snapshot(cfg).rateLimits, [])
    assert.equal(registry.snapshot(cfg).lastRequest, undefined)
  } finally { process.env[reference] = 'synthetic-unit-key' }
})

test('late balance completion cannot repopulate cleared entries or a rotated connection', async () => {
  for (const change of ['clear', 'rotate']) {
    let finish!: (value: Response) => void
    const registry = new ProviderUsageRegistry({ fetch: async () => await new Promise<Response>(resolve => { finish = resolve }) })
    const pending = registry.refreshBalance(config())
    if (change === 'clear') registry.clear()
    else process.env[reference] = 'rotated-await-key'
    finish(Response.json(balance()))
    try {
      assert.equal((await pending).balance.status, 'not-requested')
      assert.equal(registry.snapshot(config()).balance.status, 'not-requested')
    } finally { process.env[reference] = 'synthetic-unit-key' }
  }
})

test('balance transport and HTTP failures use typed static errors without retries', async () => {
  for (const [status, reason] of [[403, 'authentication'], [429, 'rate-limited'], [302, 'unavailable'], [503, 'unavailable']]) {
    let calls = 0
    const registry = new ProviderUsageRegistry({ fetch: async () => { calls++; return new Response('private detail', { status: Number(status) }) } })
    const result = await registry.refreshBalance(config())
    assert.equal(result.balance.status, 'error')
    assert.equal((result.balance as { reason: string }).reason, reason)
    assert.equal(calls, 1)
  }
  const registry = new ProviderUsageRegistry({ fetch: async () => { throw new Error('private network reason') } })
  assert.equal((await registry.refreshBalance(config())).balance.status, 'error')
})

test('balance body cap counts streamed bytes even without a content-length header', async () => {
  let canceled = false
  const registry = new ProviderUsageRegistry({ fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8192)); controller.enqueue(new Uint8Array(8193)) },
    cancel() { canceled = true },
  })) })
  const result = await registry.refreshBalance(config())
  assert.equal(result.balance.status, 'error')
  assert.equal((result.balance as { reason: string }).reason, 'invalid-response')
  assert.equal(canceled, true)
})

test('balance rejects oversized, malformed or duplicate currency data', async () => {
  const invalid = [null, {}, { ...balance(), is_available: 'true' }, { ...balance(), balance_infos: [] }, { ...balance(), balance_infos: [...balance().balance_infos, ...balance().balance_infos] }, { ...balance(), balance_infos: [{ ...balance().balance_infos[0], total_balance: '1e100' }] }, { ...balance(), balance_infos: [{ ...balance().balance_infos[0], currency: 'EUR' }] }]
  for (const body of invalid) {
    const registry = new ProviderUsageRegistry({ fetch: async () => Response.json(body) })
    assert.equal((await registry.refreshBalance(config())).balance.status, 'error')
  }
  const registry = new ProviderUsageRegistry({ fetch: async () => new Response(' '.repeat(16385)) })
  assert.deepEqual((await registry.refreshBalance(config())).balance.status, 'error')
})

test('balance preserves signed exact decimals and separate currencies without rounding', async () => {
  const amount = '-12.340000000000000001'
  const registry = new ProviderUsageRegistry({ fetch: async () => Response.json({
    is_available: false,
    balance_infos: [
      { currency: 'CNY', total_balance: amount, granted_balance: '0.00', topped_up_balance: amount },
      { currency: 'USD', total_balance: '9.99', granted_balance: '0', topped_up_balance: '9.99' },
    ],
  }) })
  const result = await registry.refreshBalance(config())
  assert.equal(result.balance.status, 'available')
  if (result.balance.status !== 'available') assert.fail('balance must be available')
  assert.equal(result.balance.isAvailable, false)
  assert.deepEqual(result.balance.amounts.map(row => [row.currency, row.total]), [['CNY', amount], ['USD', '9.99']])
})

test('restored runtime epochs and summed usage overflow cannot publish a current observation', () => {
  const registry = new ProviderUsageRegistry()
  const old = config({ usageIdentity: { providerId: 'owned', tenantId: 'owner', connectionRevision: 0, epoch: 1 } })
  const current = { ...old, usageIdentity: { ...old.usageIdentity!, epoch: 2 } }
  registry.observeUsage(old, { inputTokens: 10, outputTokens: 3 })
  assert.equal(registry.snapshot(current).lastRequest, undefined)
  registry.observeUsage(current, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 })
  assert.equal(registry.snapshot(current).lastRequest, undefined)
})

test('deadline covers stalled response bodies and ignores late completion', { timeout: 7000 }, async () => {
  const body = new ProviderUsageRegistry({ fetch: async () => new Response(new ReadableStream({ start() {} })) })
  const stalledFetch = new ProviderUsageRegistry({ fetch: async () => await new Promise<Response>(() => {}) })
  const results = await Promise.all([body.refreshBalance(config()), stalledFetch.refreshBalance(config())])
  for (const result of results) {
    assert.equal(result.balance.status, 'error')
    assert.equal((result.balance as { reason: string }).reason, 'unavailable')
  }
})

test('clear and bounded observation retention discard old private readings', () => {
  const registry = new ProviderUsageRegistry()
  for (let i = 0; i < 257; i++) registry.observeUsage(config({ model: String(i) }), { inputTokens: i, outputTokens: 0 })
  assert.equal(registry.snapshot(config({ model: '0' })).lastRequest, undefined)
  assert.equal(registry.snapshot(config({ model: '256' })).lastRequest?.inputTokens, 256)
  registry.clear()
  assert.equal(registry.snapshot(config({ model: '256' })).lastRequest, undefined)
})

test('observation churn cannot evict pending balance reads or bypass concurrent admission', async () => {
  let calls = 0
  const releases: Array<() => void> = []
  const registry = new ProviderUsageRegistry({ fetch: async () => {
    calls++
    await new Promise<void>(resolve => { releases.push(resolve) })
    return Response.json(balance())
  } })
  const first = registry.refreshBalance(config())
  for (let i = 0; i < 300; i++) registry.observeUsage(config({ model: String(i) }), { inputTokens: i, outputTokens: 0 })
  const coalesced = registry.refreshBalance(config())
  assert.equal(calls, 1, 'the held connection retains its single coalescing slot')
  const pending = [first, coalesced]
  for (let i = 0; i < 7; i++) pending.push(registry.refreshBalance(config({ usageIdentity: { providerId: String(i), tenantId: 'owner', connectionRevision: 0 } })))
  assert.equal(calls, 8)
  const refused = await registry.refreshBalance(config({ usageIdentity: { providerId: 'over-capacity', tenantId: 'owner', connectionRevision: 0 } }))
  assert.equal(refused.balance.status, 'error')
  assert.equal(calls, 8, 'bounded admission never starts a ninth outbound read')
  releases.forEach(release => release())
  for (const result of await Promise.all(pending)) assert.equal(result.balance.status, 'available')
  await registry.refreshBalance(config())
  assert.equal(calls, 8, 'settled protected entry retains its sixty-second cache')
})

test('clearing observations cannot bypass live balance admission, and refusals remain visible', async () => {
  let calls = 0
  const releases: Array<() => void> = []
  const registry = new ProviderUsageRegistry({ fetch: async () => {
    calls++
    await new Promise<void>(resolve => { releases.push(resolve) })
    return Response.json(balance())
  } })
  const pending = Array.from({ length: 8 }, (_, i) => registry.refreshBalance(config({
    usageIdentity: { providerId: String(i), tenantId: 'owner', connectionRevision: 0 },
  })))
  registry.clear()
  const nextConfig = config({ usageIdentity: { providerId: 'after-clear', tenantId: 'owner', connectionRevision: 0 } })
  const next = registry.refreshBalance(nextConfig)
  const callCount = calls
  releases.forEach(release => release())
  await Promise.all(pending)
  const refused = await next
  assert.equal(callCount, 8, 'clearing cached data must not release live request slots')
  assert.equal(refused.balance.status, 'error')
  assert.equal(registry.snapshot(nextConfig).balance.status, 'error', 'read-through refresh can display admission errors')
})
