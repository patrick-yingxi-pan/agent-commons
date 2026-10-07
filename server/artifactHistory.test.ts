import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactContent } from '../contract/content.ts'
import type { ArtifactHistoryVersion } from '../contract/artifactHistory.ts'
import { prepareArtifactHistoryAppend } from './artifactHistory.ts'

function doc(revision: number, blocks: Array<{ id: string; p: string }>): ArtifactContent {
  return { type: 'doc', title: 'Notes', blocks, revision }
}

test('history append copies identified blocks across edit, reorder, insertion, and deletion', () => {
  const prior = doc(0, [
    { id: 'block-a', p: 'Alpha' },
    { id: 'block-b', p: 'Bravo' },
    { id: 'block-c', p: 'Charlie' },
  ])
  const updated = doc(1, [
    { id: 'block-c', p: 'Charlie' },
    { id: 'block-b', p: 'Bravo revised' },
    { id: 'block-d', p: 'Delta' },
  ])
  const priorBefore = structuredClone(prior)
  const updatedBefore = structuredClone(updated)

  const versions = prepareArtifactHistoryAppend('artifact-1', prior, updated, '2026-09-01T00:00:00.000Z')

  assert.deepEqual(versions.map((version) => version.revision), [0, 1])
  assert.deepEqual((versions[0]!.body as Extract<ArtifactContent, { type: 'doc' }>).blocks, [
    { id: 'block-a', p: 'Alpha' },
    { id: 'block-b', p: 'Bravo' },
    { id: 'block-c', p: 'Charlie' },
  ])
  assert.deepEqual((versions[1]!.body as Extract<ArtifactContent, { type: 'doc' }>).blocks, [
    { id: 'block-c', p: 'Charlie' },
    { id: 'block-b', p: 'Bravo revised' },
    { id: 'block-d', p: 'Delta' },
  ])
  assert.deepEqual(prior, priorBefore, 'the source body is not mutated')
  assert.deepEqual(updated, updatedBefore, 'the next body is not mutated')

  const baseline = versions[0]!.body as Extract<ArtifactContent, { type: 'doc' }>
  const latest = versions[1]!.body as Extract<ArtifactContent, { type: 'doc' }>
  baseline.blocks[0] = { id: 'block-x', p: 'changed detached history' }
  latest.blocks[0] = { id: 'block-y', p: 'changed detached history' }
  assert.deepEqual(prior, priorBefore, 'history baseline is detached from prior body')
  assert.deepEqual(updated, updatedBefore, 'history append is detached from updated body')
})

test('history append rejects an existing latest body with mismatched block IDs', () => {
  const prior = doc(1, [{ id: 'block-current', p: 'Same text' }])
  const updated = doc(2, [{ id: 'block-current', p: 'Next text' }])
  const existing: ArtifactHistoryVersion[] = [
    { revision: 1, savedAt: '2026-09-01T00:00:00.000Z', reason: 'edit', body: {
      type: 'doc', title: 'Notes', blocks: [{ id: 'block-other', p: 'Same text' }],
    } },
  ]

  assert.throws(
    () => prepareArtifactHistoryAppend('artifact-1', prior, updated, '2026-09-02T00:00:00.000Z', 'edit', undefined, existing),
    /history does not match its current body/,
  )
})

test('history identity comparison ignores DocBlock property order but preserves IDs', () => {
  const prior = doc(0, [{ id: 'block-a', p: 'Alpha' }])
  const updated = doc(1, [{ id: 'block-a', p: 'Alpha revised' }])
  const existing: ArtifactHistoryVersion[] = [{
    revision: 0,
    savedAt: null,
    reason: 'baseline',
    body: { type: 'doc', title: 'Notes', blocks: [{ p: 'Alpha', id: 'block-a' } as never] },
  }]

  const versions = prepareArtifactHistoryAppend('artifact-1', prior, updated, '2026-09-01T00:00:00.000Z', 'edit', undefined, existing)
  assert.deepEqual((versions[0]!.body as Extract<ArtifactContent, { type: 'doc' }>).blocks, [
    { id: 'block-a', p: 'Alpha' },
  ])
})

test('restore append accepts the exact retained source identity and rejects same-text replacement identity', () => {
  const source: ArtifactHistoryVersion = {
    revision: 0,
    savedAt: null,
    reason: 'baseline',
    body: { type: 'doc', title: 'Notes', blocks: [{ p: 'Original text', id: 'block-original' } as never] },
  }
  const prior = doc(1, [{ id: 'block-current', p: 'Current text' }])
  const existing = [source, {
    revision: 1,
    savedAt: '2026-09-01T00:00:00.000Z',
    reason: 'edit' as const,
    body: { type: 'doc' as const, title: 'Notes', blocks: [{ id: 'block-current', p: 'Current text' }] },
  }]

  const restored = prepareArtifactHistoryAppend(
    'artifact-1', prior, doc(2, [{ id: 'block-original', p: 'Original text' }]),
    '2026-09-02T00:00:00.000Z', 'restore', 0, existing,
  )
  assert.deepEqual((restored.at(-1)!.body as Extract<ArtifactContent, { type: 'doc' }>).blocks,
    [{ id: 'block-original', p: 'Original text' }])

  assert.throws(
    () => prepareArtifactHistoryAppend(
      'artifact-1', prior, doc(2, [{ id: 'block-replacement', p: 'Original text' }]),
      '2026-09-02T00:00:00.000Z', 'restore', 0, existing,
    ),
    /restore body must exactly match its retained source version/,
  )
})
