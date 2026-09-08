import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactItem } from './cowork.ts'
import { normalizeArtifactName, projectArtifactMetadata } from './artifactMetadata.ts'

const raw = (overrides: Partial<ArtifactItem> = {}): ArtifactItem => ({
  id: 'a1',
  name: 'original.md',
  kind: 'doc',
  meta: 'Document',
  source: 'A session',
  projectId: '',
  editedAt: 100,
  ...overrides,
})

test('normalizeArtifactName trims and bounds names without rewriting Unicode or punctuation', () => {
  assert.equal(normalizeArtifactName('  résumé [final].md  '), 'résumé [final].md')
  assert.equal(normalizeArtifactName('😀'.repeat(240)), '😀'.repeat(240))
  assert.equal(normalizeArtifactName('😀'.repeat(241)), undefined)
  assert.equal(normalizeArtifactName(`${'😀'.repeat(240)}.md`), undefined)
  assert.equal(normalizeArtifactName(''), undefined)
  assert.equal(normalizeArtifactName(' \t '), undefined)
  assert.equal(normalizeArtifactName(`good\u0000name`), undefined)
  assert.equal(normalizeArtifactName(`good\u202Ename`), undefined)
  assert.equal(normalizeArtifactName(42), undefined)
})

test('projectArtifactMetadata overlays display metadata while preserving identity and body-facing fields', () => {
  const projected = projectArtifactMetadata(raw({ metadataRevision: 2 }), {
    name: 'renamed.md',
    revision: 3,
    editedAt: 200,
  })
  assert.equal(projected.id, 'a1')
  assert.equal(projected.name, 'renamed.md')
  assert.equal(projected.metadataRevision, 3)
  assert.equal(projected.editedAt, 200)
  assert.equal(projected.source, 'A session')
  assert.deepEqual(projected.saveOrigin, { name: 'original.md', source: 'A session' })
})

test('projectArtifactMetadata keeps the newest edit time and an existing save origin', () => {
  const projected = projectArtifactMetadata(raw({ editedAt: 500, saveOrigin: { name: 'created.md', source: 'Origin' } }), {
    name: 'renamed.md',
    revision: 1,
    editedAt: 200,
  })
  assert.equal(projected.editedAt, 500)
  assert.deepEqual(projected.saveOrigin, { name: 'created.md', source: 'Origin' })
  const unchanged = projectArtifactMetadata(raw())
  assert.equal(unchanged.name, 'original.md')
  assert.equal(unchanged.metadataRevision, 0)
  assert.deepEqual(unchanged.saveOrigin, { name: 'original.md', source: 'A session' })
})
