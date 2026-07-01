/** Tenant-scoped artifacts via the relation graph (F2 / PD9 — identity slice 3b).
 *  The same structural pattern proven for projects (slice 3a): the shared reducer stays
 *  tenant-agnostic, the server stamps the creator's tenant on `save-artifact`, and
 *  `relationGraph(tenantId)` projects the ARTIFACT axis (extraArtifacts + the artifact-keyed
 *  joins) via one `artifactTenant` predicate shared by the write guard (opDeniedForTenant)
 *  and the read projection — so they cannot disagree. Seed artifacts are the default
 *  tenant's, so the default reader gets the full graph unchanged (backward-compatible). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

const mkSave = (name, projectId) => ({
  kind: 'save-artifact',
  artifact: { name, kind: 'doc', meta: '1 page', excerpt: 'x' },
  ...(projectId ? { projectId } : {}),
})

test('a created artifact is stamped with the caller tenant; relationGraph projects the artifact axis', () => {
  store.applyRelationOp(mkSave('alpha.md'), 'tenant-aa')
  store.applyRelationOp(mkSave('beta.md'), 'tenant-bb')

  const full = store.relationGraph()
  const alpha = full.extraArtifacts.find((a) => a.name === 'alpha.md')
  assert.ok(alpha, 'the artifact was created')
  assert.equal(alpha.tenantId, 'tenant-aa', 'stamped with the caller tenant')

  const a = store.relationGraph('tenant-aa')
  assert.ok(a.extraArtifacts.some((x) => x.name === 'alpha.md'), 'sees its own artifact')
  assert.ok(!a.extraArtifacts.some((x) => x.name === 'beta.md'), 'not the other tenant’s artifact')
  const b = store.relationGraph('tenant-bb')
  assert.ok(b.extraArtifacts.some((x) => x.name === 'beta.md') && !b.extraArtifacts.some((x) => x.name === 'alpha.md'))
})

test('the default-tenant reader sees seed + default artifacts (backward-compatible)', () => {
  store.applyRelationOp(mkSave('default-art.md')) // no tenant ⇒ default
  const def = store.relationGraph('tenant-personal')
  assert.ok(def.extraArtifacts.some((x) => x.name === 'default-art.md'), 'default reader sees its default artifact')
  assert.ok(!def.extraArtifacts.some((x) => x.name === 'alpha.md'), 'not a non-default tenant’s artifact')
  // Seed artifacts (ALL_ARTIFACTS, no tenantId) remain visible to the default reader.
  const full = store.relationGraph()
  const seedIds = full.extraArtifacts.filter((a) => (a.tenantId ?? 'tenant-personal') === 'tenant-personal').map((a) => a.id)
  for (const id of seedIds) assert.ok(def.extraArtifacts.some((a) => a.id === id))
})

test('a non-default tenant unfiling its OWN filed artifact keeps the unfiled sentinel in its view', () => {
  // Regression: the artifactProject double-filter ran the '' unfiled sentinel through
  // projVisible(''), which is false for a non-default tenant → the row was dropped → the
  // client fell back to the artifact's original projectId and the unfile snapped back.
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-tt', projectName: 'PT', projectDescription: '' }, 'tenant-tt')
  store.applyRelationOp(mkSave('filed.md', 'p-tt'), 'tenant-tt')
  const filed = store.relationGraph('tenant-tt').extraArtifacts.find((a) => a.name === 'filed.md')
  assert.equal(store.relationGraph('tenant-tt').artifactProject[filed.id], 'p-tt', 'starts filed under its project')

  // Owner unfiles it (refile → projectId:null): the reducer writes artifactProject[id]=''.
  store.applyRelationOp({ kind: 'refile-artifact', artifactId: filed.id, artifactName: 'filed.md', projectId: null, projectName: 'x' }, 'tenant-tt')
  assert.equal(
    store.relationGraph('tenant-tt').artifactProject[filed.id],
    '',
    'the unfiled sentinel survives the projection (does not drop → no snap-back)',
  )
})

test('opDeniedForTenant refuses a foreign or ghost artifact subject', () => {
  const alpha = store.relationGraph().extraArtifacts.find((a) => a.name === 'alpha.md') // tenant-aa's
  const refile = { kind: 'refile-artifact', artifactId: alpha.id, artifactName: 'alpha.md', projectId: null, projectName: 'x' }
  assert.equal(store.opDeniedForTenant(refile, 'tenant-bb'), true, 'refiling a foreign artifact ⇒ refused')
  assert.equal(store.opDeniedForTenant(refile, 'tenant-aa'), false, 'the owner may refile it')

  // A ghost/empty artifactId buckets to the default tenant on read, so a non-default caller
  // keying an artifact-source row under it must be refused (same class as the project ghost).
  const ghostSource = { kind: 'set-artifact-source', artifactId: '', artifactName: 'x', contextLabel: 'omega-secret' }
  assert.equal(store.opDeniedForTenant(ghostSource, 'tenant-bb'), true, 'empty artifactId ⇒ refused for a non-default tenant')
  assert.equal(store.opDeniedForTenant(ghostSource, 'tenant-personal'), false, 'the default tenant owns the default namespace')
})
