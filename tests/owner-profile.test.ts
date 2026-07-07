/** D21 — the workspace profile (docs/agent-commons.md): a display name's ONE public
 *  face, aggregated from rows that are ALREADY public through the same redactions the
 *  D17 directories use. The invariants under test: the profile never widens visibility
 *  (private rows contribute nothing, and a name with no public rows 404s — existence-
 *  hiding extended to identities); content is viewer-independent except the
 *  viewer-relative `own` flags; activity counts only public acts (open work on SHARED
 *  projects), with `resolved` attributed through the commission's Agent owner. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-prof-A'
const B = 'tenant-prof-B'
let n = 0

/** A shared project owned by `tenant` with a published, standing-commissioned agent. */
function publicFace(tenant: string) {
  const id = `p-prof-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: `Prof ${n}`, projectDescription: 'public row' }, tenant)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: `Prof ${n}`, shared: true }, tenant)
  const agent = store.createAgent({ label: `Prof Agent ${n}`, systemPrompt: 'x', tools: [], instructions: '' }, tenant)
  const commission = store.createCommission({ agentId: agent.id, projectId: id, standing: true }, tenant)
  return { id, agent, commission }
}

test('the profile aggregates a name’s public rows: shared projects, published agents, stats', async () => {
  const { id, agent } = publicFace(A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })

  // tenantName falls back to the raw id for an unregistered dev-seam tenant — the
  // handle under test is the same public identity the directories expose.
  const { status, json } = await call('GET', `/directory/owners/${encodeURIComponent(A)}`, undefined, { 'x-tenant-id': B })
  assert.equal(status, 200)
  assert.equal(json.name, A)
  assert.equal(json.own, false, 'B is a visitor')
  assert.ok(json.projects.some((p: any) => p.id === id), 'the shared project rides its directory face')
  assert.ok(json.agents.some((a: any) => a.id === agent.id), 'the published agent rides its directory face')
  assert.equal(json.stats.sharedProjects, json.projects.length)
  assert.equal(json.stats.publishedAgents, json.agents.length)

  // The same page, viewer-relative: the owner sees own=true and nothing more.
  const mine = await call('GET', `/directory/owners/${encodeURIComponent(A)}`, undefined, { 'x-tenant-id': A })
  assert.equal(mine.json.own, true)
  assert.equal(mine.json.projects.length, json.projects.length, 'content is identical for owner and visitor')
  assert.equal(JSON.stringify(mine.json.stats), JSON.stringify(json.stats))
})

test('a malformed percent-sequence in the handle is declined, not a rejected request', async () => {
  // decodeURIComponent throws on `%`; the router's param decode runs BEFORE the
  // per-route try/catch, so an uncaught throw would reject handle() and hang the
  // socket (review finding — the owner handle is the first free-form :param a
  // client naturally constructs). The guard treats an undecodable path as a
  // non-match: handle() resolves without writing (status stays 0 at this layer —
  // the entry server's fall-through then 404s); before the guard this call
  // REJECTED with URIError.
  const outcome = await call('GET', '/directory/owners/%').then(
    (r) => ({ rejected: false, status: r.status }),
    () => ({ rejected: true, status: -1 }),
  )
  assert.equal(outcome.rejected, false, 'the router must decline, never throw')
  assert.equal(outcome.status, 0, 'nothing matched — the entry server 404s the fall-through')
})

test('no public rows ⇒ 404, indistinguishable from an unknown name (existence-hiding)', async () => {
  const ghostTenant = 'tenant-prof-ghost'
  // Private rows only: an unshared project and an unpublished agent build no face.
  store.applyRelationOp({ kind: 'create-project', projectId: `p-prof-priv-${(n += 1)}`, projectName: 'Private', projectDescription: '' }, ghostTenant)
  store.createAgent({ label: 'Private Agent', systemPrompt: 'x', tools: [], instructions: '' }, ghostTenant)

  const priv = await call('GET', `/directory/owners/${encodeURIComponent(ghostTenant)}`, undefined, { 'x-tenant-id': B })
  const ghost = await call('GET', '/directory/owners/no-such-workspace', undefined, { 'x-tenant-id': B })
  assert.equal(priv.status, 404)
  assert.equal(ghost.status, 404)
  assert.equal(priv.json.error.code, ghost.json.error.code, 'sharing nothing ≡ not existing')
})

test('activity records public acts only, attributed by name: posted by the poster, resolved by the agent owner', async () => {
  const { id, agent, commission } = publicFace(A)
  // B posts a work item on A's shared project; A's standing Contributor takes it
  // synchronously — one act, two attributions (B posted, A resolved).
  const posted = await call(
    'POST', `/projects/${id}/open-subgoals`,
    { subGoal: 'prof-activity-item', type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': B },
  )
  assert.equal(posted.status, 200)
  assert.equal(posted.json.status, 'done', 'the standing taker resolved it at post time')

  const poster = await call('GET', `/directory/owners/${encodeURIComponent(B)}`, undefined, { 'x-tenant-id': A })
  assert.equal(poster.status, 200, 'posting on a shared project is itself a public face')
  assert.equal(poster.json.stats.workPosted, 1)
  const postedAct = poster.json.activity.find((a: any) => a.subGoal === 'prof-activity-item')
  assert.equal(postedAct.kind, 'posted')
  assert.equal(postedAct.projectId, id)

  const resolver = await call('GET', `/directory/owners/${encodeURIComponent(A)}`, undefined, { 'x-tenant-id': B })
  assert.equal(resolver.json.stats.workResolved, 1, `attributed through commission ${commission.id}'s agent owner`)
  const resolvedAct = resolver.json.activity.find((a: any) => a.kind === 'resolved' && a.subGoal === 'prof-activity-item')
  assert.ok(resolvedAct, 'the resolution is a public act on A’s feed')
  assert.equal(resolvedAct.agentLabel, agent.label, 'the credit line names the acting agent')
})

test('an item on a PRIVATE project is not a public act — it never reaches any profile', async () => {
  const { agent } = publicFace(A) // gives A a public face so its profile serves
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  const privId = `p-prof-dark-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: privId, projectName: 'Dark', projectDescription: '' }, A)
  const before = (await call('GET', `/directory/owners/${encodeURIComponent(A)}`, undefined, { 'x-tenant-id': A })).json

  await call(
    'POST', `/projects/${privId}/open-subgoals`,
    { subGoal: 'prof-dark-item', type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': A },
  )
  const after = (await call('GET', `/directory/owners/${encodeURIComponent(A)}`, undefined, { 'x-tenant-id': A })).json
  assert.equal(after.stats.workPosted, before.stats.workPosted, 'private acts don’t count')
  assert.ok(!after.activity.some((a: any) => a.subGoal === 'prof-dark-item'), 'private acts don’t appear')
})
