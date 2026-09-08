import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactItem } from '../../contract/index.ts'
import { keys } from './keys.ts'
import { peek, resetAll, setData } from './cache.ts'
import { acceptArtifactMetadata, mergeArtifactMetadata } from './artifactMetadata.ts'

const row = (id: string, extra: Partial<ArtifactItem> = {}): ArtifactItem => ({
  id,
  name: 'notes.md',
  kind: 'doc',
  meta: 'Document',
  source: 'Conversation',
  projectId: '',
  editedAt: 10,
  ...extra,
})

test('a late artifact metadata acknowledgement cannot rewind newer row data', () => {
  const current = row('a1', {
    name: 'new.md',
    metadataRevision: 2,
    editedAt: 20,
    excerpt: 'new body excerpt',
    sourceSessionId: 'session-new',
    saveOrigin: { name: 'notes.md', source: 'Conversation' },
  })
  const late = row('a1', {
    name: 'old.md',
    metadataRevision: 1,
    editedAt: 11,
    excerpt: 'old body excerpt',
    sourceSessionId: 'session-old',
  })
  assert.equal(mergeArtifactMetadata(current, late), current)
})

test('metadata acknowledgement merges only title metadata into the current row', () => {
  const current = row('a1', {
    metadataRevision: 2,
    excerpt: 'body stays',
    sourceSessionId: 'session-1',
    projectId: 'project-1',
    saveOrigin: { name: 'original.md', source: 'Created here' },
  })
  const incoming = row('a1', {
    name: 'renamed.md',
    metadataRevision: 3,
    editedAt: 30,
    excerpt: 'stale response body',
    sourceSessionId: 'wrong-session',
    projectId: 'wrong-project',
    saveOrigin: { name: 'wrong.md', source: 'wrong' },
  })
  assert.deepEqual(mergeArtifactMetadata(current, incoming), {
    ...current,
    name: 'renamed.md',
    metadataRevision: 3,
    editedAt: 30,
  })
})

test('an acknowledgement never seeds a partial registry when the collection is absent', () => {
  setData<ArtifactItem[]>(keys.artifacts, [])
  const incoming = row('a1', { name: 'renamed.md', metadataRevision: 1 })
  acceptArtifactMetadata(incoming)
  assert.deepEqual(peek<ArtifactItem[]>(keys.artifacts), [])
  resetAll()
})
