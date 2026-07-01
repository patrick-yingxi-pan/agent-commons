/** Tenant-scoped projects via the relation graph (F2 / PD9 — identity slice 3a).
 *  Created projects live in `graph.extraProjects`; the shared reducer is tenant-agnostic,
 *  so the server stamps the creator's tenant on apply and `relationGraph(tenantId)`
 *  PROJECTS the graph to that tenant. Every seed project is the default tenant's, so the
 *  DEFAULT reader gets the full graph unchanged (backward-compatible); only a non-default
 *  tenant is filtered. The broadcast is gated on the acting tenant, and an op targeting a
 *  project the caller doesn't own is refused (opTargetsForeignProject).
 *
 *  Order matters: the backward-compat identity test runs FIRST, while the store still
 *  holds only default-tenant content; the isolation tests then introduce non-default
 *  projects. The header-driven route boundary is proven in tests/capability-remote.test.ts. */
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

test('the default-tenant projection is the identity (full graph unchanged — backward-compatible)', () => {
  // Runs first: the store holds only seed + this default-tenant project, all default.
  store.applyRelationOp(mkCreate('proj-def', 'Default one', 'sess-def')) // no tenant ⇒ default
  const full = store.relationGraph()
  const def = store.relationGraph('tenant-personal') // the mock backend's default tenant
  assert.deepEqual(def, full, 'the default projection equals the full graph')
  assert.ok(def.extraProjects.some((p) => p.id === 'proj-def'), 'a default-created project is visible to the default reader')
  assert.equal(def.sessionProject['sess-def'], 'proj-def', 'its session→project join too')
})

test('a created project is stamped with the caller tenant; relationGraph projects to it', () => {
  store.applyRelationOp(mkCreate('proj-a', 'Alpha', 'sess-a'), 'tenant-pa')
  store.applyRelationOp(mkCreate('proj-b', 'Beta', 'sess-b'), 'tenant-pb')

  const full = store.relationGraph()
  assert.equal(full.extraProjects.find((p) => p.id === 'proj-a').tenantId, 'tenant-pa', 'stamped with the caller tenant')

  const a = store.relationGraph('tenant-pa')
  assert.ok(a.extraProjects.some((p) => p.id === 'proj-a'), 'sees its own project')
  assert.ok(!a.extraProjects.some((p) => p.id === 'proj-b'), 'not the other tenant’s project')
  assert.equal(a.sessionProject['sess-a'], 'proj-a', 'its session→project join is present')
  assert.ok(!('sess-b' in a.sessionProject), 'the other tenant’s join is projected out')
  // The default reader (now that non-default projects exist) does NOT see them.
  const def = store.relationGraph('tenant-personal')
  assert.ok(!def.extraProjects.some((p) => p.id === 'proj-a' || p.id === 'proj-b'), 'default reader excludes non-default projects')
})

test('relation.applied is gated on the ACTING tenant, incl. null-projectId unfile/unlink ops', () => {
  // A create-project event stamped tenant-pa: visible to it, not another.
  const created = { type: 'relation.applied', op: mkCreate('proj-a', 'Alpha'), by: 'user', tenantId: 'tenant-pa' }
  assert.equal(store.eventVisibleToTenant(created, 'tenant-pa'), true)
  assert.equal(store.eventVisibleToTenant(created, 'tenant-pb'), false)

  // The review's HIGH: an UNFILE (projectId:null) still carries the project NAME. Gating on
  // the stamped tenant (not the op) keeps it from leaking to a foreign tenant.
  const unfile = {
    type: 'relation.applied',
    op: { kind: 'file-session', sessionId: 'sess-a', sessionTitle: 'S', projectId: null, projectName: 'AcmeSecretProject' },
    by: 'user',
    tenantId: 'tenant-pa',
  }
  assert.equal(store.eventVisibleToTenant(unfile, 'tenant-pa'), true, 'the acting tenant sees its own unfile')
  assert.equal(store.eventVisibleToTenant(unfile, 'tenant-pb'), false, 'a foreign tenant does NOT — the project name is not leaked')

  // An unstamped event (e.g. a legacy/standing emit) defaults to the default tenant.
  const unstamped = { type: 'relation.applied', op: mkCreate('x', 'X'), by: 'standing' }
  assert.equal(store.eventVisibleToTenant(unstamped, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(unstamped, 'tenant-pb'), false)
})

test('opDeniedForTenant refuses foreign-project targets, colliding create-project, and foreign-session subjects', () => {
  // proj-a is tenant-pa's (created above). A tenant-pb caller can't file into it.
  const fileIntoA = { kind: 'file-session', sessionId: 's', sessionTitle: 'S', projectId: 'proj-a', projectName: 'Alpha' }
  assert.equal(store.opDeniedForTenant(fileIntoA, 'tenant-pb'), true, 'foreign destination ⇒ refused')
  assert.equal(store.opDeniedForTenant(fileIntoA, 'tenant-pa'), false, 'the owner may target it')

  // A create-project COLLIDING with a foreign id is refused (NOT exempt) — the reducer's
  // re-file path would otherwise inject the caller's session into the victim's project.
  const collide = { kind: 'create-project', projectId: 'proj-a', projectName: 'x', projectDescription: '', sessionId: 'sx', sessionTitle: 'S' }
  assert.equal(store.opDeniedForTenant(collide, 'tenant-pb'), true, 'colliding foreign create-project ⇒ refused')
  // A create-project with a genuinely NEW id is allowed (resolves to no existing project).
  assert.equal(store.opDeniedForTenant(mkCreate('proj-fresh', 'Fresh'), 'tenant-pb'), false, 'a brand-new id is allowed')

  // Subject check: a tenant can't unfile (projectId:null) another tenant's SESSION.
  const owned = store.createSession('pa owned session', 'tenant-pa')
  const unfileForeign = { kind: 'file-session', sessionId: owned.id, sessionTitle: 'S', projectId: null, projectName: 'x' }
  assert.equal(store.opDeniedForTenant(unfileForeign, 'tenant-pb'), true, 'unfiling a foreign session ⇒ refused')
  assert.equal(store.opDeniedForTenant(unfileForeign, 'tenant-pa'), false, 'the session owner may unfile it')
})
