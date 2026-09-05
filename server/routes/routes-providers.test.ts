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
import { call, callFresh } from '../testkit/http.ts'
import { ConflictError } from '../conflict.ts'
import { providerCreationId } from '../providerCreationIdentity.ts'
import { providerSecretRotationId } from '../providerSecretRotationIdentity.ts'

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

test('a keyed Session-provider create survives response-cache loss with one row and the same one-time secret', async () => {
  const tenantId = 'tenant-provider-create-durable'
  const key = `provider-create-${Date.now().toString(36)}`
  const headers = { 'x-tenant-id': tenantId, 'idempotency-key': key }
  const body = {
    label: 'Durable relay provider',
    modelFamily: 'claude',
    effortLevels: ['Low', 'Medium', 'High'],
    kind: 'session',
    isDefault: true,
  }
  const expectedId = providerCreationId(tenantId, key)
  const created = await call('POST', '/providers', body, headers)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)
  assert.match(created.json.secret, /^rv_live_/)

  const cachedReplay = await call('POST', '/providers', body, headers)
  assert.equal(cachedReplay.headers['idempotency-replayed'], undefined, 'revocable credentials bypass the generic response cache')
  assert.equal(cachedReplay.json.secret, created.json.secret)

  // A fresh router has no idempotency response cache, like a restarted process,
  // while the real store still carries the durable provider row.
  const durableReplay = await callFresh(
    'POST',
    '/providers',
    { ...body, label: 'A changed retry body must not overwrite the represented row' },
    headers,
  )
  assert.equal(durableReplay.status, 200)
  assert.equal(durableReplay.headers['idempotency-replayed'], undefined)
  assert.equal(durableReplay.json.id, expectedId)
  assert.equal(durableReplay.json.label, body.label)
  assert.equal(durableReplay.json.secret, created.json.secret)
  assert.equal(
    store.listProviders(tenantId).filter((provider) => provider.id === expectedId).length,
    1,
    'durable identity, not only the response cache, prevents a duplicate provider',
  )

  // Replaying an old create is not permission to rewind a newer default choice.
  store.setDefaultProvider(DEFAULT_PROVIDER_ID, tenantId)
  const afterDefaultMoved = await callFresh('POST', '/providers', body, headers)
  assert.equal(afterDefaultMoved.status, 200)
  assert.equal(
    store.listProviders(tenantId).find((provider) => provider.id === expectedId)?.isDefault,
    undefined,
  )
  assert.equal(
    store.listProviders(tenantId).find((provider) => provider.id === DEFAULT_PROVIDER_ID)?.isDefault,
    true,
  )

  // The create key is recovery, not a permanent alternate credential. Once a
  // rotation changes durable truth, replaying the old mint cannot reveal or
  // restore its superseded bearer.
  const beforeRotationRevision = store.listProviders(tenantId)
    .find((provider) => provider.id === expectedId)?.connectionRevision ?? 0
  store.rotateProviderSecret(expectedId)
  assert.equal(
    store.listProviders(tenantId).find((provider) => provider.id === expectedId)?.connectionRevision,
    beforeRotationRevision + 1,
    'secret rotation advances the connection truth a removal must pin',
  )
  const afterRotation = await callFresh('POST', '/providers', body, headers)
  assert.equal(afterRotation.status, 409)
  assert.equal(afterRotation.json.secret, undefined)
})

