/** Tenant-scoped projects via the relation graph (F2 / PD9 — identity slice 3a).
 *  Created projects live in `graph.extraProjects`; the shared reducer is tenant-agnostic,
 *  so the server stamps the creator's tenant on apply and `relationGraph(tenantId)`
 *  PROJECTS the graph to that tenant — filtering extraProjects + the project-keyed joins.
 *  Every seed project is the default tenant's, so the DEFAULT reader gets the full graph
 *  unchanged (backward-compatible); only a non-default tenant gets a filtered view. The
 *  broadcast is scoped too (relation.applied for a project op → that project's tenant). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

const mkCreate = (id, name, sessionId) => ({
  kind: 'create-project',
  projectId: id,
  projectName: name,
  projectDescription: '',
  ...(sessionId ? { sessionId, sessionTitle: 'S' } : {}),
})

test('a created project is stamped with the caller tenant; relationGraph projects to it', () => {
  store.applyRelationOp(mkCreate('proj-a', 'Alpha', 'sess-a'), 'tenant-pa')
  store.applyRelationOp(mkCreate('proj-b', 'Beta', 'sess-b'), 'tenant-pb')

  // Full graph (no tenant arg) has both, and the created projects carry their tenant.
  const full = store.relationGraph()
  assert.ok(full.extraProjects.some((p) => p.id === 'proj-a') && full.extraProjects.some((p) => p.id === 'proj-b'))
  assert.equal(full.extraProjects.find((p) => p.id === 'proj-a').tenantId, 'tenant-pa', 'stamped with the caller tenant')

  // tenant-pa sees only its project + its own project-keyed joins.
  const a = store.relationGraph('tenant-pa')
  assert.ok(a.extraProjects.some((p) => p.id === 'proj-a'), 'sees its own project')
  assert.ok(!a.extraProjects.some((p) => p.id === 'proj-b'), 'does not see the other tenant’s project')
  assert.equal(a.sessionProject['sess-a'], 'proj-a', 'its session→project join is present')
  assert.ok(!('sess-b' in a.sessionProject), 'the other tenant’s join is projected out')

  const b = store.relationGraph('tenant-pb')
  assert.ok(b.extraProjects.some((p) => p.id === 'proj-b') && !b.extraProjects.some((p) => p.id === 'proj-a'))
  assert.ok(!('sess-a' in b.sessionProject))
})

test('the default-tenant reader sees the full graph (backward-compatible)', () => {
  const full = store.relationGraph()
  const def = store.relationGraph('tenant-personal') // the mock backend's default tenant

  // Every default-tenant (seed/legacy) project is visible to the default reader.
  const defaultProjectIds = full.extraProjects
    .filter((p) => (p.tenantId ?? 'tenant-personal') === 'tenant-personal')
    .map((p) => p.id)
  for (const id of defaultProjectIds) assert.ok(def.extraProjects.some((p) => p.id === id), `default reader keeps ${id}`)

  // …but a non-default tenant's created project is NOT in the default view.
  assert.ok(!def.extraProjects.some((p) => p.id === 'proj-a'), 'default reader does not see tenant-pa’s project')
})

test('relation.applied for a project op is visible only to that project’s tenant', () => {
  const projEvt = { type: 'relation.applied', op: mkCreate('proj-a', 'Alpha'), by: 'user' }
  assert.equal(store.eventVisibleToTenant(projEvt, 'tenant-pa'), true, 'the owning tenant sees the project event')
  assert.equal(store.eventVisibleToTenant(projEvt, 'tenant-pb'), false, 'another tenant does not')

  // A projectless relation op is global (not project-scoped).
  const globalEvt = { type: 'relation.applied', op: { kind: 'attach-context' }, by: 'user' }
  assert.equal(store.eventVisibleToTenant(globalEvt, 'tenant-pa'), true)
  assert.equal(store.eventVisibleToTenant(globalEvt, 'tenant-pb'), true)
})
