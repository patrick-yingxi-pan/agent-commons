import test from 'node:test'
import assert from 'node:assert/strict'
import { createProviderModelDiscoveryCore } from './providerModelDiscoveryCore.ts'
import type { ProviderModelDiscoveryDependencies, ProviderModelDiscoveryState } from './providerModelDiscoveryCore.ts'
import type { DiscoverProviderModelsResult } from '../../contract/providerDiscovery.ts'

const request = { protocol: 'openai-responses' as const, baseURL: 'https://example.test/v1', apiKeyEnv: 'OPENAI_API_KEY' }
const reference = `PROVIDER_DESKTOP_${'A'.repeat(32)}`
const result = { models: [{ id: 'model-one', label: 'Model One', capabilities: { toolUse: true } }] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(overrides: Partial<ProviderModelDiscoveryDependencies> = {}) {
  const calls: unknown[][] = []
  const publications: ProviderModelDiscoveryState[] = []
  let active = true
  const deps: ProviderModelDiscoveryDependencies = {
    async discover(input, signal) { calls.push(['discover', input, signal]); return result },
    async provision(secret) { calls.push(['provision', secret]); return reference },
    async discard(ref) { calls.push(['discard', ref]) },
    assertCurrentAccount() { if (!active) throw new Error('Wrong account') },
    publish(state) { publications.push(state) },
    onProvisioned() { calls.push(['cleared']) },
    ...overrides,
  }
  return { core: createProviderModelDiscoveryCore(deps), calls, publications, switchAccount() { active = false } }
}

test('discovery is explicit, reads one catalog and exposes neither credentials nor further authority', async () => {
  const h = harness()
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.core.snapshot(), { status: 'idle', models: [], error: null, hasCredential: false })
  assert.deepEqual(Object.keys(h.core).sort(), ['dispose', 'load', 'reset', 'snapshot', 'takeCredential'])
  await h.core.load(request, 'raw-private-key')
  assert.equal(h.core.snapshot().status, 'loaded')
  assert.deepEqual(h.core.snapshot().models, result.models)
  assert.equal(h.core.snapshot().hasCredential, true)
  assert.deepEqual(h.calls.slice(0, 2), [['provision', 'raw-private-key'], ['cleared']])
  assert.deepEqual(h.calls[2]?.slice(0, 2), ['discover', { ...request, apiKeyEnv: reference }])
  assert.equal(h.calls.length, 3)
  assert.equal(JSON.stringify(h.publications).includes('raw-private-key'), false)
  assert.equal(JSON.stringify(h.publications).includes(reference), false)
  assert.deepEqual(Object.keys(h.core.snapshot()).sort(), ['error', 'hasCredential', 'models', 'status'])
  h.core.snapshot().models[0].label = 'Local edit'
  assert.equal(result.models[0].label, 'Model One')
})

test('server environment discovery does not provision or claim ownership of its credential', async () => {
  const h = harness()
  await h.core.load(request)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0]?.slice(0, 2), ['discover', request])
  assert.equal(h.core.takeCredential(), undefined)
  h.core.dispose()
  assert.equal(h.calls.length, 1)
})

test('duplicate Load joins one in-flight attempt and Create cannot take its credential', async () => {
  const response = deferred<DiscoverProviderModelsResult>()
  let reads = 0
  const h = harness({ async discover() { reads += 1; return response.promise } })
  const first = h.core.load(request, 'raw-private-key')
  const second = h.core.load(request, 'different-key')
  assert.equal(first, second)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(reads, 1)
  assert.throws(() => h.core.takeCredential(), /Wait for model loading/)
  response.resolve(result)
  await first
  assert.equal(h.core.takeCredential(), reference)
})

