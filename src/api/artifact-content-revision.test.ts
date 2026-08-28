import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactContent } from '../../contract/index.ts'
import { mergeArtifactContent } from './artifactContentRevision.ts'

const doc = (revision: number | undefined, text: string): ArtifactContent => ({
  type: 'doc',
  title: 'Revision target',
  blocks: [{ p: text }],
  ...(revision === undefined ? {} : { revision }),
})

test('an older artifact acknowledgement cannot rewind a newer body', () => {
  const current = doc(2, 'Newer')
  assert.equal(mergeArtifactContent(current, doc(1, 'Older')), current)
})

test('legacy artifact bodies are revision zero once an edited body exists', () => {
  const current = doc(1, 'Edited')
  assert.equal(mergeArtifactContent(current, doc(undefined, 'Authored fixture')), current)
  assert.deepEqual(mergeArtifactContent(doc(undefined, 'Fixture'), doc(1, 'Edited')), doc(1, 'Edited'))
})

test('the newest artifact acknowledgement replaces the addressed body', () => {
  assert.deepEqual(mergeArtifactContent(doc(2, 'Before'), doc(3, 'After')), doc(3, 'After'))
})
