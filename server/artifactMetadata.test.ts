import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArtifactMetadataEntries } from './artifactMetadata.ts'

const valid = [['a1', { name: 'renamed.md', revision: 2, editedAt: 123 }]]

test('parseArtifactMetadataEntries accepts the additive persisted shape and defaults absent snapshots', () => {
  assert.deepEqual(parseArtifactMetadataEntries(undefined), [])
  assert.deepEqual(parseArtifactMetadataEntries(valid), valid)
})

test('parseArtifactMetadataEntries rejects malformed or non-canonical metadata', () => {
  const cases: unknown[] = [
    null,
    {},
    [['a1']],
    [['a1', { name: 'x', revision: 0 }]],
    [['a1', { name: 'x', revision: -1, editedAt: 0 }]],
    [['a1', { name: 'x', revision: 0, editedAt: -1 }]],
    [['a1', { name: ' x ', revision: 0, editedAt: 0 }]],
    [['a1', { name: 'x', revision: 0, editedAt: 0, extra: true }]],
    [['', { name: 'x', revision: 0, editedAt: 0 }]],
    [['a1', { name: 'x', revision: 0, editedAt: 0 }], ['a1', { name: 'y', revision: 1, editedAt: 1 }]],
  ]
  for (const value of cases) assert.throws(() => parseArtifactMetadataEntries(value), String(value))
})
