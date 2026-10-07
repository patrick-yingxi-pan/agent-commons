import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { docBlockId } from '../documentIdentity.ts'

const SEED_ID = 'a1'
const SEED_NAME = 'insights-onepager.md'

function save(tenant: string, name: string, body?: string) {
  const graph = store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Document', ...(body === undefined ? {} : { body }) },
    sessionTitle: `Body projection ${name}`,
  }, tenant)
  const row = graph.extraArtifacts.find((artifact) => artifact.name === name)
  assert.ok(row, 'the authored artifact exists')
  return row
}

test('unrelated and missing tenant scopes never receive the fixture library', () => {
  assert.deepEqual(store.artifactContent('tenant-no-artifact-authority'), {})
  // Defensive runtime admission even if an untyped caller violates the signature.
  assert.deepEqual(store.artifactContent(undefined as never), {})
  assert.deepEqual(store.artifactContent(''), {})
})

test('seed body is projected by exact id to the flagship owner and remains editable', () => {
  const owner = store.defaultTenantId()
  const body = store.artifactContent(owner)[SEED_ID]
  assert.equal(body?.type, 'doc')
  assert.equal(body?.type === 'doc' ? body.blocks[0]?.id : undefined, docBlockId(SEED_ID, 0, 0),
    'seed reads expose deterministic IDs through the same exact-id projection as authored Documents')
  assert.equal(store.artifactBlockText(SEED_ID, 0), body?.type === 'doc' ? body.blocks[0]?.h : undefined)

  const before = store.artifactBlockText(SEED_ID, 0)
  assert.ok(before)
  try {
    assert.ok(store.updateArtifactBlock(SEED_ID, 0, 'Seed identity edit.'))
    assert.equal(store.artifactContent(owner)[SEED_ID]?.type, 'doc')
    assert.equal(store.artifactBlockText(SEED_ID, 0), 'Seed identity edit.')
  } finally {
    const revision = store.artifactContent(owner)[SEED_ID]?.revision ?? 0
    store.updateArtifactBlock(SEED_ID, 0, before, revision)
  }
})

test('a metadata-only authored row sharing a seed filename never borrows the seed body', () => {
  const tenant = `tenant-artifact-body-${Date.now().toString(36)}`
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: SEED_NAME, kind: 'doc', meta: 'Metadata only' },
  }, tenant)
  const authored = store.relationGraph(tenant).extraArtifacts.find(
    (artifact) => artifact.name === SEED_NAME && artifact.tenantId === tenant,
  )
  assert.ok(authored, 'metadata-only authored row exists')
  assert.equal(store.artifactContent(tenant)[authored.id], undefined, 'no exact body exists for metadata-only row')
  assert.equal(store.artifactContent(tenant)[SEED_NAME], undefined, 'its name cannot borrow the fixture either')
  assert.equal(store.artifactBlockText(authored.id, 0), undefined, 'patch lookup cannot borrow a seed body by name')
  assert.equal(store.openSocialProposal({
    subject: { kind: 'artifact', id: authored.id },
    delta: { kind: 'artifact-patch', block: 0, text: 'Must not borrow the seed.' },
    rationale: 'There is no authored body to patch.',
  }, tenant), 'invalid', 'a metadata-only row cannot offer a patch against a borrowed seed body')
})

test('foreign tenants receive no seed body by id or name until an artifact grant widens read access', () => {
  const owner = store.defaultTenantId()
  const foreign = 'tenant-beta'
  assert.equal(store.artifactContent(foreign)[SEED_ID], undefined)
  assert.equal(store.artifactContent(foreign)[SEED_NAME], undefined)

  const grant = store.createGrant(
    { subject: { kind: 'artifact', id: SEED_ID }, audience: { kind: 'org', orgId: foreign }, tier: 'view' },
    owner,
  )
  assert.ok(grant, 'owner can grant the seeded artifact')
  assert.ok(store.artifactContent(foreign)[SEED_ID], 'grant projects the exact seeded body id')
  assert.deepEqual(store.artifactContent(foreign)[SEED_NAME], store.artifactContent(foreign)[SEED_ID])
  assert.equal(store.revokeGrant(grant!.id, owner), 'ok')
  assert.equal(store.artifactContent(foreign)[SEED_ID], undefined)
  assert.equal(store.artifactContent(foreign)[SEED_NAME], undefined)
})

