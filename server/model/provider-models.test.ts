/** ── Locking tests: provider model catalogs + the concrete model pick ─────────
 *  The flexible half of D9 (spec MODEL-16/-17): a provider may carry a `models`
 *  catalog — every metadata field optional (providers disagree wildly; absence =
 *  unknown) — obtained from its endpoint's own `GET /v1/models` ('listed') or
 *  declared on the request ('static'). The composer's second pick level
 *  (`session.modelId`) must name a catalog entry (refused otherwise, INV-9), and
 *  the usage snapshot's context capacity is sourced from the resolved
 *  provider+model — unknown-capacity when the provider doesn't expose it. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { type Server } from 'node:http'
import { startModelServer } from './index.ts'
import { seedModels } from './catalog.ts'
import { fetchProviderModels } from '../generate.ts'
import { store } from '../store/index.ts'
import { call, callRaw } from '../testkit/http.ts'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'

let mock: Server
let mockUrl = ''

before(async () => {
  mock = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => mock.on('listening', () => r()))
  const addr = mock.address()
  mockUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
})

after(() => mock.close())

const frames = (body: string) =>
  body
    .split('\n\n')
    .filter(Boolean)
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(5).trim()))

// ── The endpoint's list API → the normalized catalog ─────────────────────────

test('the mock endpoint answers GET /v1/models in the Anthropic wire shape', async () => {
  const res = await fetch(`${mockUrl}/v1/models`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { data: any[]; has_more: boolean }
  assert.equal(body.has_more, false)
  assert.ok(body.data.length >= 3)
  const opus = body.data.find((m) => m.id === 'claude-opus-4-8')
  assert.equal(opus.display_name, 'Claude Opus 4.8')
  assert.equal(opus.type, 'model')
  assert.equal(opus.max_input_tokens, 1_000_000)
  assert.equal(opus.capabilities.effort.supported, true)
  assert.equal(opus.capabilities.effort.xhigh.supported, true)
  assert.equal(opus.capabilities.thinking.supported, true)
})

test('fetchProviderModels normalizes the wire face back to exactly the seed catalog (one source, two faces)', async () => {
  const listed = await fetchProviderModels({ baseURL: mockUrl })
  assert.deepEqual(listed, seedModels(), 'the live fetch round-trips to the seeded default catalog')
  // Explicit no-support stays empty; only unknown metadata may inherit the
  // provider vocabulary. Sonnet has a 3-level ladder, Opus the full 5.
  const byId = Object.fromEntries((listed ?? []).map((m) => [m.id, m]))
  assert.deepEqual(byId['claude-opus-4-8'].effortLevels, ['Low', 'Medium', 'High', 'xHigh', 'Max'])
  assert.deepEqual(byId['claude-sonnet-4-6'].effortLevels, ['Low', 'Medium', 'High'])
  assert.deepEqual(byId['claude-haiku-4-5'].effortLevels, [])
})

test('fetchProviderModels yields undefined for an endpoint with no list API (absence, not an error)', async () => {
  assert.equal(await fetchProviderModels({ baseURL: 'http://127.0.0.1:1' }), undefined)
})

test('the seeded default provider carries its catalog, stamped listed', async () => {
  const { json: providers } = await call('GET', '/providers')
  const def = providers.find((p: any) => p.id === DEFAULT_PROVIDER_ID)
  assert.deepEqual(def.models, seedModels())
  assert.equal(def.catalogSource, 'listed')
})

test('the OpenAI seed: a second shared provider with a static curated catalog (its real list API carries no metadata)', async () => {
  // Shared infra — visible to every tenant, like the default provider.
  for (const tenant of [undefined, 'tenant-acme', 'tenant-harbor']) {
    const list = await call('GET', '/providers', undefined, tenant ? { 'x-tenant-id': tenant } : undefined)
    assert.ok(list.json.some((p: any) => p.id === 'provider-openai'), `visible to ${tenant ?? 'the default tenant'}`)
  }
  const openai = (await call('GET', '/providers')).json.find((p: any) => p.id === 'provider-openai')
  assert.equal(openai.label, 'OpenAI')
  assert.equal(openai.catalogSource, 'static', 'curated from docs, not listed — OpenAI’s list API exposes no metadata')
  assert.equal(openai.defaultModelId, 'gpt-5.1', 'the configured model, stamped at serve time')
  assert.equal(openai.models.length, 3)
  // Per-field flexibility, exercised: GPT-5.1 declares the reasoning ladder, the
  // mini a subset, GPT-4.1 an EMPTY vocabulary (no reasoning — the effort control
  // stands down instead of falling back to the provider's).
  const byId = Object.fromEntries(openai.models.map((m: any) => [m.id, m]))
  assert.deepEqual(byId['gpt-5.1'].effortLevels, ['Minimal', 'Low', 'Medium', 'High'])
  assert.deepEqual(byId['gpt-5.1-mini'].effortLevels, ['Low', 'Medium'])
  assert.deepEqual(byId['gpt-4.1'].effortLevels, [])
})

test('picking the OpenAI provider routes and measures against ITS catalog', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: 'provider-openai' })
  // Unset model pick → the configured model (gpt-5.1) and its 400k window.
  const usage = (await call('GET', `/usage?session=${session.id}`)).json
  assert.equal(usage.model.providerLabel, 'OpenAI')
  assert.equal(usage.model.modelLabel, 'GPT-5.1')
  assert.equal(usage.context.windowTokens, 400_000)
  // A concrete pick within its catalog validates and re-measures.
  const picked = await call('PATCH', `/sessions/${session.id}`, { modelId: 'gpt-4.1' })
  assert.equal(picked.status, 200)
  const usage41 = (await call('GET', `/usage?session=${session.id}`)).json
  assert.equal(usage41.context.windowTokens, 1_047_576)
  // A Claude model id is NOT in OpenAI's catalog — refused, never normalized.
  const cross = await call('PATCH', `/sessions/${session.id}`, { modelId: 'claude-opus-4-8' })
  assert.equal(cross.status, 400)
  // The turn stamps the resolved OpenAI model as provenance.
  const send = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'plain turn' })
  assert.equal(send.status, 200)
  assert.equal(store.getSession(session.id)?.messages?.at(-1)?.modelId, 'gpt-4.1')
})

// ── Registration: listed vs static vs none ────────────────────────────────────

test('registering a provider with its own endpoint fetches its catalog (listed)', async () => {
  const created = await call('POST', '/providers', {
    label: 'Own endpoint',
    modelFamily: 'claude',
    effortLevels: ['Standard'],
    config: { baseURL: mockUrl },
  })
  assert.equal(created.status, 200)
  assert.deepEqual(created.json.models, seedModels(), 'the catalog came from the endpoint itself')
  assert.equal(created.json.catalogSource, 'listed')
})

test('an explicit static catalog wins over the endpoint fetch, and a forged catalogSource is stripped', async () => {
  const created = await call('POST', '/providers', {
    label: 'Static catalog',
    modelFamily: 'llama',
    effortLevels: ['Standard'],
    catalogSource: 'listed', // forged — server-derived only
    models: [{ id: 'llama-3-70b', label: 'Llama 3 70B', contextWindow: 8192 }],
    config: { baseURL: mockUrl },
  })
  assert.equal(created.status, 200)
  assert.equal(created.json.models.length, 1)
  assert.equal(created.json.models[0].id, 'llama-3-70b')
  assert.equal(created.json.catalogSource, 'static', 'declared by hand ⇒ static, never claimable as listed')
})

test('a provider with no endpoint of its own declares no catalog (absence = can’t enumerate)', async () => {
  const created = await call('POST', '/providers', { label: 'Ambient gateway', modelFamily: 'claude', effortLevels: ['Standard'] })
  assert.equal(created.status, 200)
  assert.equal(created.json.models, undefined)
  assert.equal(created.json.catalogSource, undefined)
})

test('a malformed static catalog is refused loudly (400), never normalized', async () => {
  for (const models of [[], [{ id: '', label: 'x' }], [{ id: 'a', label: 'A' }, { id: 'a', label: 'A again' }]]) {
    const res = await call('POST', '/providers', { label: 'Bad catalog', modelFamily: 'x', effortLevels: [], models })
    assert.equal(res.status, 400, `refused: ${JSON.stringify(models)}`)
  }
  const unknown = await call('POST', '/providers', {
    label: 'Unknown catalog shape',
    modelFamily: 'x',
    effortLevels: [],
    models: [{ id: 'a', label: 'A', tenantId: 'tenant-forged' }],
  })
  assert.equal(unknown.status, 400, 'unknown nested catalog fields never become durable')
})

test('a Session provider has no catalog — models are refused at mint and at patch', async () => {
  const bad = await call('POST', '/providers', {
    label: 'Relay with models',
    modelFamily: 'claude',
    effortLevels: ['Default'],
    kind: 'session',
    models: [{ id: 'x', label: 'X' }],
  })
  assert.equal(bad.status, 400)
  const relay = await call('POST', '/providers', { label: 'Plain relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' })
  assert.equal(relay.status, 200)
  const patched = await call('PATCH', `/providers/${relay.json.id}`, { models: [{ id: 'x', label: 'X' }] })
  assert.equal(patched.status, 400)
  const catalog = await call('PATCH', `/providers/${relay.json.id}/models`, { models: [{ id: 'x', label: 'X' }] })
  assert.equal(catalog.status, 409)
  const refresh = await call('POST', `/providers/${relay.json.id}/models/refresh`)
  assert.equal(refresh.status, 409, 'nothing to list from — refresh refuses')
})

// ── The refresh funnel + the stale-pick sweep ─────────────────────────────────

test('the dedicated catalog PATCH declares static models and clears picks the new list drops', async () => {
  const created = await call('POST', '/providers', {
    label: 'Shrinking catalog',
    modelFamily: 'claude',
    effortLevels: ['Standard'],
    models: [{ id: 'm-old', label: 'Old model' }, { id: 'm-kept', label: 'Kept model' }],
  })
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: created.json.id, modelId: 'm-old' })
  assert.equal(session.modelId, 'm-old')
  const ordinary = await call('PATCH', `/providers/${created.json.id}`, { models: [{ id: 'm-kept', label: 'Kept model' }] })
  assert.equal(ordinary.status, 400, 'a catalog cannot ride the provider-definition domain')
  const forged = await call('PATCH', `/providers/${created.json.id}/models`, {
    models: [{ id: 'm-kept', label: 'Kept model' }],
    catalogSource: 'listed',
  })
  assert.equal(forged.status, 400, 'the source stamp is earned, never caller-authored')
  const nestedForgery = await call('PATCH', `/providers/${created.json.id}/models`, {
    models: [{ id: 'm-kept', label: 'Kept model', connectionRevision: 99 }],
  })
  assert.equal(nestedForgery.status, 400, 'unknown nested catalog fields are refused')
  const headers = { 'idempotency-key': `static-catalog-${created.json.id}` }
  const patched = await call('PATCH', `/providers/${created.json.id}/models`, {
    models: [{ id: 'm-kept', label: 'Kept model' }],
    expectedRevision: 0,
  }, headers)
  assert.equal(patched.status, 200)
  assert.equal(patched.json.catalogSource, 'static')
  assert.equal(patched.json.connectionRevision, 1)
  assert.equal(store.getSession(session.id)?.modelId, undefined, 'the dropped model’s pick was cleared (the documented cascade)')
  const replay = await call('PATCH', `/providers/${created.json.id}/models`, {
    models: [{ id: 'm-kept', label: 'Kept model' }],
    expectedRevision: 0,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.connectionRevision, 1, 'one logical catalog replacement advances ordering once')
  const stale = await call('PATCH', `/providers/${created.json.id}/models`, {
    models: [{ id: 'm-new', label: 'New model' }],
    expectedRevision: 0,
  })
  assert.equal(stale.status, 409)
  assert.equal(store.listProviders().find((provider) => provider.id === created.json.id)?.models?.[0]?.id, 'm-kept')
})

test('POST /providers/:id/models/refresh re-fetches from the endpoint and stamps listed', async () => {
  const created = await call('POST', '/providers', {
    label: 'Refreshable',
    modelFamily: 'claude',
    effortLevels: ['Standard'],
    models: [{ id: 'hand-declared', label: 'Hand declared' }],
    config: { baseURL: mockUrl },
  })
  assert.equal(created.json.catalogSource, 'static')
  const refreshed = await call('POST', `/providers/${created.json.id}/models/refresh`)
  assert.equal(refreshed.status, 200)
  assert.deepEqual(refreshed.json.models, seedModels(), 'the endpoint’s own list replaced the static one')
  assert.equal(refreshed.json.catalogSource, 'listed')
})

// ── The second pick level: session.modelId ────────────────────────────────────

test('a session model pick must name a catalog entry — refused at create and patch, nothing half-writes', async () => {
  const bad = await call('POST', '/sessions', { firstMessage: 'x', modelId: 'claude-ghost-1' })
  assert.equal(bad.status, 400, 'off-catalog pick at create')
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x' })
  const patched = await call('PATCH', `/sessions/${session.id}`, { modelId: 'claude-ghost-1', title: 'should not land' })
  assert.equal(patched.status, 400)
  assert.equal(store.getSession(session.id)?.title === 'should not land', false, 'a refused patch changes nothing')
  // A relay pick can't name a concrete model at all (no catalog to validate against).
  const relay = await call('POST', '/providers', { label: 'Pickless relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' })
  const refused = await call('POST', '/sessions', { firstMessage: 'x', providerId: relay.json.id, modelId: 'claude-opus-4-8' })
  assert.equal(refused.status, 400)
})

test('PATCH sets/clears the model pick; a provider change clears it (namespace moved)', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x' })
  const set = await call('PATCH', `/sessions/${session.id}`, { modelId: 'claude-sonnet-4-6' })
  assert.equal(set.status, 200)
  assert.equal(set.json.modelId, 'claude-sonnet-4-6')
  // The list projection ships the pick back — the composer trigger reads it there.
  const row = (await call('GET', '/sessions')).json.find((s: any) => s.id === session.id)
  assert.equal(row.modelId, 'claude-sonnet-4-6', 'the list row carries the model pick (UI-12 sync)')
  // Switch the provider — the model pick's namespace changed, so it clears.
  const other = await call('POST', '/providers', {
    label: 'Other catalog',
    modelFamily: 'claude',
    effortLevels: ['Standard'],
    models: [{ id: 'other-model', label: 'Other model' }],
  })
  const switched = await call('PATCH', `/sessions/${session.id}`, { providerId: other.json.id })
  assert.equal(switched.json.modelId, undefined, 'the stale pick did not survive the provider switch')
  // One PATCH can switch provider AND re-pick within the new catalog.
  const both = await call('PATCH', `/sessions/${session.id}`, { providerId: '', modelId: 'claude-haiku-4-5' })
  assert.equal(both.status, 200)
  assert.equal(both.json.modelId, 'claude-haiku-4-5')
  const cleared = await call('PATCH', `/sessions/${session.id}`, { modelId: '' })
  assert.equal(cleared.json.modelId, undefined, 'empty string clears back to inherit')
})

test('deleting a provider clears the model pick along with the provider pick', async () => {
  const p = await call('POST', '/providers', {
    label: 'Doomed catalog',
    modelFamily: 'claude',
    effortLevels: ['Standard'],
    models: [{ id: 'doomed-model', label: 'Doomed model' }],
  })
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: p.json.id, modelId: 'doomed-model' })
  assert.equal((await call('DELETE', `/providers/${p.json.id}`)).status, 200)
  const row = store.getSession(session.id)
  assert.equal(row?.providerId, undefined)
  assert.equal(row?.modelId, undefined, 'no dangling model id from the deleted catalog')
})

test('the pick routes the turn: the assistant message is stamped with the resolved modelId', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', modelId: 'claude-haiku-4-5' })
  const send = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'plain turn' })
  assert.equal(send.status, 200)
  const end = frames(send.body).find((f) => f.type === 'message.end')
  assert.equal(end?.message.modelId, 'claude-haiku-4-5', 'per-turn model provenance = the session pick')
  assert.equal(store.getSession(session.id)?.messages?.at(-1)?.modelId, 'claude-haiku-4-5')
  // Unpicked = the provider's configured model (the env default), still stamped.
  const { json: plain } = await call('POST', '/sessions', { firstMessage: 'x' })
  const send2 = await callRaw('POST', `/sessions/${plain.id}/messages`, { text: 'unpicked turn' })
  const end2 = frames(send2.body).find((f) => f.type === 'message.end')
  assert.equal(end2?.message.modelId, 'claude-opus-4-8', 'inherit resolves to the configured/env default')
})

test('the invariant sweep: an Agent re-bind or hand-off that moves a session’s effective provider clears its model pick', async () => {
  // A pick is validated against the session's EFFECTIVE provider (the inherit
  // chain), so any indirect change of that resolution must re-validate it —
  // otherwise a once-valid pick routes an off-catalog model to the new provider.
  const bare = await call('POST', '/providers', { label: 'No catalog target', modelFamily: 'x', effortLevels: [] })
  const prompt = store.listSystemPrompts()[0].id
  const agent = await call('POST', '/agents', { label: 'Default-bound', providerId: DEFAULT_PROVIDER_ID, systemPromptId: prompt })
  assert.equal(agent.status, 200)
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', modelId: 'claude-haiku-4-5' })
  // Hand off to an agent on the SAME provider — the pick's namespace didn't move.
  store.setSessionAgent(session.id, agent.json.id)
  assert.equal(store.getSession(session.id)?.modelId, 'claude-haiku-4-5', 'same-provider hand-off keeps the pick')
  // Re-bind that agent's provider to a catalog-less one — the pick must clear.
  const rebound = await call('PATCH', `/agents/${agent.json.id}`, { providerId: bare.json.id })
  assert.equal(rebound.status, 200)
  assert.equal(store.getSession(session.id)?.modelId, undefined, 'the re-bind swept the now-dangling pick')
})

test('defaultModelId is the serve-time stamp of the configured model — shown, never stored or forgeable', async () => {
  // The default provider resolves an unset pick to the env-default model.
  const def = (await call('GET', '/providers')).json.find((p: any) => p.id === DEFAULT_PROVIDER_ID)
  assert.equal(def.defaultModelId, 'claude-opus-4-8')
  // A provider configured onto a non-first catalog model reports THAT model — the
  // client's inherit display can't drift from what a turn actually runs.
  const created = await call('POST', '/providers', {
    label: 'Haiku-configured',
    modelFamily: 'claude',
    effortLevels: ['Standard'],
    defaultModelId: 'forged-model', // serve-time stamp — a request can't set it
    config: { baseURL: mockUrl, model: 'claude-haiku-4-5' },
  })
  assert.equal(created.json.defaultModelId, 'claude-haiku-4-5', 'stamped from the config, not the request')
  // A Session provider has no resolvable model — no stamp.
  const relay = await call('POST', '/providers', { label: 'Stampless relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' })
  assert.equal(relay.json.defaultModelId, undefined)
})

// ── The usage snapshot: provider-sourced context capacity ─────────────────────

test('the usage snapshot measures the context against the resolved model’s window', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x' })
  const def = (await call('GET', `/usage?session=${session.id}`)).json
  assert.equal(def.context.windowTokens, 1_000_000, 'default = Opus’s 1M, from the provider catalog')
  assert.equal(def.model.providerId, DEFAULT_PROVIDER_ID)
  assert.equal(def.model.modelLabel, 'Claude Opus 4.8')
  await call('PATCH', `/sessions/${session.id}`, { modelId: 'claude-sonnet-4-6' })
  const sonnet = (await call('GET', `/usage?session=${session.id}`)).json
  assert.equal(sonnet.context.windowTokens, 200_000, 'the pick changed what the gauge measures against')
  assert.equal(sonnet.model.modelLabel, 'Claude Sonnet 4.6')
  assert.equal(sonnet.context.total, '200.0k')
})

test('a provider that can’t expose the window degrades to unknown-capacity (no fabricated 100%)', async () => {
  const relay = await call('POST', '/providers', { label: 'Opaque relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' })
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: relay.json.id })
  const usage = (await call('GET', `/usage?session=${session.id}`)).json
  assert.equal(usage.context.windowTokens, undefined)
  assert.equal(usage.context.total, '—')
  assert.equal(usage.context.pct, 0)
  assert.ok(!usage.context.segments.some((s: any) => s.id === 'free'), 'Free space is uncomputable — no fabricated row')
  assert.ok(usage.context.segments.every((s: any) => s.pct === undefined), 'no percentages without a known window')
  assert.equal(usage.model.providerLabel, 'Opaque relay')
  assert.equal(usage.model.modelId, undefined, 'the relay’s model is whatever session drains it — unknowable')
})
