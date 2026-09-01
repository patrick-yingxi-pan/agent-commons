/** Provider CRUD on the wire (docs/agent-commons.md, D9) — the Agents hub's create /
 *  patch / delete. POST validates the plan against the account plan (the cascade root,
 *  D8); DELETE refuses the protected default and any provider an Agent still binds (409).
 *  The in-memory store is shared across the run, so each case uses its own labels and
 *  only deletes what it created (never the default, which other tests resolve to). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { store } from '../store/index.ts'
import { DEFAULT_PROVIDER_ID } from '../data/providers.ts'
import { startModelServer } from '../model/index.ts'
import { call } from '../testkit/http.ts'
import { ConflictError } from '../conflict.ts'

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
  assert.equal(created.json.definitionRevision, 0, 'definition revision is server-owned')

  const one = await call('GET', `/providers/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Wire provider')

  const patched = await call('PATCH', `/providers/${created.json.id}`, {
    label: 'Renamed',
    modelFamily: 'claude',
    expectedRevision: 0,
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Renamed')
  assert.equal(patched.json.modelFamily, 'claude')
  // The patch is a real merge — the untouched effort levels survive.
  assert.deepEqual(patched.json.effortLevels, ['Low', 'High'])
  assert.equal(patched.json.definitionRevision, 1)
  assert.equal(patched.json.execution, 'mock')
})

test('provider definition PATCH is sparse, compare-and-swap, replay-safe, and ownership-strict', async () => {
  const created = await call('POST', '/providers', {
    label: 'Revisioned definition',
    modelFamily: 'claude',
    effortLevels: ['Low', 'High'],
    tenantId: 'tenant-forged',
    arbitrary: 'not durable',
  })
  assert.equal(created.status, 200)
  assert.notEqual(created.json.tenantId, 'tenant-forged', 'the route stamps ownership from authenticated identity')
  assert.equal(created.json.arbitrary, undefined, 'unknown create fields never become durable')

  const headers = { 'idempotency-key': `provider-definition-${created.json.id}` }
  const first = await call('PATCH', `/providers/${created.json.id}`, {
    label: 'Locally renamed',
    expectedRevision: 0,
  }, headers)
  assert.equal(first.status, 200)
  assert.equal(first.json.definitionRevision, 1)
  assert.equal(first.json.modelFamily, 'claude', 'an absent field is preserved')

  const replay = await call('PATCH', `/providers/${created.json.id}`, {
    label: 'Locally renamed',
    expectedRevision: 0,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.definitionRevision, 1, 'one logical retry cannot advance the definition twice')

  const remote = await call('PATCH', `/providers/${created.json.id}`, {
    modelFamily: 'openai',
    expectedRevision: 1,
  })
  assert.equal(remote.status, 200)
  assert.equal(remote.json.definitionRevision, 2)

  const stale = await call('PATCH', `/providers/${created.json.id}`, {
    label: 'Stale overwrite',
    expectedRevision: 1,
  })
  assert.equal(stale.status, 409)
  const current = await call('GET', `/providers/${created.json.id}`)
  assert.equal(current.json.label, 'Locally renamed')
  assert.equal(current.json.modelFamily, 'openai')
  assert.equal(current.json.definitionRevision, 2)

  for (const forged of [
    { tenantId: 'tenant-other' },
    { kind: 'session' },
    { models: [] },
    { connectionRevision: 99 },
    { definitionRevision: 99 },
    { execution: 'configured' },
  ]) {
    const refused = await call('PATCH', `/providers/${created.json.id}`, forged)
    assert.equal(refused.status, 400, `strict PATCH refuses ${Object.keys(forged)[0]}`)
  }
  const afterForgery = await call('GET', `/providers/${created.json.id}`)
  assert.notEqual(afterForgery.json.tenantId, 'tenant-other')
  assert.equal(afterForgery.json.kind, undefined)
  assert.equal(afterForgery.json.connectionRevision, 0)
  assert.equal(afterForgery.json.definitionRevision, 2)
})

test('provider definition PATCH validates nested authority and plan shapes before mutation', async () => {
  const created = await call('POST', '/providers', {
    label: 'Strict definition',
    modelFamily: 'claude',
    effortLevels: ['Low'],
  })
  for (const malformed of [
    { effortLevels: ['Low', 'Low'] },
    { authority: { tools: ['read'], tenant: ['other'] } },
    { plan: { windows: [{ label: '5-hour limit', ceiling: -1 }] } },
    { expectedRevision: -1, label: 'Nope' },
    {},
  ]) {
    const refused = await call('PATCH', `/providers/${created.json.id}`, malformed)
    assert.equal(refused.status, 400)
  }
  const current = await call('GET', `/providers/${created.json.id}`)
  assert.equal(current.json.label, 'Strict definition')
  assert.equal(current.json.definitionRevision, 0)
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

test('PATCH connection rotates selected write-only fields only after a successful probe', async () => {
  const mock = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => mock.on('listening', resolve))
  const addr = mock.address()
  const baseURL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  const previousReference = 'PROVIDER_CONNECTION_PREVIOUS'
  const replacementReference = `PROVIDER_DESKTOP_${'D'.repeat(32)}`
  process.env[previousReference] = 'previous-secret'
  process.env[replacementReference] = 'replacement-secret'
  try {
    const created = await call('POST', '/providers', {
      label: 'Rotatable endpoint',
      modelFamily: 'claude',
      effortLevels: ['High'],
      config: { baseURL, apiKeyEnv: previousReference, model: 'before-model' },
    })
    assert.equal(created.status, 200)

    const patched = await call('PATCH', `/providers/${created.json.id}/connection`, {
      apiKeyEnv: replacementReference,
      model: 'after-model',
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.json.defaultModelId, 'after-model')
    assert.equal(JSON.stringify(patched.json).includes(replacementReference), false)
    assert.equal(patched.json.config, undefined)
    assert.deepEqual(store.providerConfig(created.json.id), {
      baseURL,
      apiKeyEnv: replacementReference,
      model: 'after-model',
      capabilities: { toolUse: true },
    })
    assert.deepEqual(
      store.providerCredentialBindings().filter((binding) => binding.providerId === created.json.id),
      [{ reference: replacementReference, providerId: created.json.id }],
    )
  } finally {
    delete process.env[previousReference]
    delete process.env[replacementReference]
    mock.close()
  }
})

test('PATCH connection compares its revision and replays one logical replacement exactly once', async () => {
  const mock = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => mock.on('listening', resolve))
  const addr = mock.address()
  const baseURL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const created = await call('POST', '/providers', {
      label: 'Revisioned connection',
      modelFamily: 'claude',
      effortLevels: ['High'],
      connectionRevision: 91,
      config: { baseURL, model: 'before-model' },
    })
    assert.equal(created.status, 200)
    assert.equal(created.json.connectionRevision, 0, 'connection revision is server-owned')

    const headers = { 'idempotency-key': `provider-connection-${created.json.id}` }
    const replaced = await call('PATCH', `/providers/${created.json.id}/connection`, {
      model: 'after-model',
      expectedRevision: 0,
    }, headers)
    assert.equal(replaced.status, 200)
    assert.equal(replaced.json.connectionRevision, 1)
    assert.equal(store.providerConfig(created.json.id).model, 'after-model')

    const replay = await call('PATCH', `/providers/${created.json.id}/connection`, {
      model: 'after-model',
      expectedRevision: 0,
    }, headers)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.connectionRevision, 1, 'one logical retry cannot advance the connection twice')

    const refreshed = await call('POST', `/providers/${created.json.id}/models/refresh`, {})
    assert.equal(refreshed.status, 200)
    assert.equal(refreshed.json.connectionRevision, 2, 'the endpoint-owned catalog shares connection ordering')
    const currentCatalog = refreshed.json.models
    assert.throws(
      () => store.refreshProviderModels(
        created.json.id,
        [{ id: 'stale-model', label: 'Stale model' }],
        1,
      ),
      ConflictError,
      'a catalog response fetched against an older endpoint cannot land late',
    )
    assert.deepEqual(
      store.listProviders().find((provider) => provider.id === created.json.id)?.models,
      currentCatalog,
    )
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()))

    const stale = await call('PATCH', `/providers/${created.json.id}/connection`, {
      model: 'stale-model',
      expectedRevision: 0,
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error.code, 'conflict')
    assert.equal(store.providerConfig(created.json.id).model, 'after-model', 'a stale request changes no hidden field')

    const malformed = await call('PATCH', `/providers/${created.json.id}/connection`, {
      model: 'invalid-precondition',
      expectedRevision: -1,
    })
    assert.equal(malformed.status, 400)
    assert.equal(store.providerConfig(created.json.id).model, 'after-model')

    const forged = await call('PATCH', `/providers/${created.json.id}`, { connectionRevision: 72 })
    assert.equal(forged.status, 400)
    assert.equal(
      store.listProviders().find((provider) => provider.id === created.json.id)?.connectionRevision,
      2,
      'ordinary provider edits cannot forge connection ordering',
    )
  } finally {
    if (mock.listening) mock.close()
  }
})

test('PATCH connection is atomic on probe failure and clears only explicitly null fields', async () => {
  const mock = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => mock.on('listening', resolve))
  const addr = mock.address()
  const baseURL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const created = await call('POST', '/providers', {
      label: 'Atomic connection',
      modelFamily: 'claude',
      effortLevels: ['High'],
      config: { baseURL, model: 'before-model' },
    })
    assert.equal(created.status, 200)
    const before = structuredClone(store.providerConfig(created.json.id))

    const refused = await call('PATCH', `/providers/${created.json.id}/connection`, {
      baseURL: 'http://127.0.0.1:9',
    })
    assert.equal(refused.status, 400)
    assert.deepEqual(store.providerConfig(created.json.id), before, 'a refused probe cannot partially replace the connection')

    const cleared = await call('PATCH', `/providers/${created.json.id}/connection`, { model: null })
    assert.equal(cleared.status, 200)
    assert.equal(store.providerConfig(created.json.id).baseURL, baseURL, 'absent endpoint is preserved')
    assert.equal(store.providerConfig(created.json.id).model, undefined, 'explicit null clears the selected field')
  } finally {
    mock.close()
  }
})

test('PATCH connection clears a stale model namespace when the new endpoint cannot list models', async () => {
  const listed = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => listed.on('listening', resolve))
  const listedAddress = listed.address()
  const listedURL = `http://127.0.0.1:${typeof listedAddress === 'object' && listedAddress ? listedAddress.port : 0}`
  const unlisted = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'msg_unlisted',
        type: 'message',
        role: 'assistant',
        model: 'unlisted-model',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }))
    })
  })
  unlisted.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => unlisted.on('listening', resolve))
  const unlistedAddress = unlisted.address()
  const unlistedURL = `http://127.0.0.1:${typeof unlistedAddress === 'object' && unlistedAddress ? unlistedAddress.port : 0}`
  try {
    const created = await call('POST', '/providers', {
      label: 'Endpoint namespace swap',
      modelFamily: 'claude',
      effortLevels: ['High'],
      config: { baseURL: listedURL, model: 'before-model' },
    })
    assert.equal(created.status, 200)
    assert.ok(created.json.models?.length > 0)
    assert.equal(created.json.catalogSource, 'listed')

    const patched = await call('PATCH', `/providers/${created.json.id}/connection`, { baseURL: unlistedURL })
    assert.equal(patched.status, 200)
    assert.equal(patched.json.models, undefined)
    assert.equal(patched.json.catalogSource, undefined)
    assert.equal(store.providerConfig(created.json.id).baseURL, unlistedURL)
  } finally {
    listed.close()
    unlisted.close()
  }
})

test('PATCH connection rejects empty/unknown shapes and Session providers', async () => {
  const endpoint = await call('POST', '/providers', {
    label: 'Strict connection patch',
    modelFamily: 'claude',
    effortLevels: ['Low'],
  })
  assert.equal((await call('PATCH', `/providers/${endpoint.json.id}/connection`, {})).status, 400)
  assert.equal((await call('PATCH', `/providers/${endpoint.json.id}/connection`, { apiKey: 'raw-secret' })).status, 400)

  const session = await call('POST', '/providers', {
    label: 'No dial-out connection',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    kind: 'session',
  })
  assert.equal(session.status, 200)
  const refused = await call('PATCH', `/providers/${session.json.id}/connection`, { model: 'nope' })
  assert.equal(refused.status, 409)
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
