/** Worker-Agent CRUD on the wire (docs/agent-commons.md, D6) — the Agents hub's create /
 *  patch / delete. POST is **strict** (INV-9): `providerId` and `systemPromptId` are
 *  required and must name registered entries — the API never resolves a missing binding
 *  to a default (default-flagged entries are a UI pre-selection shortcut only) — and an
 *  omitted `tools` is the EMPTY set (minimal risk; the full catalog is an explicit
 *  grant). The prompt body is resolved from the named entry, then the D8 funnel runs
 *  (an over-grant is a 400); DELETE refuses the protected default and any Agent a
 *  Commission still assigns (409). The in-memory store is shared across the run, so each
 *  case uses its own labels. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import { TOOL_CATALOG, TOOL_NAMES } from '../model/tools.ts'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'

test('POST resolves the prompt body; an omitted tool grant is the EMPTY set (minimal risk)', async () => {
  const created = await call('POST', '/agents', {
    label: 'Reviewer',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('agent-'))
  assert.equal(created.json.revision, 0, 'a new Agent configuration starts at revision zero')
  assert.equal(created.json.providerId, DEFAULT_PROVIDER_ID)
  assert.equal(created.json.systemPromptId, 'sp-concise-reviewer')
  // The body is resolved from the library entry, not echoed from the request.
  assert.equal(created.json.systemPrompt, store.getSystemPrompt('sp-concise-reviewer')!.body)
  // No tools named ⇒ NO tools granted — the API never widens silently; the full
  // catalog is an explicit grant the dialog spells out.
  assert.equal(created.json.tools.length, 0)

  const one = await call('GET', `/agents/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Reviewer')
})

test('POST with an explicit full-catalog grant carries every tool (the dialog’s checked path)', async () => {
  const created = await call('POST', '/agents', {
    label: 'Fully tooled',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
    tools: [...TOOL_NAMES],
  })
  assert.equal(created.status, 200)
  assert.deepEqual(created.json.tools, TOOL_NAMES)
})

test('a keyed Agent create survives response-cache loss as one immutable row', async () => {
  const tenantId = 'tenant-agent-create-durable'
  const key = `agent-create-${Date.now().toString(36)}`
  const headers = { 'x-tenant-id': tenantId, 'idempotency-key': key }
  const body = {
    label: 'Durable Agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
    tools: [...TOOL_NAMES],
    instructions: 'Keep this original intent.',
  }
  const expectedId = agentCreationId(tenantId, key)
  const changed: string[] = []
  const unsubscribe = store.subscribe((event) => {
    if (event.type === 'agent.changed' && event.agentId === expectedId) changed.push(event.agentId)
  })
  const created = await call('POST', '/agents', body, headers)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)

  const cachedReplay = await call('POST', '/agents', body, headers)
  assert.equal(cachedReplay.headers['idempotency-replayed'], 'true')
  assert.deepEqual(cachedReplay.json, created.json)

  // A restarted router has no response cache. Durable identity still returns
  // the represented row before a changed Retry body can be applied.
  const durableReplay = await callFresh(
    'POST',
    '/agents',
    { ...body, label: 'Changed retry must not overwrite', instructions: 'Changed too.' },
    headers,
  )
  assert.equal(durableReplay.status, 200)
  assert.equal(durableReplay.headers['idempotency-replayed'], undefined)
  assert.equal(durableReplay.json.id, expectedId)
  assert.equal(durableReplay.json.label, body.label)
  assert.equal(durableReplay.json.instructions, body.instructions)
  assert.equal(
    store.listAgents(tenantId).filter((agent) => agent.id === expectedId).length,
    1,
    'durable identity, not only the response cache, prevents a duplicate Agent',
  )
  unsubscribe()
  assert.equal(changed.length, 1, 'durable replay emits only the first creation event')
})

test('deleting a keyed Agent retires its identity across router restart', async () => {
  const tenantId = 'tenant-agent-create-retirement'
  const key = `agent-create-retire-${Date.now().toString(36)}`
  const headers = { 'x-tenant-id': tenantId, 'idempotency-key': key }
  const body = {
    label: 'Retire this Agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  }
  const created = await call('POST', '/agents', body, headers)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, agentCreationId(tenantId, key))
  const removed = await call('DELETE', `/agents/${created.json.id}`, { expectedRevision: 0 }, {
    'x-tenant-id': tenantId,
    'idempotency-key': `remove-${created.json.id}`,
  })
  assert.equal(removed.status, 200)

  const retry = await callFresh('POST', '/agents', { ...body, label: 'Do not resurrect' }, headers)
  assert.equal(retry.status, 404)
  assert.equal(store.listAgents(tenantId).some((agent) => agent.id === created.json.id), false)
})

test('GET /agent-tools serves the live catalog the explicit grant names', async () => {
  const res = await call('GET', '/agent-tools')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.tools, TOOL_NAMES)
  assert.deepEqual(res.json.entries, TOOL_CATALOG)
  assert.ok(res.json.tools.length > 0)
  assert.ok(res.json.entries.every((entry: { name?: string; description?: string }) => entry.name && entry.description))
})

test('POST refuses missing bindings — the API never resolves to a default (400)', async () => {
  // No systemPromptId: refused loudly, NOT silently defaulted (the strict-API rule —
  // a missing binding is a caller bug surfaced now, not a surprising resolution later).
  const noPrompt = await call('POST', '/agents', { label: 'Bare agent', providerId: DEFAULT_PROVIDER_ID })
  assert.equal(noPrompt.status, 400)
  // No providerId: same refusal.
  const noProvider = await call('POST', '/agents', { label: 'Bare agent', systemPromptId: 'sp-concise-reviewer' })
  assert.equal(noProvider.status, 400)
  // Empty strings are the same as missing — there is no ""-means-default.
  const empty = await call('POST', '/agents', { label: 'Bare agent', providerId: '', systemPromptId: '' })
  assert.equal(empty.status, 400)
})

test('PATCH edits fields; a present-but-empty binding is refused, never "cleared to default"', async () => {
  const created = await call('POST', '/agents', {
    label: 'Editable',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  const id = created.json.id

  const patched = await call('PATCH', `/agents/${id}`, { label: 'Edited', instructions: 'Be brief.' })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Edited')
  assert.equal(patched.json.instructions, 'Be brief.')
  assert.equal(patched.json.revision, 1)
  // Untouched bindings survive the patch.
  assert.equal(patched.json.systemPromptId, 'sp-concise-reviewer')
  assert.equal(patched.json.providerId, DEFAULT_PROVIDER_ID)

  // '' used to mean "clear to default" — now it's a 400 and the binding is untouched.
  const cleared = await call('PATCH', `/agents/${id}`, { systemPromptId: '' })
  assert.equal(cleared.status, 400)
  const after = await call('GET', `/agents/${id}`)
  assert.equal(after.json.systemPromptId, 'sp-concise-reviewer')

  // Re-pointing to another registered prompt still works and re-resolves the body.
  const repointed = await call('PATCH', `/agents/${id}`, { systemPromptId: 'sp-open-generalist' })
  assert.equal(repointed.status, 200)
  assert.equal(repointed.json.systemPromptId, 'sp-open-generalist')
  assert.equal(repointed.json.systemPrompt, store.getSystemPrompt('sp-open-generalist')!.body)
  assert.equal(repointed.json.revision, 2)
})

test('PATCH compare-and-swap refuses stale Agent configuration and replays one logical acknowledgement', async () => {
  const created = await call('POST', '/agents', {
    label: 'Revisioned agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  const id = created.json.id
  const key = `agent-config-${id}`
  const first = await call(
    'PATCH',
    `/agents/${id}`,
    { instructions: 'Remote instruction', expectedRevision: 0 },
    { 'idempotency-key': key },
  )
  assert.equal(first.status, 200)
  assert.equal(first.json.revision, 1)

  const replay = await call(
    'PATCH',
    `/agents/${id}`,
    { instructions: 'Remote instruction', expectedRevision: 0 },
    { 'idempotency-key': key },
  )
  assert.equal(replay.status, 200)
  assert.equal(replay.json.revision, 1, 'a lost acknowledgement cannot advance twice')

  const stale = await call('PATCH', `/agents/${id}`, { label: 'Stale name', expectedRevision: 0 })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'conflict')
  const current = await call('GET', `/agents/${id}`)
  assert.equal(current.json.label, 'Revisioned agent', 'the stale patch changes no field')
  assert.equal(current.json.instructions, 'Remote instruction')
  assert.equal(current.json.revision, 1)

  for (const expectedRevision of [-1, 1.25, '1']) {
    const malformed = await call('PATCH', `/agents/${id}`, { label: 'No', expectedRevision })
    assert.equal(malformed.status, 400)
  }
})

test('POST validates named ids and required fields', async () => {
  const noLabel = await call('POST', '/agents', {
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal(noLabel.status, 400)

  // A NAMED-but-unknown reference is a 404 (distinct from missing, a 400).
  const badProvider = await call('POST', '/agents', {
    label: 'x',
    providerId: 'no-such-provider',
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal(badProvider.status, 404)

  const badPrompt = await call('POST', '/agents', {
    label: 'x',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'no-such-prompt',
  })
  assert.equal(badPrompt.status, 404)
})

test('POST rejects an authority over its provider (the D8 funnel, on the wire)', async () => {
  // A provider that grants only the Linear connector.
  const provider = store.createProvider({
    label: 'Linear-only',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    authority: { connectors: ['linear'] },
  })
  // An Agent reaching for Figma too exceeds that grant — a 400.
  const over = await call('POST', '/agents', {
    label: 'Greedy agent',
    providerId: provider.id,
    systemPromptId: 'sp-concise-reviewer',
    authority: { connectors: ['linear', 'figma'] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('DELETE pins reviewed Agent truth, batches its cascades, and replays one success', async () => {
  const created = await call('POST', '/agents', {
    label: 'Disposable agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  const id = created.json.id as string
  const projectId = 'p-insights'
  const delegation = store.createDelegation(projectId, {
    agentId: id,
    actKind: 'approve-envelope',
    policy: 'Approve bounded read-only work.',
    mode: 'draft',
  }, store.defaultTenantId())
  assert.ok(delegation && typeof delegation === 'object')
  const changed = await call('PATCH', `/agents/${id}`, {
    instructions: 'A concurrent definition change.',
    expectedRevision: 0,
  })
  assert.equal(changed.status, 200)
  assert.equal(changed.json.revision, 1)

  for (const body of [{ expectedRevision: -1 }, { expectedRevision: 0, label: 'No' }]) {
    const invalid = await call('DELETE', `/agents/${id}`, body)
    assert.equal(invalid.status, 400, JSON.stringify(body))
  }

  const key = `agent-delete-${id}`
  const headers = { 'idempotency-key': key }
  const stale = await call('DELETE', `/agents/${id}`, { expectedRevision: 0 }, headers)
  assert.equal(stale.status, 409)
  assert.equal(store.listAgents().some((agent) => agent.id === id), true)
  assert.equal(store.listDelegations(projectId).some((row) => row.agentId === id), true,
    'stale consent preserves the entire cascade')

  const observed: Array<{ agentPresent: boolean; delegationPresent: boolean }> = []
  const unsubscribe = store.subscribe((event) => {
    if (
      (event.type === 'agent.changed' && event.agentId === id) ||
      (event.type === 'delegation.changed' && event.projectId === projectId)
    ) {
      observed.push({
        agentPresent: store.listAgents().some((agent) => agent.id === id),
        delegationPresent: store.listDelegations(projectId).some((row) => row.agentId === id),
      })
    }
  })
  const del = await call('DELETE', `/agents/${id}`, { expectedRevision: 1 }, headers)
  unsubscribe()
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })
  assert.ok(observed.length >= 2)
  assert.ok(observed.every((snapshot) => !snapshot.agentPresent && !snapshot.delegationPresent),
    'events publish only after the compound removal is coherent')

  const replay = await call('DELETE', `/agents/${id}`, { expectedRevision: 999 }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.headers['idempotency-replayed'], 'true')

  const again = await call('DELETE', `/agents/${id}`)
  assert.equal(again.status, 404)

  const protectedDel = await call('DELETE', `/agents/${DEFAULT_AGENT.id}`)
  assert.equal(protectedDel.status, 409)
  assert.equal(protectedDel.json.error.code, 'conflict')

  const legacy = await call('POST', '/agents', {
    label: 'Legacy-delete agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal((await call('DELETE', `/agents/${legacy.json.id}`)).status, 200,
    'an omitted precondition keeps legacy unconditional removal')
})

test('DELETE refuses an agent a Commission still assigns (409)', async () => {
  const created = await call('POST', '/agents', {
    label: 'Commissioned agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  store.createCommission({ role: 'writer', agentId: created.json.id, projectId: 'p-insights' })
  const blocked = await call('DELETE', `/agents/${created.json.id}`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error.code, 'conflict')
})