test('safe failure retains its provisioned reference for explicit retry and manual creation', async () => {
  let reads = 0
  const h = harness({ async discover(input) {
    h.calls.push(['discover', input])
    if (++reads === 1) throw new Error('secret endpoint response raw-private-key')
    return result
  } })
  await h.core.load(request, 'raw-private-key')
  assert.equal(h.core.snapshot().status, 'failed')
  assert.equal(h.core.snapshot().hasCredential, true)
  assert.match(h.core.snapshot().error!, /enter a model manually/)
  assert.equal(JSON.stringify(h.publications).includes('secret endpoint'), false)
  assert.equal(h.calls.filter(([name]) => name === 'discard').length, 0)
  await h.core.load(request)
  assert.equal(h.core.snapshot().status, 'loaded')
  assert.equal(h.calls.filter(([name]) => name === 'provision').length, 1)
  assert.deepEqual(h.calls.filter(([name]) => name === 'discover').map(([, input]) => input), [
    { ...request, apiKeyEnv: reference }, { ...request, apiKeyEnv: reference },
  ])
  assert.equal(h.core.takeCredential(), reference)
})

test('failed provisioning clears no raw input and explicit retry may provision again', async () => {
  let attempts = 0
  const h = harness({ async provision() {
    if (++attempts === 1) throw new Error('secret provisioning details')
    return reference
  } })
  await h.core.load(request, 'raw-private-key')
  assert.equal(h.core.snapshot().status, 'failed')
  assert.equal(h.core.snapshot().hasCredential, false)
  assert.deepEqual(h.calls, [])
  assert.equal(h.core.snapshot().error?.includes('provisioning'), false)
  await h.core.load(request, 'raw-private-key')
  assert.equal(attempts, 2)
  assert.equal(h.core.snapshot().status, 'loaded')
  assert.deepEqual(h.calls[0], ['cleared'])
})

for (const action of ['reset', 'dispose'] as const) {
  test(`${action} aborts and fences a late catalog, discarding exactly its unsaved key`, async () => {
    const response = deferred<DiscoverProviderModelsResult>()
    let signal!: AbortSignal
    const h = harness({ async discover(_input, readSignal) { signal = readSignal; return response.promise } })
    const loading = h.core.load(request, 'raw-private-key')
    await Promise.resolve()
    await Promise.resolve()
    h.core[action]()
    const count = h.publications.length
    assert.equal(signal.aborted, true)
    assert.deepEqual(h.calls.filter(([name]) => name === 'discard'), [['discard', reference]])
    response.resolve(result)
    await loading
    assert.equal(h.publications.length, count)
    assert.equal(h.core.snapshot().status, 'idle')
    h.core[action]()
    assert.equal(h.calls.filter(([name]) => name === 'discard').length, 1)
  })

  test(`${action} fences a late provisional key and cleans it without discovery or input clearing`, async () => {
    const provision = deferred<string>()
    const h = harness({ provision() { return provision.promise } })
    const loading = h.core.load(request, 'raw-private-key')
    await Promise.resolve()
    h.core[action]()
    const count = h.publications.length
    provision.resolve(reference)
    await loading
    assert.deepEqual(h.calls, [['discard', reference]])
    assert.equal(h.publications.length, count)
    assert.equal(h.core.snapshot().hasCredential, false)
  })
}

test('reset permits a new read while the previous ignored-abort response cannot overwrite it', async () => {
  const oldResponse = deferred<DiscoverProviderModelsResult>()
  let reads = 0
  const h = harness({ async discover() { return ++reads === 1 ? oldResponse.promise : result } })
  const first = h.core.load(request)
  await Promise.resolve()
  h.core.reset()
  await h.core.load({ ...request, baseURL: 'https://another.test/v1' })
  const count = h.publications.length
  oldResponse.resolve({ models: [{ id: 'stale', label: 'Stale' }] })
  await first
  assert.equal(h.publications.length, count)
  assert.equal(h.core.snapshot().models[0].id, 'model-one')
})

test('account change before load admits no native or network effects or publication', async () => {
  const h = harness()
  h.switchAccount()
  await h.core.load(request, 'raw-private-key')
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.publications, [])
  assert.throws(() => h.core.takeCredential(), /no longer active/)
})