test('keyed Session-secret rotation replays only its exact current durable receipt', async () => {
  const tenantId = 'tenant-provider-secret-rotation'
  const created = await call('POST', '/providers', {
    label: 'Recoverable rotation',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    kind: 'session',
  }, { 'x-tenant-id': tenantId })
  const providerId = created.json.id as string
  const expectedRevision = created.json.connectionRevision ?? 0
  const key = `provider-rotation-${Date.now().toString(36)}`
  const headers = { 'x-tenant-id': tenantId, 'idempotency-key': key }
  const expectedReceipt = providerSecretRotationId(tenantId, providerId, key)

  const rotated = await call('POST', `/providers/${providerId}/rotate`, { expectedRevision }, headers)
  assert.equal(rotated.status, 200)
  assert.match(rotated.json.secret, /^rv_live_/)
  assert.equal(rotated.json.connectionRevision, expectedRevision + 1)
  assert.deepEqual(rotated.json.secretRotationReceipt, { id: expectedReceipt, state: 'applied' })
  assert.equal(store.providerAcceptsRelaySecret(providerId, created.json.secret), false)
  assert.equal(store.providerAcceptsRelaySecret(providerId, rotated.json.secret), true)

  const replay = await call('POST', `/providers/${providerId}/rotate`, { expectedRevision }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.headers['idempotency-replayed'], undefined, 'current credential truth, not a response cache, authorizes recovery')
  assert.equal(replay.json.secret, rotated.json.secret)
  assert.equal(replay.json.connectionRevision, expectedRevision + 1)

  const restartedReplay = await callFresh('POST', `/providers/${providerId}/rotate`, { expectedRevision }, headers)
  assert.equal(restartedReplay.status, 200)
  assert.equal(restartedReplay.json.secret, rotated.json.secret)
  assert.equal(restartedReplay.json.connectionRevision, expectedRevision + 1)

  const nextKey = `${key}-next`
  const next = await call('POST', `/providers/${providerId}/rotate`, {
    expectedRevision: expectedRevision + 1,
  }, { 'x-tenant-id': tenantId, 'idempotency-key': nextKey })
  assert.equal(next.status, 200)
  assert.equal(next.json.connectionRevision, expectedRevision + 2)
  assert.notEqual(next.json.secret, rotated.json.secret)

  const superseded = await callFresh('POST', `/providers/${providerId}/rotate`, { expectedRevision }, headers)
  assert.equal(superseded.status, 409)
  assert.equal(superseded.json.secret, undefined)
  assert.equal(store.providerAcceptsRelaySecret(providerId, next.json.secret), true)
})

test('Session-secret cancellation fences late rotation and cannot hide an applied credential', async () => {
  const tenantId = 'tenant-provider-secret-cancel'
  const created = await call('POST', '/providers', {
    label: 'Cancellable rotation',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    kind: 'session',
  }, { 'x-tenant-id': tenantId })
  const providerId = created.json.id as string
  const key = `provider-rotation-cancel-${Date.now().toString(36)}`
  const headers = { 'x-tenant-id': tenantId, 'idempotency-key': key }
  const receiptId = providerSecretRotationId(tenantId, providerId, key)

  const cancelled = await call('DELETE', `/providers/${providerId}/rotate`, { expectedRevision: 0 }, headers)
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.json.connectionRevision, 1)
  assert.deepEqual(cancelled.json.secretRotationReceipt, { id: receiptId, state: 'cancelled' })
  assert.equal(store.providerAcceptsRelaySecret(providerId, created.json.secret), true, 'cancellation keeps the current bearer active')

  const replay = await callFresh('DELETE', `/providers/${providerId}/rotate`, { expectedRevision: 0 }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.connectionRevision, 1)
  assert.equal((await callFresh('POST', `/providers/${providerId}/rotate`, { expectedRevision: 0 }, headers)).status, 409)
  assert.equal(store.providerAcceptsRelaySecret(providerId, created.json.secret), true)

  const appliedKey = `${key}-applied`
  const appliedHeaders = { 'x-tenant-id': tenantId, 'idempotency-key': appliedKey }
  const applied = await call('POST', `/providers/${providerId}/rotate`, { expectedRevision: 1 }, appliedHeaders)
  assert.equal(applied.status, 200)
  assert.equal(applied.json.connectionRevision, 2)
  const refusedCancel = await callFresh('DELETE', `/providers/${providerId}/rotate`, { expectedRevision: 1 }, appliedHeaders)
  assert.equal(refusedCancel.status, 409)
  const recovered = await callFresh('POST', `/providers/${providerId}/rotate`, { expectedRevision: 1 }, appliedHeaders)
  assert.equal(recovered.status, 200)
  assert.equal(recovered.json.secret, applied.json.secret)
  assert.equal(recovered.json.connectionRevision, 2)
})

