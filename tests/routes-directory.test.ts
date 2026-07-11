/** D17 — the discovery directories (docs/agent-commons.md): read-only, cross-tenant
 *  listings of what owners made public. A directory never WIDENS visibility — a shared
 *  Project appears as its P8 public face (+ public aggregates), a published Agent as its
 *  D18 definition; a private/unpublished row never appears, and no capability field
 *  (authority / budget / provider binding) ever rides an entry. Search is a
 *  case-insensitive substring; ranking is deliberately absent. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-dir-A'
const B = 'tenant-dir-B'

function shareProject(id: string, name: string, tenant: string, description = ''): void {
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: name, projectDescription: description }, tenant)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: name, shared: true }, tenant)
}

test('a SHARED project appears in the directory cross-tenant; a PRIVATE one never does', async () => {
  shareProject('p-dir-shared', 'Field guide', A)
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-dir-private', projectName: 'Skunkworks', projectDescription: '' }, A)

  const forB = await call('GET', '/directory/projects', undefined, { 'x-tenant-id': B })
  assert.equal(forB.status, 200)
  const shared = forB.json.find((e: any) => e.id === 'p-dir-shared')
  assert.ok(shared, 'the shared project is discoverable by a foreign tenant')
  assert.equal(shared.own, false, 'and is marked not-own for the non-owner')
  assert.equal(shared.guarded, true, 'sharing made it a guarded (cooperable) resource')
  assert.ok(!forB.json.some((e: any) => e.id === 'p-dir-private'), 'a private project is NOT discoverable')

  // The owner sees its own shared row too, flagged own.
  const forA = await call('GET', '/directory/projects', undefined, { 'x-tenant-id': A })
  assert.equal(forA.json.find((e: any) => e.id === 'p-dir-shared')?.own, true)
})

test('a directory entry is the PUBLIC face — no owner-scoped fields ride it', async () => {
  store.applyRelationOp(
    { kind: 'create-project', projectId: 'p-dir-redact', projectName: 'Redacted', projectDescription: '', sessionId: 'sess-dir-secret', sessionTitle: 'secret' },
    A,
  )
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-dir-redact', projectName: 'Redacted', shared: true }, A)
  const { json } = await call('GET', '/directory/projects', undefined, { 'x-tenant-id': B })
  const entry = json.find((e: any) => e.id === 'p-dir-redact')
  assert.ok(entry, 'visible')
  // The entry type carries only public metadata — assert the owner-scoped fields a full
  // Project would leak are absent from the serialized row.
  for (const leak of ['sessionIds', 'contexts', 'instructions', 'scheduled', 'tenantId']) {
    assert.ok(!(leak in entry), `'${leak}' must not ride a directory entry`)
  }
})

test('the directory carries the collaboration aggregates (contributors, open work)', async () => {
  shareProject('p-dir-counts', 'Counted', A)
  const agent = store.createAgent({ label: 'Counter', systemPrompt: 'x', tools: [], instructions: '' }, A)
  store.createCommission({ role: 'writer', agentId: agent.id, projectId: 'p-dir-counts' }, A)
  store.postOpenSubGoal('p-dir-counts', { subGoal: 'dir-counts-item', type: 'charge', target: 'budget:demo' }, A)

  const { json } = await call('GET', '/directory/projects', undefined, { 'x-tenant-id': B })
  const entry = json.find((e: any) => e.id === 'p-dir-counts')
  assert.equal(entry.contributorCount, 1, 'one Contributor counted')
  // The commission above is NOT standing, so the posted item stays open and is counted.
  assert.equal(entry.openWorkCount, 1, 'one open work item counted')
})

test('?q= filters by name/description substring, case-insensitively', async () => {
  shareProject('p-dir-q1', 'Orchid atlas', A, 'a botanical index')
  shareProject('p-dir-q2', 'Metrics digest', A)
  const byName = await call('GET', '/directory/projects?q=ORCHID', undefined, { 'x-tenant-id': B })
  assert.ok(byName.json.some((e: any) => e.id === 'p-dir-q1'))
  assert.ok(!byName.json.some((e: any) => e.id === 'p-dir-q2'))
  const byDesc = await call('GET', '/directory/projects?q=botanical', undefined, { 'x-tenant-id': B })
  assert.ok(byDesc.json.some((e: any) => e.id === 'p-dir-q1'), 'description matches too')
})

test('a PUBLISHED agent appears in the agent directory cross-tenant as its DEFINITION only', async () => {
  const agent = store.createAgent(
    { label: 'Docs gardener', systemPrompt: 'tend the docs', tools: ['create_project'], instructions: 'be tidy' },
    A,
  )
  store.updateAgentFromRequest(agent.id, { published: true })

  const { json } = await call('GET', '/directory/agents', undefined, { 'x-tenant-id': B })
  const entry = json.find((e: any) => e.id === agent.id)
  assert.ok(entry, 'the published agent is discoverable by a foreign tenant')
  assert.equal(entry.systemPrompt, 'tend the docs', 'the definition (prompt) is public — that is the point of publishing')
  assert.deepEqual(entry.tools, ['create_project'])
  assert.equal(entry.own, false)
  // The D18 wall: capability never travels — no authority/budget/provider on the entry.
  for (const leak of ['authority', 'budget', 'providerId', 'tenantId']) {
    assert.ok(!(leak in entry), `'${leak}' must not ride an agent directory entry`)
  }
})

test('an UNPUBLISHED agent never appears; un-publishing removes it', async () => {
  const agent = store.createAgent({ label: 'Private worker', systemPrompt: 'x', tools: [], instructions: '' }, A)
  const before = await call('GET', '/directory/agents', undefined, { 'x-tenant-id': B })
  assert.ok(!before.json.some((e: any) => e.id === agent.id), 'unpublished ⇒ absent')

  store.updateAgentFromRequest(agent.id, { published: true })
  const during = await call('GET', '/directory/agents', undefined, { 'x-tenant-id': B })
  assert.ok(during.json.some((e: any) => e.id === agent.id), 'published ⇒ present')

  store.updateAgentFromRequest(agent.id, { published: false })
  const after = await call('GET', '/directory/agents', undefined, { 'x-tenant-id': B })
  assert.ok(!after.json.some((e: any) => e.id === agent.id), 'un-published ⇒ absent again')
})
