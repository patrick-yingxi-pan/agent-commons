/** D22 — global search (docs/agent-commons.md): one route, typed grouped hits across
 *  everything the CALLER can see, composed exclusively from the same per-tenant reads
 *  and redactions the pages use. The invariants under test: search never widens
 *  visibility (a foreign private row is absent; a foreign SHARED/PUBLISHED row is
 *  present via its public face); the private/commons split partitions (nothing appears
 *  twice); groups are capped with a true total; an empty query answers nothing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const A = 'tenant-srch-A'
const B = 'tenant-srch-B'
let n = 0

const search = async (q: string, tenant: string) =>
  (await call('GET', `/search?q=${encodeURIComponent(q)}`, undefined, { 'x-tenant-id': tenant })).json

const groupOf = (json: any, type: string) => json.groups.find((g: any) => g.type === type)

test('tenant walls: a foreign PRIVATE row is absent; the owner finds it', async () => {
  const needle = `wallmark-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: `p-srch-${n}`, projectName: `Project ${needle}`, projectDescription: '' }, A)
  store.createAgent({ label: `Agent ${needle}`, systemPrompt: 'x', tools: [], instructions: '' }, A)

  const mine = await search(needle, A)
  assert.ok(groupOf(mine, 'project')?.hits.some((h: any) => h.title.includes(needle)), 'the owner finds their project')
  assert.ok(groupOf(mine, 'agent')?.hits.some((h: any) => h.title.includes(needle)), 'the owner finds their agent')

  const theirs = await search(needle, B)
  assert.equal(theirs.groups.length, 0, 'a foreign tenant sees NOTHING of private rows')
})

test('the commons is findable: shared project, published agent (ref = owner), owner, open work', async () => {
  const needle = `commons-${(n += 1)}`
  const projectId = `p-srch-${n}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Shared ${needle}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Shared ${needle}`, shared: true }, A)
  const agent = store.createAgent({ label: `Published ${needle}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `todo-${needle}`, type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': A },
  )

  const found = await search(needle, B)
  const shared = groupOf(found, 'sharedProject')
  assert.ok(shared?.hits.some((h: any) => h.id === projectId), 'a foreign shared project surfaces via its directory face')
  const pub = groupOf(found, 'publishedAgent')
  const pubHit = pub?.hits.find((h: any) => h.id === agent.id)
  assert.ok(pubHit, 'a foreign published agent surfaces via its directory face')
  assert.equal(pubHit.ref, A, 'ref carries the owner name — the door to its public face (the profile)')
  const work = groupOf(found, 'openWork')
  const workHit = work?.hits.find((h: any) => h.title === `todo-${needle}`)
  assert.ok(workHit, 'open work on a shared project is findable')
  assert.equal(workHit.ref, projectId, 'ref carries the projectId — the door to the backlog')

  // Owners are entities: the workspace name itself matches (D21 profiles are findable).
  const owners = await search(A, B)
  assert.ok(groupOf(owners, 'owner')?.hits.some((h: any) => h.id === A), 'a workspace with a public face is findable by name')
})

test('the private/commons split partitions: an own shared project is "yours", a foreign one is commons — never both', async () => {
  const needle = `partition-${(n += 1)}`
  const projectId = `p-srch-${n}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Both ${needle}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Both ${needle}`, shared: true }, A)

  const mine = await search(needle, A)
  assert.ok(groupOf(mine, 'project')?.hits.some((h: any) => h.id === projectId), 'the owner finds it under Your projects')
  assert.ok(!groupOf(mine, 'sharedProject')?.hits.some((h: any) => h.id === projectId), '…and NOT duplicated in the commons group')

  const theirs = await search(needle, B)
  assert.ok(groupOf(theirs, 'sharedProject')?.hits.some((h: any) => h.id === projectId), 'a visitor finds it in the commons group')
  assert.ok(!groupOf(theirs, 'project')?.hits.some((h: any) => h.id === projectId), '…and NOT under Your projects')
})

test('groups are capped with a true total; hits beyond the cap are counted, not silently dropped', async () => {
  const needle = `capfill-${(n += 1)}`
  for (let i = 0; i < 7; i += 1) {
    store.createAgent({ label: `Agent ${needle} ${i}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  }
  const found = await search(needle, A)
  const agents = groupOf(found, 'agent')
  assert.equal(agents.hits.length, 5, 'capped at SEARCH_GROUP_CAP')
  assert.equal(agents.total, 7, 'the total is honest')
})

test('an empty (or whitespace) query answers no groups', async () => {
  const empty = await call('GET', '/search?q=%20%20', undefined, { 'x-tenant-id': A })
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.groups, [])
  const missing = await call('GET', '/search', undefined, { 'x-tenant-id': A })
  assert.deepEqual(missing.json.groups, [])
})

test('registries and routines are findable through the same scoped reads their pages use', async () => {
  const needle = `registry-${(n += 1)}`
  store.createSystemPrompt({ label: `Prompt ${needle}`, body: 'be kind', targetFamily: 'claude' }, A)
  const found = await search(needle, A)
  assert.ok(groupOf(found, 'prompt')?.hits.some((h: any) => h.title.includes(needle)), 'a created prompt is findable by its owner')
  const foreign = await search(needle, B)
  assert.ok(!groupOf(foreign, 'prompt'), 'and invisible to a foreign tenant')
})
