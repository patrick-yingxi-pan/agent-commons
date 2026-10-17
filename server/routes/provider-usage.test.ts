import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { providerUsage } from '../providerUsage.ts'
import { call } from '../testkit/http.ts'

const keyRef = 'PROVIDER_ROUTE_USAGE_TEST'
const key = 'private-route-usage-test-key'
let ada = '', maya = ''
before(async () => {
  process.env[keyRef] = key
  for (const [email, password, assign] of [
    ['ada@acme.example', 'ada-demo-password', (cookie: string) => { ada = cookie }],
    ['maya@growthworks.example', 'maya-demo-password', (cookie: string) => { maya = cookie }],
  ] as const) {
    const result = await call('POST', '/auth/login', { email, password })
    assert.equal(result.status, 200)
    assign(`uw_session=${result.headers['set-cookie'].match(/uw_session=([^;,]+)/)![1]}`)
  }
})
after(() => { delete process.env[keyRef]; providerUsage.clear() })

const callAs = (cookie: string, path: string) => call('GET', path, undefined, { cookie })
function create(tenant = 'tenant-acme') {
  return store.createProvider({ label: 'Private usage fixture', modelFamily: 'claude', effortLevels: [] }, {
    protocol: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: keyRef,
    model: 'configured-default', capabilities: { toolUse: false },
  }, tenant)
}

test('usage read exposes only caller tenant and exact selected model without external I/O', async t => {
  const provider = create()
  const config = { ...store.providerExecutionConfig(provider.id), model: 'picked-model' }
  providerUsage.observeUsage(config, { inputTokens: 17, outputTokens: 3 })
  let externalCalls = 0
  t.mock.method(globalThis, 'fetch', async () => { externalCalls++; throw new Error('No external request authorized') })
  const read = await callAs(ada, `/providers/${provider.id}/usage?model=picked-model`)
  assert.equal(read.status, 200)
  assert.equal(read.headers['cache-control'], 'no-store')
  assert.equal(read.json.lastRequest.inputTokens, 17)
  assert.equal(read.json.modelId, 'picked-model')
  assert.equal(read.json.providerId, provider.id)
  assert.doesNotMatch(JSON.stringify(read.json), /private-route|PROVIDER_ROUTE|api\.deepseek|tenant-acme/)
  const absent = await callAs(ada, `/providers/${provider.id}/usage`)
  assert.equal(absent.status, 200)
  assert.equal(absent.json.modelId, undefined)
  assert.equal(absent.json.lastRequest, undefined)
  assert.equal((await callAs(ada, `/providers/${provider.id}/usage?model=another`)).json.lastRequest, undefined)
  for (const suffix of ['usage', 'usage/balance']) {
    assert.equal((await callAs(maya, `/providers/${provider.id}/${suffix}`)).status, 404)
    assert.equal((await callAs(maya, `/providers/missing-private-id/${suffix}`)).status, 404)
  }
  assert.equal(externalCalls, 0)
  assert.equal(store.providerConfig(provider.id).usageIdentity, undefined, 'runtime identity never persists in provider config')
})

test('usage query rejects extra, duplicate, blank, control and oversized model values', async () => {
  const provider = create()
  for (const query of ['unknown=true', 'model=a&model=b', 'model=', 'model=%20', 'model=%00', `model=${'x'.repeat(513)}`]) {
    for (const suffix of ['usage', 'usage/balance']) assert.equal((await callAs(ada, `/providers/${provider.id}/${suffix}?${query}`)).status, 400, query)
  }
})

test('explicit balance rechecks deletion, connection revision and credential rotation after await', async t => {
  for (const change of ['delete', 'connection', 'credential']) {
    const provider = create()
    let release!: () => void, began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const mock = t.mock.method(providerUsage, 'refreshBalance', async config => {
      began()
      await held
      return { ...providerUsage.snapshot(config), balance: { status: 'available', observedAt: 1, isAvailable: true, amounts: [{ currency: 'USD', total: '2.00', granted: '0', toppedUp: '2' }] } }
    })
    const pending = callAs(ada, `/providers/${provider.id}/usage/balance?model=selected`)
    await started
    if (change === 'delete') assert.equal(store.deleteProvider(provider.id), true)
    else if (change === 'connection') store.replaceProviderConnection(provider.id, { ...store.providerConfig(provider.id), model: 'new-default' })
    else process.env[keyRef] = 'rotated-private-route-key'
    release()
    const result = await pending
    assert.equal(result.status, change === 'delete' ? 404 : 409)
    assert.equal(result.json.balance, undefined)
    assert.doesNotMatch(JSON.stringify(result.json), /private-route|PROVIDER_ROUTE|api\.deepseek/)
    process.env[keyRef] = key
    mock.mock.restore()
  }
})

test('balance account source fence is rechecked after wait and before projecting private readings', async t => {
  const provider = create()
  let release!: () => void, began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  t.mock.method(providerUsage, 'refreshBalance', async config => { began(); await held; return providerUsage.snapshot(config) })
  const headers = { cookie: ada, 'x-account-transition-source': 'session:user-ada' }
  const pending = call('GET', `/providers/${provider.id}/usage/balance`, undefined, headers)
  await started
  headers.cookie = maya
  release()
  const result = await pending
  assert.equal(result.status, 409)
  assert.equal(result.json.balance, undefined)
})

test('shared default provider reports shared availability and cannot reveal another private observation', async () => {
  const read = await callAs(ada, '/providers/provider-anthropic/usage?model=some-model')
  assert.equal(read.status, 200)
  assert.equal(read.json.availability, 'shared')
  assert.equal(read.json.lastRequest, undefined)
  assert.deepEqual(read.json.rateLimits, [])
})