test('seeded session artifact ids project bodies only to session-readable tenants', () => {
  const sessionId = 'homepage-rewrite'
  const session = store.getSession(sessionId)
  assert.ok(session, 'seeded session exists')
  const owner = session.tenantId ?? store.defaultTenantId()
  const foreign = 'tenant-beta'
  const sessionArtifactId = 'hr1'
  const sessionArtifactName = 'homepage-copy.md'

  assert.ok(store.sessionVisibleToTenant(session, owner))
  assert.equal(store.artifactContent(owner)[sessionArtifactId]?.type, 'doc')
  assert.equal(store.artifactContent(foreign)[sessionArtifactId], undefined)
  assert.equal(store.artifactContent(foreign)[sessionArtifactName], undefined)

  const grant = store.createGrant(
    { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: foreign }, tier: 'view' },
    owner,
  )
  assert.ok(grant, 'the session owner can widen the session read wall')
  try {
    assert.equal(store.artifactContent(foreign)[sessionArtifactId]?.type, 'doc')
    assert.deepEqual(store.artifactContent(foreign)[sessionArtifactName], store.artifactContent(foreign)[sessionArtifactId])
  } finally {
    assert.equal(store.revokeGrant(grant!.id, owner), 'ok')
  }
  assert.equal(store.artifactContent(foreign)[sessionArtifactId], undefined, 'revoking the session removes its exact body alias')
  assert.equal(store.artifactContent(foreign)[sessionArtifactName], undefined, 'revocation also removes the name alias')
})

test('an unknown authored artifact id cannot borrow a seeded session body by name', () => {
  const tenant = `tenant-session-body-${Date.now().toString(36)}`
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: 'homepage-copy.md', kind: 'doc', meta: 'Metadata only' },
  }, tenant)
  const authored = store.relationGraph(tenant).extraArtifacts.find(
    (artifact) => artifact.name === 'homepage-copy.md' && artifact.tenantId === tenant,
  )
  assert.ok(authored, 'metadata-only authored row exists')
  assert.equal(store.artifactContent(tenant)[authored.id], undefined)
  assert.equal(store.artifactBlockText(authored.id, 0), undefined)
})

test('compatibility names cannot replace exact ids, including ids without bodies', () => {
  const tenant = 'tenant-artifact-alias-identity'
  const original = save(tenant, 'original.md', 'Original body.')
  const metadata = save(tenant, 'metadata.md')
  const collision = save(tenant, original.id, 'Must not replace the original.')
  const metadataCollision = save(tenant, metadata.id, 'Must not fill a bodyless id.')
  const library = store.artifactContent(tenant)
  assert.deepEqual(library[original.id], library[original.name])
  assert.notDeepEqual(library[original.id], library[collision.id])
  assert.equal(library[metadata.id], undefined)
  assert.ok(library[metadataCollision.id], 'the collision body remains readable by its own exact id')
})

test('ambiguous names across canonical and session artifacts have no compatibility alias', () => {
  const session = store.getSession('homepage-rewrite')
  assert.ok(session)
  const owner = session.tenantId ?? store.defaultTenantId()
  const original = store.artifactContent(owner)['hr1']
  assert.ok(original)
  const collision = save(owner, 'homepage-copy.md', 'A separately saved document.')
  const library = store.artifactContent(owner)
  assert.deepEqual(library['hr1'], original)
  assert.notDeepEqual(library[collision.id], original)
  assert.equal(library['homepage-copy.md'], undefined, 'a name shared across both registries is ambiguous')
})

test('renaming a seeded artifact withdraws the old alias without changing its body identity', () => {
  const owner = store.defaultTenantId()
  const original = store.artifactContent(owner)[SEED_ID]
  const row = store.listArtifacts(owner).find((artifact) => artifact.id === SEED_ID)
  assert.ok(row)
  const renamed = store.renameArtifact(SEED_ID, 'renamed-insights.md', row.metadataRevision ?? 0, owner)
  assert.ok(renamed)
  try {
    const library = store.artifactContent(owner)
    assert.deepEqual(library[SEED_ID], original)
    assert.deepEqual(library['renamed-insights.md'], original)
    assert.equal(library[SEED_NAME], undefined)
  } finally {
    store.renameArtifact(SEED_ID, row.name, renamed.metadataRevision ?? 0, owner)
  }
})
