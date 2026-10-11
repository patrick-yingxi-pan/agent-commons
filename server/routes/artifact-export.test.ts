/** GET /artifacts/:id/export is a read-only, tenant-walled export of an authored
 * document body. It must expose the current id-keyed revision without touching
 * graph, body, grant, or event state. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ArtifactDocumentExport, ArtifactContentLibrary, ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { closePersistence, loadState } from '../persistence/persist.ts'

before(() => {
  process.env.PERSIST_BACKEND = 'sqlite'
  process.env.DATABASE_PATH = ':memory:'
  store.initPersistence()
})
after(() => closePersistence())

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

async function createDocument(name: string, body: string, tenantId = OWNER): Promise<ArtifactItem> {
  const created = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body } },
  }, { 'x-tenant-id': tenantId, 'idempotency-key': `artifact-export-create-${name}` })
  assert.equal(created.status, 200)
  const artifact = (created.json.extraArtifacts as ArtifactItem[]).find((row) => row.name === name)
  assert.ok(artifact, `created ${name} must be returned in the acknowledged graph`)
  return artifact
}

test('export returns current authored Markdown bytes and revision to the owner and a granted reader', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(`export-${stamp}.md`, 'First paragraph.\n\nSecond paragraph.')
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id },
    audience: { kind: 'org', orgId: READER },
    tier: 'view',
  }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)

  const owner = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(owner.status, 200)
  const ownerExport = owner.json as ArtifactDocumentExport
  assert.deepEqual(ownerExport, {
    artifactId: artifact.id,
    filename: artifact.name,
    mediaType: 'text/markdown;charset=utf-8',
    content: `# export\\-${stamp}\n\nFirst paragraph\\.\n\nSecond paragraph\\.\n`,
    revision: 0,
  })

  const reader = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': READER })
  assert.equal(reader.status, 200)
  assert.deepEqual(reader.json, ownerExport, 'grant readers receive the same current authorized bytes')

  const edited = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block: 1,
    text: 'Edited second paragraph.',
    expectedRevision: 0,
  }, { 'x-tenant-id': OWNER })
  assert.equal(edited.status, 200)

  const current = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': READER })
  assert.equal(current.status, 200)
  assert.deepEqual(current.json as ArtifactDocumentExport, {
    artifactId: artifact.id,
    filename: artifact.name,
    mediaType: 'text/markdown;charset=utf-8',
    content: `# export\\-${stamp}\n\nFirst paragraph\\.\n\nEdited second paragraph\\.\n`,
    revision: 1,
  })
})

test('export hides revoked, foreign, and missing artifacts with the same 404', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(`export-wall-${stamp}.md`, 'Wall test.')
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id },
    audience: { kind: 'org', orgId: READER },
    tier: 'view',
  }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': READER })).status, 200)

  assert.equal((await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
  const revoked = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': READER })
  const foreign = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': FOREIGN })
  const missing = await call('GET', '/artifacts/artifact-does-not-exist/export', undefined, { 'x-tenant-id': READER })
  assert.equal(revoked.status, 404)
  assert.equal(foreign.status, 404)
  assert.equal(missing.status, 404)
  assert.equal(revoked.json.error.code, foreign.json.error.code)
  assert.equal(foreign.json.error.code, missing.json.error.code)
})

test('export refuses unsupported and metadata-only authored rows, even when a name matches a demo fixture', async () => {
  const sameName = `insights-onepager.md`
  const metadata = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name: sameName, kind: 'doc', meta: 'Document' } },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `artifact-export-metadata-${Date.now()}` })
  assert.equal(metadata.status, 200)
  const row = (metadata.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === sameName)
  assert.ok(row)
  assert.notEqual(row.id, 'a1', 'the metadata-only authored row must not resolve the seeded fixture by name')

  const metadataExport = await call('GET', `/artifacts/${row.id}/export`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(metadataExport.status, 409)
  assert.equal(metadataExport.json.error.code, 'capability_unavailable')

  const sheet = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name: `export-${Date.now().toString(36)}.csv`, kind: 'sheet', meta: 'Sheet' } },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `artifact-export-sheet-${Date.now()}` })
  assert.equal(sheet.status, 200)
  const sheetRow = (sheet.json.extraArtifacts as ArtifactItem[])[0]
  const sheetExport = await call('GET', `/artifacts/${sheetRow.id}/export`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(sheetExport.status, 409)
  assert.equal(sheetExport.json.error.code, 'capability_unavailable')
})

test('export has no event or state mutation side effects', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(`export-readonly-${stamp}.md`, 'Read-only export.')
  const before = loadState()
  assert.ok(before?.graph.extraArtifacts.some(row => row.id === artifact.id), 'the compared snapshot contains this test document')
  const events: string[] = []
  const unsubscribe = store.subscribe((event) => events.push(event.type))
  try {
    const response = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(response.status, 200)
  } finally {
    unsubscribe()
  }
  assert.deepEqual(events, [])
  assert.deepEqual(loadState(), before)
})
