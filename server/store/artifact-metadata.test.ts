/** Owner-only artifact display metadata is a separate CAS stream from the
 * document body.  These tests deliberately use an authored row so a mutable
 * display name cannot accidentally resolve a seeded body by filename. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConflictError, ValidationError } from '../conflict.ts'
import { store } from './index.ts'

function create(name: string, tenant: string) {
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Document', body: 'Original body.\n\nSecond block.' },
    sessionId: `metadata-session-${name}`,
    sessionTitle: 'Metadata test session',
  }, tenant)
  const row = store.relationGraph(tenant).extraArtifacts.find((artifact) => artifact.name === name)
  assert.ok(row, 'the authored artifact must be materialized')
  return row
}

test('renameArtifact advances metadata only and preserves body, filing, provenance, and source identity', () => {
  const tenant = `tenant-artifact-metadata-${Date.now().toString(36)}`
  const originalName = `metadata-original-${Date.now().toString(36)}.md`
  const renamed = `metadata-renamed-${Date.now().toString(36)}.md`
  const row = create(originalName, tenant)
  const beforeBody = store.artifactContent(tenant)[row.id]
  const beforeRevision = beforeBody?.revision ?? 0
  const beforeGraph = store.relationGraph(tenant)
  const beforeProject = beforeGraph.artifactProject[row.id]
  const beforeOrigin = row.saveOrigin
  const beforeSource = row.source
  const beforeSession = row.sourceSessionId

  const next = store.renameArtifact(row.id, renamed, row.metadataRevision ?? 0, tenant)
  assert.equal(next?.name, renamed)
  assert.equal(next?.metadataRevision, (row.metadataRevision ?? 0) + 1)
  assert.deepEqual(next?.saveOrigin, beforeOrigin)
  assert.equal(next?.source, beforeSource)
  assert.equal(next?.sourceSessionId, beforeSession)
  assert.equal(store.relationGraph(tenant).artifactProject[row.id], beforeProject)
  assert.deepEqual(store.artifactContent(tenant)[row.id], beforeBody, 'rename does not rewrite document bytes')
  assert.equal(store.artifactContent(tenant)[row.id]?.revision, beforeRevision, 'body revision is independent')

  const bodyEdited = store.updateArtifactBlock(row.id, 0, 'Body changed after rename.', beforeRevision)
  assert.ok(bodyEdited)
  assert.equal(store.listArtifacts(tenant).find((artifact) => artifact.id === row.id)?.metadataRevision, 1)
  assert.equal(store.artifactContent(tenant)[row.id]?.revision, beforeRevision + 1)
  assert.equal(store.renameArtifact(row.id, `${renamed}-again.md`, 1, tenant)?.metadataRevision, 2)

  assert.throws(() => store.renameArtifact(row.id, 'stale.md', 0, tenant), ConflictError)
  assert.throws(() => store.renameArtifact(row.id, '', 2, tenant), ValidationError)
  assert.equal(store.renameArtifact(row.id, `${renamed}-again.md`, 2, tenant)?.metadataRevision, 2, 'same-name CAS is a no-op')
})

test('renameArtifact is owner-only and defaults legacy metadataRevision to zero', () => {
  const stamp = Date.now().toString(36)
  const owner = `tenant-artifact-metadata-owner-${stamp}`
  const reader = `tenant-artifact-metadata-reader-${stamp}`
  const row = create(`metadata-wall-${stamp}.md`, owner)
  assert.equal(row.metadataRevision ?? 0, 0)
  assert.equal(store.renameArtifact(row.id, 'reader-must-not-rename.md', 0, reader), undefined)
  assert.equal(store.renameArtifact('missing-artifact', 'missing.md', 0, owner), undefined)
})
