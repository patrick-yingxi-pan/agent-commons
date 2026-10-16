/** User-selected Agent bindings on ordinary Conversations — creation, metadata
 *  PATCH, authorization, routing-pick compatibility, and deleted-binding repair.
 *  These are route/store contracts: no live provider credentials are needed. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'
import { startModelServer } from '../model/index.ts'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { call, callRaw } from '../testkit/http.ts'

const OWNER = `tenant-session-agent-owner-${Date.now().toString(36)}`
const AUDIENCE = 'tenant-beta'
const FOREIGN = `tenant-session-agent-foreign-${Date.now().toString(36)}`
const ownerHeaders = { 'x-tenant-id': OWNER }

let modelServer: Server
const previousModelUrl = process.env.ANTHROPIC_BASE_URL

before(async () => {
  modelServer = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => modelServer.on('listening', resolve))
  const address = modelServer.address()
  const port = typeof address === 'object' && address ? address.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})

after(() => {
  if (previousModelUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = previousModelUrl
  modelServer.close()
})

let sequence = 0
async function createAgent(tenantId = OWNER, providerId = DEFAULT_PROVIDER_ID) {
  const response = await call('POST', '/agents', {
    label: `Session binding ${++sequence}`,
    providerId,
    systemPromptId: 'sp-concise-reviewer',
  }, { 'x-tenant-id': tenantId })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return response.json as { id: string; label: string; revision: number }
}

async function createSession(tenantId = OWNER, agentId?: string, extra: Record<string, unknown> = {}) {
  const response = await call('POST', '/sessions', {
    firstMessage: `Conversation ${++sequence}`,
    ...(agentId === undefined ? {} : { agentId }),
    ...extra,
  }, { 'x-tenant-id': tenantId })
  return response
}

test('POST persists a visible Agent choice in create, list, and detail; omission remains default', async () => {
  const agent = await createAgent()
  const created = await createSession(OWNER, agent.id)
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.agentId, agent.id)

  const listed = await call('GET', '/sessions', undefined, ownerHeaders)
  assert.equal(listed.status, 200)
  assert.equal(listed.json.find((row: { id: string }) => row.id === created.json.id)?.agentId, agent.id)
  const detail = await call('GET', `/sessions/${created.json.id}`, undefined, ownerHeaders)
  assert.equal(detail.status, 200)
  assert.equal(detail.json.agentId, agent.id)

  const omitted = await createSession()
  assert.equal(omitted.status, 200)
  assert.equal(omitted.json.agentId, 'agent-default', 'omitted draft choice preserves the default Agent')
})

test('create and patch reject malformed, unknown, and invisible Agent references without writing', async () => {
  const beforeInvalidCreates = store.listSessions(OWNER).length
  for (const agentId of ['', '   ', null, 42, {}]) {
    const invalid = await createSession(OWNER, undefined, { agentId })
    assert.equal(invalid.status, 400, `create refuses ${JSON.stringify(agentId)}`)
  }
  assert.equal(store.listSessions(OWNER).length, beforeInvalidCreates, 'malformed create never leaves a row')
  const unknownCreate = await createSession(OWNER, 'agent-session-binding-missing')
  assert.equal(unknownCreate.status, 404)

  const ownAgent = await createAgent()
  const session = await createSession()
  for (const agentId of ['', '   ', null, 42, {}]) {
    const invalid = await call('PATCH', `/sessions/${session.json.id}`, { agentId }, ownerHeaders)
    assert.equal(invalid.status, 400, `patch refuses ${JSON.stringify(agentId)}`)
  }
  const unknownPatch = await call('PATCH', `/sessions/${session.json.id}`, { agentId: 'agent-session-binding-missing' }, ownerHeaders)
  assert.equal(unknownPatch.status, 404)
  assert.equal(store.getSession(session.json.id)?.agentId, 'agent-default')
  assert.equal(store.getSession(session.json.id)?.metadataRevision, 0, 'refused routing changes do not advance revision')

  const foreignAgent = await createAgent(FOREIGN)
  const foreignCreate = await createSession(OWNER, foreignAgent.id)
  assert.equal(foreignCreate.status, 404, 'an Agent invisible to the creator is indistinguishable from missing')
  const foreignPatch = await call('PATCH', `/sessions/${session.json.id}`, { agentId: foreignAgent.id }, ownerHeaders)
  assert.equal(foreignPatch.status, 404)
  assert.equal(store.getSession(session.json.id)?.agentId, 'agent-default')
  assert.equal(store.getSession(session.json.id)?.metadataRevision, 0)
  assert.ok(store.listAgents(OWNER).some((candidate) => candidate.id === ownAgent.id))
})

test('PATCH binding is owner-only, hides foreign sessions, and uses revision/idempotency semantics', async () => {
  const agent = await createAgent()
  const session = await createSession()
  const key = `session-agent-bind-${session.json.id}`
  const body = { agentId: agent.id, expectedRevision: 0 }
  const headers = { ...ownerHeaders, 'idempotency-key': key }

  const changed = await call('PATCH', `/sessions/${session.json.id}`, body, headers)
  assert.equal(changed.status, 200, JSON.stringify(changed.json))
  assert.equal(changed.json.agentId, agent.id)
  assert.equal(changed.json.metadataRevision, 1)
  const retry = await call('PATCH', `/sessions/${session.json.id}`, body, headers)
  assert.equal(retry.status, 200)
  assert.equal(retry.json.metadataRevision, 1, 'one acknowledged retry advances the row only once')

  const stale = await call('PATCH', `/sessions/${session.json.id}`, {
    agentId: 'agent-default', expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(stale.status, 409)
  assert.equal(store.getSession(session.json.id)?.agentId, agent.id)

  const foreignSession = await createSession(FOREIGN)
  const hidden = await call('PATCH', `/sessions/${foreignSession.json.id}`, { agentId: agent.id }, ownerHeaders)
  assert.equal(hidden.status, 404, 'foreign Session existence remains hidden')

  const audience = await call('POST', '/grants', {
    subject: { kind: 'session', id: session.json.id },
    audience: { kind: 'org', orgId: AUDIENCE },
    tier: 'view',
  }, ownerHeaders)
  assert.equal(audience.status, 200, JSON.stringify(audience.json))
  const readonly = await call('PATCH', `/sessions/${session.json.id}`, { agentId: 'agent-default' }, {
    'x-tenant-id': AUDIENCE,
    'idempotency-key': key,
  })
  assert.equal(readonly.status, 403, 'read grants cannot replay the owner’s cached binding acknowledgement')
  assert.equal(store.getSession(session.json.id)?.agentId, agent.id)
})

test('Agent change validates a combined model pick atomically and preserves explicit provider overrides', async () => {
  const openAiAgent = await createAgent(OWNER, 'provider-openai')
  const selectedAtCreate = await createSession(OWNER, openAiAgent.id, { modelId: 'gpt-5.1' })
  assert.equal(selectedAtCreate.status, 200, JSON.stringify(selectedAtCreate.json))
  assert.equal(selectedAtCreate.json.agentId, openAiAgent.id)
  assert.equal(selectedAtCreate.json.modelId, 'gpt-5.1', 'draft picks validate against the selected Agent provider')

  const session = await createSession()

  const invalidCombined = await call('PATCH', `/sessions/${session.json.id}`, {
    agentId: openAiAgent.id,
    modelId: 'model-not-in-openai-catalog',
    expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(invalidCombined.status, 400, 'model is checked against the resulting Agent provider before mutation')
  assert.equal(store.getSession(session.json.id)?.agentId, 'agent-default')
  assert.equal(store.getSession(session.json.id)?.modelId, undefined)
  assert.equal(store.getSession(session.json.id)?.metadataRevision, 0)

  const accepted = await call('PATCH', `/sessions/${session.json.id}`, {
    agentId: openAiAgent.id,
    providerId: '',
    modelId: 'gpt-5.1',
    expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json))
  assert.equal(accepted.json.agentId, openAiAgent.id)
  assert.equal(accepted.json.providerId, undefined, 'empty provider clears the override to the selected Agent')
  assert.equal(accepted.json.modelId, 'gpt-5.1')

  const inheritedPickSession = await createSession()
  const claudeModel = store.listProviders(OWNER).find((provider) => provider.id === DEFAULT_PROVIDER_ID)?.models?.[0]?.id
  assert.ok(claudeModel, 'the default provider exposes its deterministic seeded catalog')
  const picked = await call('PATCH', `/sessions/${inheritedPickSession.json.id}`, {
    modelId: claudeModel, expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(picked.status, 200, JSON.stringify(picked.json))
  const changedAgent = await call('PATCH', `/sessions/${inheritedPickSession.json.id}`, {
    agentId: openAiAgent.id, expectedRevision: 1,
  }, ownerHeaders)
  assert.equal(changedAgent.status, 200, JSON.stringify(changedAgent.json))
  assert.equal(changedAgent.json.modelId, undefined,
    'an inherited pick outside the new Agent provider is cleared in the same revision')
  assert.equal(changedAgent.json.metadataRevision, 2)

  const defaultProviderAgent = await createAgent()
  const explicitOverride = await createSession(OWNER, undefined, {
    providerId: 'provider-openai', modelId: 'gpt-5.1',
  })
  assert.equal(explicitOverride.status, 200)
  const rebound = await call('PATCH', `/sessions/${explicitOverride.json.id}`, {
    agentId: defaultProviderAgent.id,
    expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(rebound.status, 200, JSON.stringify(rebound.json))
  assert.equal(rebound.json.providerId, 'provider-openai', 'Agent choice does not erase an explicit Session override')
  assert.equal(rebound.json.modelId, 'gpt-5.1', 'the still-valid pick remains in its explicit provider namespace')
})

test('PATCH refuses a driver change during a live turn without disturbing either state', async () => {
  const agent = await createAgent()
  const session = await createSession()
  const active = turns.start(session.json.id, () => {})
  assert.ok(active)
  try {
    const refused = await call('PATCH', `/sessions/${session.json.id}`, {
      agentId: agent.id, expectedRevision: 0,
    }, ownerHeaders)
    assert.equal(refused.status, 409)
    assert.equal(store.getSession(session.json.id)?.agentId, 'agent-default')
    assert.equal(store.getSession(session.json.id)?.metadataRevision, 0)
    assert.equal(turns.bySession(session.json.id)?.id, active.id)
  } finally {
    turns.finish(active.id)
  }
})

test('PATCH refuses to change the Agent while model-bound compaction is in flight', async () => {
  const agent = await createAgent()
  const session = await createSession()
  for (let index = 0; index < 10; index += 1) {
    store.appendMessage(session.json.id, {
      id: store.mintMessageId('user'),
      role: 'user',
      content: `Compaction source message ${index}: preserve this decision in the summary.`,
    })
  }

  const compaction = call('POST', `/sessions/${session.json.id}/compact`, undefined, ownerHeaders)
  const refused = await call('PATCH', `/sessions/${session.json.id}`, {
    agentId: agent.id, expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(refused.status, 409, 'the binding cannot change after compaction admission')
  assert.equal(store.getSession(session.json.id)?.agentId, 'agent-default')
  const compacted = await compaction
  assert.equal(compacted.status, 200, JSON.stringify(compacted.json))
})

test('a deleted explicit Agent fails closed before turn persistence; owner can repair to default', async () => {
  const agent = await createAgent()
  const session = await createSession(OWNER, agent.id)
  const removed = await call('DELETE', `/agents/${agent.id}`, { expectedRevision: 0 }, ownerHeaders)
  assert.equal(removed.status, 200, JSON.stringify(removed.json))

  const beforeMessages = store.getSession(session.json.id)?.messages?.length
  const refused = await callRaw('POST', `/sessions/${session.json.id}/messages`, { text: 'must not fall back silently' }, ownerHeaders)
  assert.ok(refused.status >= 400, `deleted binding must fail closed, got ${refused.status}`)
  assert.equal(store.getSession(session.json.id)?.messages?.length, beforeMessages,
    'the user row is not appended before the missing Agent refusal')
  const compact = await call('POST', `/sessions/${session.json.id}/compact`, undefined, ownerHeaders)
  assert.equal(compact.status, 409, 'compaction refuses the deleted binding before preparation or model I/O')

  const repaired = await call('PATCH', `/sessions/${session.json.id}`, {
    agentId: 'agent-default', expectedRevision: 0,
  }, ownerHeaders)
  assert.equal(repaired.status, 200, JSON.stringify(repaired.json))
  assert.equal(repaired.json.agentId, 'agent-default')
  const sent = await callRaw('POST', `/sessions/${session.json.id}/messages`, { text: 'repaired default binding' }, ownerHeaders)
  assert.equal(sent.status, 200, sent.body)
  assert.equal(store.getSession(session.json.id)?.messages?.at(-1)?.agentId, 'agent-default')
})

test('a legacy Session with no stored agentId continues to resolve through the default Agent', async () => {
  const session = await createSession()
  const row = store.getSession(session.json.id)
  assert.ok(row)
  delete row.agentId

  const sent = await callRaw('POST', `/sessions/${session.json.id}/messages`, { text: 'legacy default driver' }, ownerHeaders)
  assert.equal(sent.status, 200, sent.body)
  assert.equal(store.getSession(session.json.id)?.messages?.at(-1)?.agentId, 'agent-default')

  const compact = await call('POST', `/sessions/${session.json.id}/compact`, undefined, ownerHeaders)
  assert.equal(compact.status, 200, JSON.stringify(compact.json),
    'the no-op compaction admission also retains legacy absent-means-default behavior')
})
