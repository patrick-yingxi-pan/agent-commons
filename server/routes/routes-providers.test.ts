/** Provider CRUD on the wire (docs/agent-commons.md, D9) — the Agents hub's create /
 *  patch / delete. POST validates the plan against the account plan (the cascade root,
 *  D8); DELETE refuses the protected default and any provider an Agent still binds (409).
 *  The in-memory store is shared across the run, so each case uses its own labels and
 *  only deletes what it created (never the default, which other tests resolve to). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { DEFAULT_PROVIDER_ID } from '../data/providers.ts'
import { startModelServer } from '../model/index.ts'
import { call } from '../testkit/http.ts'

test('POST creates a provider; GET lists it; PATCH edits its fields', async () => {
  const created = await call('POST', '/providers', {
    label: 'Wire provider',
    modelFamily: 'open',
    effortLevels: ['Low', 'High'],
    execution: 'configured',
  })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('provider-'))
  assert.equal(created.json.modelFamily, 'open')
  assert.equal(created.json.execution, 'mock', 'execution is computed from server config, never caller-stamped')

  const one = await call('GET', `/providers/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Wire provider')

  const patched = await call('PATCH', `/providers/${created.json.id}`, {
    label: 'Renamed',
    modelFamily: 'claude',
    execution: 'configured',
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Renamed')
  assert.equal(patched.json.modelFamily, 'claude')
  // The patch is a real merge — the untouched effort levels survive.
  assert.deepEqual(patched.json.effortLevels, ['Low', 'High'])
  assert.equal(patched.json.execution, 'mock', 'PATCH cannot forge the serve-time execution status')
})

test('POST without required fields is a 400; PATCH of an unknown id is a 404', async () => {
  const bad = await call('POST', '/providers', { label: 'No family' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')

  const missing = await call('PATCH', '/providers/no-such-provider', { label: 'x' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('POST with an over-account plan is a 400 (the D8 cascade root)', async () => {
  const over = await call('POST', '/providers', {
    label: 'Greedy tier',
    modelFamily: 'claude',
    effortLevels: ['High'],
    plan: { windows: [{ label: '5-hour limit', ceiling: 99_000_000 }] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('POST with an endpoint config probes it, mints, and never echoes the endpoint half', async () => {
  // A live Messages-protocol endpoint for the registration probe to verify against.
  const mock = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => mock.on('listening', () => r()))
  const addr = mock.address()
  const baseURL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  process.env.PROVIDER_ENDPOINT_KEY = 'endpoint-test-secret'
  try {
    const created = await call('POST', '/providers', {
      label: 'Endpoint provider',
      modelFamily: 'open',
      effortLevels: ['Low'],
      config: { baseURL, apiKeyEnv: 'PROVIDER_ENDPOINT_KEY', model: 'open-model-1' },
    })
    assert.equal(created.status, 200)
    // The write-only config never lands on the read type — no endpoint/credential leak.
    assert.equal(created.json.config, undefined)
    assert.equal(created.json.baseURL, undefined)
    assert.equal(created.json.apiKeyEnv, undefined)
    const one = await call('GET', `/providers/${created.json.id}`)
    assert.equal(one.json.config, undefined)
    // Server-side, the endpoint half + the probed capability record landed intact.
    const config = store.providerConfig(created.json.id)
    assert.equal(config.baseURL, baseURL)
    assert.equal(config.apiKeyEnv, 'PROVIDER_ENDPOINT_KEY')
    assert.equal(config.model, 'open-model-1')
    assert.deepEqual(config.capabilities, { toolUse: true })

    // A forged capability record on the wire config is discarded — only the probe
    // stamps capabilities (the route picks the three known fields explicitly).
    const forged = await call('POST', '/providers', {
      label: 'Forged capabilities',
      modelFamily: 'open',
      effortLevels: ['Low'],
      config: { model: 'open-model-2', capabilities: { toolUse: true } },
    })
    assert.equal(forged.status, 200)
    assert.equal(store.providerConfig(forged.json.id).capabilities, undefined)
  } finally {
    delete process.env.PROVIDER_ENDPOINT_KEY
    mock.close()
  }
})

test('POST with a credential reference outside PROVIDER_* is a 400 — with or without an endpoint', async () => {
  // With an endpoint: the probe's wall trips BEFORE any request leaves — nothing is
  // sent to the caller-supplied URL carrying the referenced secret.
  const probed = await call('POST', '/providers', {
    label: 'Exfil via probe',
    modelFamily: 'open',
    effortLevels: ['Low'],
    config: { baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  })
  assert.equal(probed.status, 400)
  assert.equal(probed.json.error.code, 'bad_request')
  assert.match(probed.json.error.message, /PROVIDER_/)

  // Without an endpoint: the mint funnel's own wall catches it.
  const minted = await call('POST', '/providers', {
    label: 'Exfil via mint',
    modelFamily: 'open',
    effortLevels: ['Low'],
    config: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
  })
  assert.equal(minted.status, 400)
  assert.match(minted.json.error.message, /PROVIDER_/)
})

test('the server-only credential binding projection supports desktop vault reconciliation without widening reads', async () => {
  const reference = `PROVIDER_DESKTOP_${'A'.repeat(32)}`
  const created = await call('POST', '/providers', {
    label: 'Desktop credential binding',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    config: { apiKeyEnv: reference },
  })
  assert.equal(created.status, 200)
  assert.equal(JSON.stringify(created.json).includes(reference), false, 'the write-only reference stays off HTTP reads')
  assert.deepEqual(
    store.providerCredentialBindings().find((binding) => binding.providerId === created.json.id),
    { reference, providerId: created.json.id },
  )
})

test('POST with a non-conformant endpoint is a 400 — the provider is never registered', async () => {
  const countBefore = store.listProviders().length
  const bad = await call('POST', '/providers', {
    label: 'Dead endpoint',
    modelFamily: 'open',
    effortLevels: ['Low'],
    config: { baseURL: 'http://127.0.0.1:9' },
  })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')
  assert.equal(store.listProviders().length, countBefore, 'nothing minted')
})

test('DELETE removes an unbound provider; a second DELETE 404s', async () => {
  const created = await call('POST', '/providers', {
    label: 'Disposable',
    modelFamily: 'claude',
    effortLevels: ['Low'],
  })
  const del = await call('DELETE', `/providers/${created.json.id}`)
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })

  const again = await call('DELETE', `/providers/${created.json.id}`)
  assert.equal(again.status, 404)
})

test('DELETE refuses the default provider (409 — sessions resolve to it)', async () => {
  const del = await call('DELETE', `/providers/${DEFAULT_PROVIDER_ID}`)
  assert.equal(del.status, 409)
  assert.equal(del.json.error.code, 'conflict')
})

test('DELETE refuses a provider an Agent still binds (409)', async () => {
  const provider = store.createProvider({ label: 'Bound', modelFamily: 'claude', effortLevels: ['Low'] })
  store.createAgent({
    label: 'Binder',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    providerId: provider.id,
  })
  const blocked = await call('DELETE', `/providers/${provider.id}`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error.code, 'conflict')
})
