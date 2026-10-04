import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactTrashProjection } from './artifactTrashProjection.ts'
import { artifactCollectionSections, collectionSectionLabel } from './collectionSections.ts'
import type { ArtifactItem } from '../types.ts'

const row = (id: string, lifecycleRevision = 0) => ({ id, name: id, lifecycleRevision, own: true }) as ArtifactItem

test('Trash is a permanent structural collection without changing the active registry', () => {
  const active = [row('active')]
  const trashed = [row('trashed', 1)]
  const groups = artifactCollectionSections(active, [], () => undefined, trashed)
  assert.deepEqual(groups.map(g => [g.id, g.items.map(a => a.id)]), [['__unfiled', ['active']], ['__trash', ['trashed']]])
  assert.equal(collectionSectionLabel('artifacts', '__trash'), 'Trash')
  assert.deepEqual(artifactCollectionSections([], [], () => undefined), [{ id: '__trash', label: 'Trash', items: [] }])
  assert.equal(active.length, 1)
})

test('uncertain lifecycle rows remain in their reviewed collection only, without granting registry authority', () => {
  const live = row('live')
  const restoring = row('restore', 1)
  const trashing = row('trash')
  const input = [live]
  const result = artifactTrashProjection(input, [{ artifact: trashing, trashedAt: 8 }], [trashing, restoring])
  assert.deepEqual(result.active.map(a => a.id), ['live', 'trash'])
  assert.deepEqual(result.trashed.map(a => a.id), ['restore'])
  assert.deepEqual(input, [live], 'render-only recovery never mutates attachable authority')
})
