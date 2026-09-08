/** Tenant-scoped artifacts via the relation graph (F2 / PD9 — identity slice 3b).
 *  The same structural pattern proven for projects (slice 3a): the shared reducer stays
 *  tenant-agnostic, the server stamps the creator's tenant on `save-artifact`, and
 *  `relationGraph(tenantId)` projects the ARTIFACT axis (extraArtifacts + the artifact-keyed
 *  joins) via one `artifactTenant` predicate shared by the write guard (opDeniedForTenant)
 *  and the read projection — so they cannot disagree. Seed artifacts are the default
 *  tenant's, so the default reader gets the full graph unchanged (backward-compatible). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'

const mkSave = (name, projectId) => ({
  kind: 'save-artifact',
  artifact: { name, kind: 'doc', meta: '1 page', excerpt: 'x' },
  ...(projectId ? { projectId } : {}),
})

const mkAuthoredSave = (name, body, projectId) => ({
  kind: 'save-artifact',
  artifact: { name, kind: 'doc', meta: 'Document', body },
  ...(projectId ? { projectId } : {}),
})

test('canonical artifact listing includes authored rows, seeded rows, and current project filing', () => {
  const stamp = Date.now().toString(36)
  const name = `listed-${stamp}.md`
  const tenant = store.defaultTenantId()
  store.applyRelationOp(mkAuthoredSave(name, 'A real authored body.', 'p-insights'), tenant)

  const created = store.relationGraph(tenant).extraArtifacts.find((artifact) => artifact.name === name)
  assert.ok(created, 'the strict authored save created an artifact row')
  const listed = store.listArtifacts(tenant)
  assert.ok(listed.some((artifact) => artifact.id === 'a1'), 'the seeded catalog remains listed')
  const row = listed.find((artifact) => artifact.id === created.id)
  assert.ok(row, 'the canonical artifact list includes the authored row')
  assert.equal(row?.own, true)
  assert.equal(row?.projectId, 'p-insights', 'the authored row retains its project filing')

  store.applyRelationOp({
    kind: 'refile-artifact', artifactId: created.id, artifactName: created.name,
    projectId: 'p-infra', projectName: 'Platform hardening',
  }, tenant)
  assert.equal(store.listArtifacts(tenant).find((artifact) => artifact.id === created.id)?.projectId, 'p-infra')
  store.applyRelationOp({
    kind: 'refile-artifact', artifactId: created.id, artifactName: created.name,
    projectId: null, projectName: 'Platform hardening',
  }, tenant)
  assert.equal(store.listArtifacts(tenant).find((artifact) => artifact.id === created.id)?.projectId, '', 'explicit unfile survives as the canonical empty sentinel')
})

test('canonical artifact listing keeps same-name authored IDs tenant-scoped and excludes foreign rows', () => {
  const stamp = Date.now().toString(36)
  const name = `same-listed-${stamp}.md`
  const firstTenant = `tenant-list-a-${stamp}`
  const secondTenant = `tenant-list-b-${stamp}`
  store.applyRelationOp(mkAuthoredSave(name, 'First tenant body.'), firstTenant)
  store.applyRelationOp(mkAuthoredSave(name, 'Second tenant body.'), secondTenant)

  const first = store.relationGraph(firstTenant).extraArtifacts.find((artifact) => artifact.name === name)
  const second = store.relationGraph(secondTenant).extraArtifacts.find((artifact) => artifact.name === name)
  assert.ok(first && second, 'both strict authored saves created rows')
  assert.notEqual(first.id, second.id, 'same names remain independent identities')
  assert.deepEqual(store.listArtifacts(firstTenant).filter((artifact) => artifact.name === name).map((artifact) => artifact.id), [first.id])
  assert.deepEqual(store.listArtifacts(secondTenant).filter((artifact) => artifact.name === name).map((artifact) => artifact.id), [second.id])
})

test('a granted artifact appears in the canonical list as readable but not owned', () => {
  const stamp = Date.now().toString(36)
  const owner = `tenant-list-owner-${stamp}`
  const secondOwner = `tenant-list-owner-two-${stamp}`
  // Directed grants resolve their audience through the account registry; use a
  // real demo namespace while keeping the artifact owners synthetic and isolated.
  const audience = 'tenant-beta'
  const name = `granted-listed-${stamp}.md`
  store.applyRelationOp(mkAuthoredSave(name, 'A shared authored body.'), owner)
  store.applyRelationOp(mkAuthoredSave(name, 'A second shared authored body.'), secondOwner)
  const created = store.relationGraph(owner).extraArtifacts.find((artifact) => artifact.name === name)
  const second = store.relationGraph(secondOwner).extraArtifacts.find((artifact) => artifact.name === name)
  assert.ok(created && second)
  const grant = store.createGrant(
    { subject: { kind: 'artifact', id: created.id }, audience: { kind: 'org', orgId: audience }, tier: 'view' },
    owner,
  )
  const secondGrant = store.createGrant(
    { subject: { kind: 'artifact', id: second.id }, audience: { kind: 'org', orgId: audience }, tier: 'view' },
    secondOwner,
  )
  assert.ok(grant && secondGrant)
  const rows = store.listArtifacts(audience).filter((artifact) => artifact.name === name)
  assert.deepEqual(rows.map((artifact) => artifact.id).sort(), [created.id, second.id].sort(), 'both same-name grants remain independently addressable')
  assert.ok(rows.every((artifact) => artifact.own === false), 'grants never widen ownership')
  assert.equal(store.listArtifacts(owner).find((artifact) => artifact.id === created.id)?.tenantId, owner, 'the owner retains its tenant stamp')
  assert.equal(rows.find((artifact) => artifact.id === created.id)?.tenantId, undefined, 'a grant-only row does not expose the owner tenant stamp')
  assert.ok(store.artifactContent(audience)[created.id], 'the granted body is visible before revocation')
  assert.equal(store.revokeGrant(grant.id, owner), 'ok')
  assert.equal(store.listArtifacts(audience).some((artifact) => artifact.id === created.id), false, 'revoked access disappears')
  assert.equal(store.artifactContent(audience)[created.id], undefined, 'revocation removes the authored body projection too')
  assert.equal(store.listArtifacts(audience).some((artifact) => artifact.id === second.id), true)
  assert.equal(store.revokeGrant(secondGrant.id, secondOwner), 'ok')
  assert.equal(store.listArtifacts(audience).some((artifact) => artifact.id === second.id), false, 'the second revoked access disappears')
  assert.equal(store.artifactContent(audience)[second.id], undefined, 'the second revoked body projection disappears too')
})

test('canonical artifact listing preserves stored synopsis while body edits stay separate', () => {
  const stamp = Date.now().toString(36)
  const tenant = `tenant-list-edit-${stamp}`
  const name = `edited-listed-${stamp}.md`
  const synopsis = 'Stored synopsis.'
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Document', body: 'Original excerpt.', excerpt: synopsis },
  }, tenant)
  const created = store.relationGraph(tenant).extraArtifacts.find((artifact) => artifact.name === name)
  assert.ok(created)
  const updated = store.updateArtifactBlock(created.id, 0, 'Current edited excerpt.')
  assert.ok(updated, 'the authored body accepted the edit')
  assert.equal(store.listArtifacts(tenant).find((artifact) => artifact.id === created.id)?.excerpt, synopsis, 'the stored synopsis remains metadata, separate from body edits')
  const body = store.artifactContent(tenant)[created.id]
  assert.equal(body?.type === 'doc' ? body.blocks[0]?.p : undefined, 'Current edited excerpt.')
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

test('same name + source remains independent across tenant namespaces', () => {
  const name = `same-name-${Date.now().toString(36)}.md`
  store.applyRelationOp(mkSave(name), 'tenant-same-a')
  store.applyRelationOp(mkSave(name), 'tenant-same-b')
  assert.equal(store.relationGraph('tenant-same-a').extraArtifacts.filter((a) => a.name === name).length, 1)
  assert.equal(store.relationGraph('tenant-same-b').extraArtifacts.filter((a) => a.name === name).length, 1)
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
