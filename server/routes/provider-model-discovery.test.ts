/** Pre-save discovery exercises the real router and adapters, never a provider. */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'
import { catalogOf } from '../apiSurface.ts'
import { mcpToolRoutes, toolNameFor } from '../mcp.ts'

const path = '/providers/models/discover'
const privateCanary = 'PRIVATE_DISCOVERY_KEY_AND_BODY'
const headers = { 'x-tenant-id': 'tenant-discovery-fixture', 'x-account-transition-source': 'unsigned' }
const flavors = [
  { protocol: 'anthropic-messages', baseURL: 'https://discovery.invalid', endpoint: '/v1/models' },
  { protocol: 'anthropic-messages', baseURL: 'https://discovery.invalid/anthropic', endpoint: '/anthropic/v1/models' },
  { protocol: 'openai-responses', baseURL: 'https://discovery.invalid/v1', endpoint: '/v1/models' },
]

function fixture(t: TestContext, reply: (url: URL, index: number) => Response) {
  const requests: Array<{ url: URL; init: RequestInit }> = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    requests.push({ url, init: init ?? {} })
    return reply(url, requests.length)
  })
  return requests
}

for (const flavor of flavors) test(`pre-save ${flavor.protocol} ${flavor.endpoint} discovery lists without a model or any writes`, async t => {
  const requests = fixture(t, (url) => Response.json(flavor.protocol === 'openai-responses'
    ? { data: [{ id: 'listed-A' }, { id: 'listed-B' }] }
    : url.searchParams.has('after_id')
      ? { data: [{ id: 'listed-B', display_name: 'Listed B' }], has_more: false, last_id: 'listed-B' }
      : { data: [{ id: 'listed-A', display_name: 'Listed A' }], has_more: true, last_id: 'listed-A' }))
  const before = structuredClone(store.listProviders(headers['x-tenant-id']))
  const events: unknown[] = []
  const unsubscribe = store.subscribe(event => events.push(event))
  t.after(unsubscribe)
  const response = await call('POST', path, { protocol: flavor.protocol, baseURL: flavor.baseURL }, headers)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.deepEqual(response.json, { models: [
    { id: 'listed-A', label: flavor.protocol === 'openai-responses' ? 'listed-A' : 'Listed A' },
    { id: 'listed-B', label: flavor.protocol === 'openai-responses' ? 'listed-B' : 'Listed B' },
  ] })
  assert.equal(requests.length, flavor.protocol === 'openai-responses' ? 1 : 2)
  for (const request of requests) {
    assert.equal(request.url.pathname, flavor.endpoint)
    assert.equal(request.init.method?.toUpperCase() ?? 'GET', 'GET')
    assert.equal(request.init.body, undefined, 'no generation or model parameter')
    assert.equal(request.init.redirect, 'error')
  }
  assert.deepEqual(store.listProviders(headers['x-tenant-id']), before)
  assert.deepEqual(events, [], 'listing has no provider, usage, conversation or readiness event')
})

test('discovery is a product capability through HTTP and remote MCP, with the same auth wall', async t => {
  const previous = process.env.AUTH_GATE
  process.env.AUTH_GATE = 'require'
  t.after(() => { if (previous === undefined) delete process.env.AUTH_GATE; else process.env.AUTH_GATE = previous })
  const requests = fixture(t, () => Response.json({ data: [{ id: 'listed-A' }] }))
  const router = buildRouter()
  assert.equal(catalogOf(router).find(row => row.pattern === path)?.access.kind, 'product')
  assert.ok(mcpToolRoutes(router).some(row => row.pattern === path))
  const body = { protocol: 'openai-responses', baseURL: 'https://discovery.invalid/v1' }
  const anonymous = await call('POST', path, body)
  assert.equal(anonymous.status, 401)
  const viaMcp = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: toolNameFor('POST', path), arguments: { body } } })
  assert.equal(JSON.parse(viaMcp.json.result.content[0].text).status, 401)
  const login = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' })
  assert.equal(login.status, 200)
  const auth = { authorization: `Bearer ${login.json.token}`, 'x-account-transition-source': 'session:user-ada' }
  const authenticated = await call('POST', path, body, auth)
  assert.equal(authenticated.status, 200)
  const authenticatedMcp = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: toolNameFor('POST', path), arguments: { body } } }, auth)
  assert.deepEqual(JSON.parse(authenticatedMcp.json.result.content[0].text), { status: 200, body: authenticated.json })
  const stale = await call('POST', path, { rawKey: privateCanary }, { ...auth, 'x-account-transition-source': 'session:user-maya' })
  assert.equal(stale.status, 409, 'source refusal precedes body validation and outbound requests')
  assert.equal(requests.length, 2)
})