test('account change during provisioning discards the late exact key without discovering or publishing', async () => {
  const provision = deferred<string>()
  const h = harness({ provision() { return provision.promise } })
  const loading = h.core.load(request, 'raw-private-key')
  await Promise.resolve()
  const count = h.publications.length
  h.switchAccount()
  provision.resolve(reference)
  await loading
  assert.deepEqual(h.calls, [['discard', reference]])
  assert.equal(h.publications.length, count)
  assert.equal(h.core.snapshot().hasCredential, false)
})

for (const failure of [false, true]) {
  test(`account change during ${failure ? 'failed' : 'successful'} discovery retires its catalog and staged key`, async () => {
    const response = deferred<DiscoverProviderModelsResult>()
    const h = harness({ discover() { return response.promise } })
    const loading = h.core.load(request, 'raw-private-key')
    await Promise.resolve()
    await Promise.resolve()
    const count = h.publications.length
    h.switchAccount()
    if (failure) response.reject(new Error('upstream private body'))
    else response.resolve(result)
    await loading
    assert.equal(h.publications.length, count)
    assert.deepEqual(h.calls.filter(([name]) => name === 'discard'), [['discard', reference]])
    assert.equal(h.core.snapshot().status, 'idle')
  })
}

test('account change after provisioning callback prevents the catalog read', async () => {
  const h = harness({ onProvisioned() { h.switchAccount() } })
  await h.core.load(request, 'raw-private-key')
  assert.deepEqual(h.calls, [['provision', 'raw-private-key'], ['discard', reference]])
  assert.equal(h.publications.length, 1)
})

test('credential handoff detaches its exact key permanently from reset and disposal cleanup', async () => {
  const h = harness()
  await h.core.load(request, 'raw-private-key')
  assert.equal(h.core.takeCredential(), reference)
  assert.equal(h.core.snapshot().hasCredential, false)
  assert.equal(h.core.takeCredential(), undefined)
  h.core.reset()
  h.core.dispose()
  await h.core.load(request, 'another-key')
  h.core.reset()
  assert.equal(h.calls.filter(([name]) => name === 'discard').length, 0)
  assert.equal(h.calls.filter(([name]) => name === 'provision').length, 1)
})

test('manual Create may take the staged key after a catalog failure', async () => {
  const h = harness({ async discover() { throw new Error('catalog unavailable') } })
  await h.core.load(request, 'raw-private-key')
  assert.equal(h.core.snapshot().status, 'failed')
  assert.equal(h.core.takeCredential(), reference)
  h.core.dispose()
  assert.equal(h.calls.filter(([name]) => name === 'discard').length, 0)
})

test('account change before handoff refuses Create and cleans only the draft-owned key', async () => {
  const h = harness()
  await h.core.load(request, 'raw-private-key')
  const count = h.publications.length
  h.switchAccount()
  assert.throws(() => h.core.takeCredential(), /no longer active/)
  assert.equal(h.publications.length, count)
  assert.deepEqual(h.calls.filter(([name]) => name === 'discard'), [['discard', reference]])
})

test('a late old provision cannot clear or discard the replacement draft credential', async () => {
  const provision = deferred<string>()
  const replacement = `PROVIDER_DESKTOP_${'B'.repeat(32)}`
  let attempts = 0
  const h = harness({ async provision() { return ++attempts === 1 ? provision.promise : replacement } })
  const first = h.core.load(request, 'old-key')
  await Promise.resolve()
  h.core.reset()
  await h.core.load(request, 'replacement-key')
  assert.equal(h.core.takeCredential(), replacement)
  const count = h.publications.length
  provision.resolve(reference)
  await first
  assert.equal(h.publications.length, count)
  assert.deepEqual(h.calls.filter(([name]) => name === 'discard'), [['discard', reference]])
  assert.equal(h.calls.filter(([name]) => name === 'cleared').length, 1)
})

test('cleanup failure cannot retain ownership or create an unhandled rejection', async () => {
  const h = harness({ async discard(ref) { h.calls.push(['discard', ref]); throw new Error('native failure') } })
  await h.core.load(request, 'raw-private-key')
  h.core.reset()
  h.core.dispose()
  await Promise.resolve()
  assert.equal(h.calls.filter(([name]) => name === 'discard').length, 1)
})