test('Session-secret rotation validates its recovery coordinates', async () => {
  const created = await call('POST', '/providers', {
    label: 'Strict rotation',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    kind: 'session',
  })
  const path = `/providers/${created.json.id}/rotate`
  assert.equal((await call('POST', path, { expectedRevision: -1 }, { 'idempotency-key': 'bad-revision' })).status, 400)
  assert.equal((await call('POST', path, {}, { 'idempotency-key': 'missing-revision' })).status, 400)
  assert.equal((await call('DELETE', path, { expectedRevision: 0 })).status, 400)
  assert.equal((await call('DELETE', path, { expectedRevision: -1 }, { 'idempotency-key': 'bad-cancel' })).status, 400)
  const oversized = 'x'.repeat(257)
  assert.equal((await call('POST', path, { expectedRevision: 0 }, { 'idempotency-key': oversized })).status, 400)
  assert.equal((await call('DELETE', path, { expectedRevision: 0 }, { 'idempotency-key': oversized })).status, 400)
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

test('DELETE pins both Provider revisions, batches session fallback, and replays one success', async () => {
  const created = await call('POST', '/providers', {
    label: 'Disposable',
    modelFamily: 'claude',
    effortLevels: ['Low'],
  })
  const id = created.json.id as string
  const changed = await call('PATCH', `/providers/${id}`, {
    label: 'Disposable but changed',
    expectedRevision: 0,
  })
  assert.equal(changed.status, 200)
  const catalog = store.replaceStaticProviderModels(id, [{ id: 'picked', label: 'Picked' }], 0)
  assert.equal(catalog?.connectionRevision, 1)
  const session = store.createSession('Provider removal fallback', store.defaultTenantId(), id, 'picked')

  for (const body of [
    { expectedDefinitionRevision: 1 },
    { expectedDefinitionRevision: -1, expectedConnectionRevision: 1 },
    { expectedDefinitionRevision: 1, expectedConnectionRevision: 1, label: 'No' },
  ]) {
    const invalid = await call('DELETE', `/providers/${id}`, body)
    assert.equal(invalid.status, 400, JSON.stringify(body))
  }

  const key = `provider-delete-${id}`
  const headers = { 'idempotency-key': key }
  for (const stale of [
    { expectedDefinitionRevision: 0, expectedConnectionRevision: 1 },
    { expectedDefinitionRevision: 1, expectedConnectionRevision: 0 },
  ]) {
    const refused = await call('DELETE', `/providers/${id}`, stale, headers)
    assert.equal(refused.status, 409, JSON.stringify(stale))
    assert.equal(store.listProviders().some((provider) => provider.id === id), true)
    const currentSession = store.listSessions().find((candidate) => candidate.id === session.id)
    assert.equal(currentSession?.providerId, id)
    assert.equal(currentSession?.modelId, 'picked')
  }

  const observed: Array<{ providerPresent: boolean; providerId?: string; modelId?: string }> = []
  const unsubscribe = store.subscribe((event) => {
    if (
      (event.type === 'provider.changed' && event.providerId === id) ||
      (event.type === 'session.updated' && event.session.id === session.id)
    ) {
      const currentSession = store.listSessions().find((candidate) => candidate.id === session.id)
      observed.push({
        providerPresent: store.listProviders().some((provider) => provider.id === id),
        ...(currentSession?.providerId ? { providerId: currentSession.providerId } : {}),
        ...(currentSession?.modelId ? { modelId: currentSession.modelId } : {}),
      })
    }
  })
  const del = await call('DELETE', `/providers/${id}`, {
    expectedDefinitionRevision: 1,
    expectedConnectionRevision: 1,
  }, headers)
  unsubscribe()
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })
  assert.ok(observed.length >= 2)
  assert.ok(observed.every((snapshot) =>
    !snapshot.providerPresent && snapshot.providerId === undefined && snapshot.modelId === undefined),
  'events publish only after Provider absence and conversation fallback are coherent')

  const replay = await call('DELETE', `/providers/${id}`, {
    expectedDefinitionRevision: 99,
    expectedConnectionRevision: 99,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.headers['idempotency-replayed'], 'true')

  const again = await call('DELETE', `/providers/${id}`)
  assert.equal(again.status, 404)

  const legacy = await call('POST', '/providers', {
    label: 'Legacy Provider removal',
    modelFamily: 'claude',
    effortLevels: ['Low'],
  })
  assert.equal((await call('DELETE', `/providers/${legacy.json.id}`)).status, 200)
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