test('discovery validates every input before egress and never falls back to ambient configuration', async t => {
  const requests = fixture(t, () => { throw new Error('validation must prevent egress') })
  const valid = { protocol: 'openai-responses', baseURL: 'https://discovery.invalid/v1' }
  const invalid: unknown[] = [null, [], {}, { ...valid, protocol: undefined }, { ...valid, protocol: 'chat-completions' },
    { ...valid, baseURL: undefined }, { ...valid, baseURL: '' }, { ...valid, baseURL: 42 },
    { ...valid, baseURL: 'file:///private/secret' }, { ...valid, baseURL: 'https://user:secret@discovery.invalid' },
    { ...valid, baseURL: 'https://discovery.invalid/?key=secret' }, { ...valid, baseURL: `https://discovery.invalid/${'x'.repeat(2048)}` },
    { ...valid, model: 'must-not-be-accepted' }, { ...valid, apiKey: privateCanary }, { ...valid, models: [] },
    { ...valid, apiKeyEnv: 'ANTHROPIC_API_KEY' }, { ...valid, apiKeyEnv: '' }, { ...valid, apiKeyEnv: null },
    { ...valid, apiKeyEnv: 'PROVIDER_lowercase' }, { ...valid, apiKeyEnv: `PROVIDER_${'A'.repeat(128)}` }]
  for (const input of invalid) {
    const response = await call('POST', path, input, headers)
    assert.equal(response.status, 400, JSON.stringify(input))
    assert.equal(response.json.error.code, 'bad_request')
    assert.ok(!JSON.stringify(response.json).includes(privateCanary))
  }
  const missing = await call('POST', path, { ...valid, apiKeyEnv: 'PROVIDER_MISSING_DISCOVERY_FIXTURE' }, headers)
  assert.equal(missing.status, 400)
  assert.equal(requests.length, 0)
})

for (const failure of ['http', 'empty', 'malformed', 'page-two', 'duplicate']) test(`discovery refuses ${failure} privately and without prefix publication or retry`, async t => {
  const requests = fixture(t, (url) => {
    if (failure === 'http' || (failure === 'page-two' && url.searchParams.has('after_id'))) {
      return Response.json({ error: { message: privateCanary } }, { status: 503, headers: { 'retry-after': '1' } })
    }
    if (failure === 'empty') return Response.json({ data: [] })
    if (failure === 'malformed') return new Response(privateCanary, { status: 200 })
    if (failure === 'duplicate') return Response.json({ data: [{ id: 'listed-A' }, { id: 'listed-A' }] })
    return Response.json({ data: [{ id: 'listed-A' }], has_more: true, last_id: 'listed-A' })
  })
  const before = structuredClone(store.listProviders(headers['x-tenant-id']))
  const response = await call('POST', path, { protocol: 'anthropic-messages', baseURL: 'https://discovery.invalid' }, headers)
  assert.equal(response.status, 400)
  assert.deepEqual(response.json, { error: { code: 'bad_request', message: 'The endpoint did not provide a complete model list. Check its URL, protocol and credential, or enter a model ID manually.' } })
  assert.equal(requests.length, failure === 'page-two' ? 2 : 1)
  assert.deepEqual(store.listProviders(headers['x-tenant-id']), before)
})
