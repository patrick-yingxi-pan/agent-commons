import test from 'node:test'
import assert from 'node:assert/strict'
import type { Identity, ModelProvider } from '../../contract/index.ts'
import { refreshAccount } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { AccountSwitchedError } from './client.ts'
import { keys, paths } from './keys.ts'
import { captureProviderCreationSource } from './providerCreationRevision.ts'
import { discoverProviderModels } from './providerModelDiscovery.ts'

const identity: Identity = {
  user: { id: 'user-ada', name: 'Ada' },
  tenant: { id: 'tenant-acme', name: 'Acme', kind: 'org' },
  role: 'member', local: false, via: 'session',
}
const providers: ModelProvider[] = [{
  id: 'provider-saved', label: 'Saved provider', kind: 'endpoint', modelFamily: 'claude', effortLevels: ['High'],
  models: [{ id: 'saved-model', label: 'Saved model' }],
}]
const request = { protocol: 'openai-responses' as const, baseURL: 'https://provider.invalid/v1', apiKeyEnv: 'PROVIDER_OPENAI_KEY' }
const result = { models: [{ id: 'discovered-model', label: 'Discovered model' }] }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'x-resolved-tenant': identity.tenant.id } })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function setup(t: { after(fn: () => void): void }, selected = identity) {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: selected.user.id, tenantId: selected.tenant.id })
  resetAll()
  setData(keys.me, selected)
  setData(keys.providers, providers)
  return captureProviderCreationSource()
}

function delayedBody() {
  const body = deferred<string>()
  const started = deferred<void>()
  const response = {
    status: 200, ok: true, statusText: 'OK',
    headers: new Headers({ 'x-resolved-tenant': identity.tenant.id }),
    text() { started.resolve(); return body.promise },
  } as Response
  return { response, started: started.promise, release() { body.resolve(JSON.stringify(result)) } }
}

test('explicit discovery uses the declared POST path, frozen source header and exact abort signal without saving a catalog', async (t) => {
  const source = setup(t)
  const controller = new AbortController()
  const calls: Array<{ url: string; method: string; source: string | null; key: string | null; body: unknown; signal: AbortSignal | null | undefined }> = []
  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(url), method: init?.method ?? 'GET',
      source: headers.get('X-Account-Transition-Source'), key: headers.get('Idempotency-Key'),
      body: JSON.parse(String(init?.body)), signal: init?.signal,
    })
    return json(result)
  }
  assert.equal(paths.providerModelsDiscover, '/providers/models/discover')
  assert.deepEqual(await discoverProviderModels(request, source, controller.signal), result)
  assert.deepEqual(calls, [{
    url: `/api/v1${paths.providerModelsDiscover}`, method: 'POST', source: 'session:user-ada', key: null,
    body: request, signal: controller.signal,
  }])
  assert.equal(peek(keys.providers), providers, 'transient choices never replace the saved provider registry')
  assert.deepEqual(providers[0].models, [{ id: 'saved-model', label: 'Saved model' }])
  assert.equal(peek(keys.me), identity, 'discovery has no account-cache write')
  assert.equal(peek(paths.providerModelsDiscover), undefined, 'the transient listing is not cached as a saved resource')
})

test('a default principal carries the explicit unsigned browser precondition', async (t) => {
  const source = setup(t, { ...identity, via: 'default' })
  let header: string | null = null
  globalThis.fetch = async (_url, init) => {
    header = new Headers(init?.headers).get('X-Account-Transition-Source')
    return json(result)
  }
  await discoverProviderModels(request, source, new AbortController().signal)
  assert.equal(source.sourceUserId, null)
  assert.equal(header, 'unsigned')
})

test('a switched generation cannot send discovery using an obsolete dialog source', async (t) => {
  const source = setup(t)
  refreshAccount({ userId: 'user-grace', tenantId: identity.tenant.id })
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return json(result) }
  await assert.rejects(discoverProviderModels(request, source, new AbortController().signal), AccountSwitchedError)
  assert.equal(calls, 0)
  assert.equal(peek(keys.providers), providers)
})

test('cached identity drift before dispatch is fenced even without a generation change', async (t) => {
  const source = setup(t)
  setData(keys.me, { ...identity, user: { id: 'user-grace', name: 'Grace' } })
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return json(result) }
  await assert.rejects(discoverProviderModels(request, source, new AbortController().signal), AccountSwitchedError)
  assert.equal(calls, 0)
})

test('account change while awaiting response headers drops the discovery before consuming its body', async (t) => {
  const source = setup(t)
  const headers = deferred<Response>()
  let consumed = false
  globalThis.fetch = async () => headers.promise
  const reading = discoverProviderModels(request, source, new AbortController().signal)
  refreshAccount({ userId: 'user-grace', tenantId: identity.tenant.id })
  headers.resolve({
    headers: new Headers({ 'x-resolved-tenant': identity.tenant.id }),
    text: async () => { consumed = true; return JSON.stringify(result) },
  } as Response)
  await assert.rejects(reading, AccountSwitchedError)
  assert.equal(consumed, false)
  assert.equal(peek(keys.providers), providers)
})

test('account generation is checked again after a delayed discovery response body', async (t) => {
  const source = setup(t)
  const delayed = delayedBody()
  globalThis.fetch = async () => delayed.response
  const reading = discoverProviderModels(request, source, new AbortController().signal)
  await delayed.started
  refreshAccount({ userId: 'user-grace', tenantId: identity.tenant.id })
  delayed.release()
  await assert.rejects(reading, AccountSwitchedError)
  assert.equal(peek(keys.providers), providers)
})

test('the frozen provider source is checked after the body even when cached identity changes without a switch', async (t) => {
  const source = setup(t)
  const delayed = delayedBody()
  globalThis.fetch = async () => delayed.response
  const reading = discoverProviderModels(request, source, new AbortController().signal)
  await delayed.started
  const nextIdentity = { ...identity, user: { id: 'user-grace', name: 'Grace' } }
  setData(keys.me, nextIdentity)
  delayed.release()
  await assert.rejects(reading, AccountSwitchedError)
  assert.equal(peek(keys.providers), providers)
  assert.equal(peek(keys.me), nextIdentity)
})

test('a noncooperative response body cannot return models after draft cancellation', async (t) => {
  const source = setup(t)
  const controller = new AbortController()
  const delayed = delayedBody()
  globalThis.fetch = async (_url, init) => { assert.equal(init?.signal, controller.signal); return delayed.response }
  const reading = discoverProviderModels(request, source, controller.signal)
  await delayed.started
  controller.abort()
  delayed.release()
  await assert.rejects(reading, /aborted/i)
  assert.equal(peek(keys.providers), providers)
})
