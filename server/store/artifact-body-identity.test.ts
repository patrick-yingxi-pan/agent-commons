import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'

const SEED_ID = 'a1'
const SEED_NAME = 'insights-onepager.md'

test('seed body is projected by exact id to the flagship owner and remains editable', () => {
  const owner = store.defaultTenantId()
  const body = store.artifactContent(owner)[SEED_ID]
  assert.equal(body?.type, 'doc')
  assert.equal(store.artifactBlockText(SEED_ID, 0), body?.type === 'doc' ? body.blocks[0]?.h : undefined)

  const before = store.artifactBlockText(SEED_ID, 0)
  assert.ok(before)
  try {
    assert.ok(store.updateArtifactBlock(SEED_ID, 0, 'Seed identity edit.'))
    assert.equal(store.artifactContent(owner)[SEED_ID]?.type, 'doc')
    assert.equal(store.artifactBlockText(SEED_ID, 0), 'Seed identity edit.')
  } finally {
    store.updateArtifactBlock(SEED_ID, 0, before)
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
  assert.equal(store.artifactBlockText(authored.id, 0), undefined, 'patch lookup cannot borrow a seed body by name')
  assert.equal(store.openSocialProposal({
    subject: { kind: 'artifact', id: authored.id },
    delta: { kind: 'artifact-patch', block: 0, text: 'Must not borrow the seed.' },
    rationale: 'There is no authored body to patch.',
  }, tenant), 'invalid', 'a metadata-only row cannot offer a patch against a borrowed seed body')
})

test('foreign tenants receive no seed body by exact id until an artifact grant widens read access', () => {
  const owner = store.defaultTenantId()
  const foreign = 'tenant-beta'
  assert.equal(store.artifactContent(foreign)[SEED_ID], undefined)

  const grant = store.createGrant(
    { subject: { kind: 'artifact', id: SEED_ID }, audience: { kind: 'org', orgId: foreign }, tier: 'view' },
    owner,
  )
  assert.ok(grant, 'owner can grant the seeded artifact')
  assert.ok(store.artifactContent(foreign)[SEED_ID], 'grant projects the exact seeded body id')
  assert.equal(store.revokeGrant(grant!.id, owner), 'ok')
  assert.equal(store.artifactContent(foreign)[SEED_ID], undefined)
})

test('seeded session artifact ids project bodies only to session-readable tenants', () => {
  const sessionId = 'homepage-rewrite'
  const session = store.getSession(sessionId)
  assert.ok(session, 'seeded session exists')
  const owner = session.tenantId ?? store.defaultTenantId()
  const foreign = 'tenant-beta'
  const sessionArtifactId = 'hr1'

  assert.ok(store.sessionVisibleToTenant(session, owner))
  assert.equal(store.artifactContent(owner)[sessionArtifactId]?.type, 'doc')
  assert.equal(store.artifactContent(foreign)[sessionArtifactId], undefined)

  const grant = store.createGrant(
    { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: foreign }, tier: 'view' },
    owner,
  )
  assert.ok(grant, 'the session owner can widen the session read wall')
  try {
    assert.equal(store.artifactContent(foreign)[sessionArtifactId]?.type, 'doc')
  } finally {
    assert.equal(store.revokeGrant(grant!.id, owner), 'ok')
  }
  assert.equal(store.artifactContent(foreign)[sessionArtifactId], undefined, 'revoking the session removes its exact body alias')
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
