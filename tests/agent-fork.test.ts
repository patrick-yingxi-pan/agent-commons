/** D18 — publishing and forking an Agent (docs/agent-commons.md): publishing shares the
 *  DEFINITION (label / prompt / tools / instructions), never the capability. Forking
 *  copies the definition into the caller's tenant with capability UNBOUND — authority and
 *  budget dropped, provider/prompt bindings surviving only when the forker can see them —
 *  lineage stamped, the source's fork counter incremented, and the track record reset
 *  (a fork is a recipe, not a reputation transplant). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-fork-A'
const B = 'tenant-fork-B'

test('publish is an explicit PATCH act on the wire; owner-only (foreign PATCH is 404)', async () => {
  const agent = store.createAgent({ label: 'Publishable', systemPrompt: 'x', tools: [], instructions: '' }, A)
  // A foreign tenant cannot publish (or otherwise edit) another tenant's agent — 404,
  // never 403 (existence-hiding, the denyForeignEntry wall).
  const foreign = await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': B })
  assert.equal(foreign.status, 404)

  const own = await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  assert.equal(own.status, 200)
  assert.equal(own.json.published, true)
})

test('fork copies the definition, UNBINDS capability, stamps lineage, credits the source', async () => {
  // A publishes an agent carrying a concrete authority + budget (capability that must
  // NOT travel) and a bespoke prompt.
  const source = store.createAgent(
    {
      label: 'Release scribe',
      systemPrompt: 'write the release notes',
      tools: ['create_project'],
      instructions: 'terse, factual',
      authority: { connectors: ['linear'] },
      budget: { windows: [{ label: '5-hour limit', ceiling: 500 }] },
    },
    A,
  )
  store.updateAgentFromRequest(source.id, { published: true })

  const res = await call('POST', `/agents/${source.id}/fork`, undefined, { 'x-tenant-id': B })
  assert.equal(res.status, 200)
  const fork = res.json
  // The definition traveled…
  assert.equal(fork.label, 'Release scribe')
  assert.equal(fork.systemPrompt, 'write the release notes')
  assert.deepEqual(fork.tools, ['create_project'])
  assert.equal(fork.instructions, 'terse, factual')
  // …the capability did not (D18: re-granted by the new owner through their own funnel)…
  assert.equal(fork.authority, undefined, 'authority never travels')
  assert.equal(fork.budget, undefined, 'budget never travels')
  // …the copy is B's, private, lineage-stamped, track record reset…
  assert.equal(fork.tenantId, B)
  assert.notEqual(fork.published, true, 'a fork starts private')
  assert.deepEqual(fork.forkedFrom, { agentId: source.id, label: 'Release scribe' })
  assert.ok(!fork.contributions, 'reputation does not transfer')
  // …and the source earned the public credit.
  assert.equal(store.getAgent(source.id).forks, 1, 'the source fork counter incremented')
  assert.ok(store.listAgents(B).some((a) => a.id === fork.id), 'the fork lives in B’s registry')
  assert.ok(!store.listAgents(A).some((a) => a.id === fork.id), 'and not in A’s')
})

test('a PRIVATE provider binding does not survive a cross-tenant fork; a SHARED one does', async () => {
  // A binds its agent to a provider PRIVATE to A.
  const provider = store.createProvider({ label: 'A-only', modelFamily: 'claude', effortLevels: ['Low'] }, {}, A)
  const source = store.createAgent(
    { label: 'Bound worker', systemPrompt: 'x', tools: [], instructions: '', providerId: provider.id },
    A,
  )
  store.updateAgentFromRequest(source.id, { published: true })

  const res = await call('POST', `/agents/${source.id}/fork`, undefined, { 'x-tenant-id': B })
  assert.equal(res.status, 200)
  assert.equal(res.json.providerId, undefined, 'a foreign PRIVATE provider binding is dropped (B re-binds its own)')

  // The same fork by the OWNER keeps the binding (the forker can see the provider).
  const own = await call('POST', `/agents/${source.id}/fork`, undefined, { 'x-tenant-id': A })
  assert.equal(own.json.providerId, provider.id, 'the owner’s fork keeps its visible provider binding')
})

test('fork walls: unknown id and a foreign UNPUBLISHED agent are 404; forking your OWN unpublished agent works', async () => {
  const missing = await call('POST', '/agents/no-such-agent/fork', undefined, { 'x-tenant-id': B })
  assert.equal(missing.status, 404)

  const secret = store.createAgent({ label: 'A secret', systemPrompt: 'x', tools: [], instructions: '' }, A)
  const foreign = await call('POST', `/agents/${secret.id}/fork`, undefined, { 'x-tenant-id': B })
  assert.equal(foreign.status, 404, 'a foreign unpublished agent is invisible to fork (no existence leak)')

  const own = await call('POST', `/agents/${secret.id}/fork`, undefined, { 'x-tenant-id': A })
  assert.equal(own.status, 200, 'your own agent forks freely (duplicate)')
  assert.deepEqual(own.json.forkedFrom, { agentId: secret.id, label: 'A secret' })
})
