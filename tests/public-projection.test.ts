/** The shared-surface UI model's wire half: the per-tenant projection stamps every
 *  created Project with its PUBLIC identity — `ownerName` (the workspace display
 *  name, the same face the D17 directory shows) and the viewer-relative `own` flag
 *  that drives the owner/visitor affordance split client-side. A FOREIGN shared row
 *  additionally drops the raw `tenantId`: the display name is the public face; a
 *  foreign tenant's raw id never crosses the boundary (mirroring the directory's
 *  posture, now on the projection too). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

const A = 'tenant-proj-A'
const B = 'tenant-proj-B'

test('the projection stamps ownerName + own on every created row', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-pub-id', projectName: 'Stamped', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-pub-id', projectName: 'Stamped', shared: true }, A)

  const forA = store.relationGraph(A).extraProjects.find((p) => p.id === 'p-pub-id')
  assert.ok(forA)
  assert.equal(forA.own, true, 'the owner’s view is stamped own')
  // tenantName falls back to the raw id for an unregistered dev-seam tenant — the point
  // under test is that the field exists and is the same public identity everywhere.
  assert.equal(forA.ownerName, A)

  const forB = store.relationGraph(B).extraProjects.find((p) => p.id === 'p-pub-id')
  assert.ok(forB, 'shared ⇒ visible to a foreign tenant')
  assert.equal(forB.own, false, 'the visitor’s view is stamped not-own — the affordance split key')
  assert.equal(forB.ownerName, A, 'the public identity rides the foreign view too')
})

test('a FOREIGN shared row drops the raw tenantId; the owner keeps its own', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-pub-tid', projectName: 'NoRawId', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-pub-tid', projectName: 'NoRawId', shared: true }, A)

  const forB = store.relationGraph(B).extraProjects.find((p) => p.id === 'p-pub-tid')
  assert.equal(forB?.tenantId, undefined, 'a foreign tenant’s raw id never crosses (JSON drops the undefined key)')
  const forA = store.relationGraph(A).extraProjects.find((p) => p.id === 'p-pub-tid')
  assert.equal(forA?.tenantId, A, 'the owner still sees its own stamp')
})

test('an unshared private row stays invisible — the stamps never widen visibility', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-pub-priv', projectName: 'Priv', projectDescription: '' }, A)
  assert.ok(!store.relationGraph(B).extraProjects.some((p) => p.id === 'p-pub-priv'))
})

test('a Project’s defaultRole rides the FOREIGN shared view — a visitor’s picker pre-selects the owner’s preference', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-pub-role', projectName: 'Role pref', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-pub-role', projectName: 'Role pref', shared: true }, A)
  store.applyRelationOp({ kind: 'set-project-default-role', projectId: 'p-pub-role', projectName: 'Role pref', role: 'reader' }, A)
  // A cross-tenant commissioner sees the preference (INV-9: it only PRE-SELECTS their
  // picker — their commission request still names its role explicitly)…
  assert.equal(store.relationGraph(B).extraProjects.find((p) => p.id === 'p-pub-role')?.defaultRole, 'reader')
  // …and a visitor cannot SET it (owner-only, like every other project-keyed op).
  assert.equal(
    store.opDeniedForTenant({ kind: 'set-project-default-role', projectId: 'p-pub-role', projectName: 'Role pref', role: 'owner' }, B),
    true,
    'a foreign tenant may not set another workspace’s default role',
  )
})
