import test from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactHistoryPage } from '../../contract/artifactHistory.ts'
import { artifactHistoryNextCursor, flattenArtifactHistoryPages, mergeArtifactHistoryPage } from './artifactHistoryPages.ts'

function page(from: number, to: number, nextBeforeRevision?: number): ArtifactHistoryPage {
  return {
    artifactId: 'artifact-1',
    currentRevision: from,
    versions: Array.from({ length: from - to + 1 }, (_, index) => ({
      revision: from - index,
      savedAt: '2026-10-05T12:00:00.000Z',
      reason: 'edit' as const,
    })),
    ...(nextBeforeRevision === undefined ? {} : { nextBeforeRevision }),
  }
}

test('a live newest-page advance preserves the loaded boundary with no duplicate revisions', () => {
  const priorHead = page(100, 51, 51)
  const older = page(50, 1)
  const advancedHead = page(101, 52, 52)
  const pages = mergeArtifactHistoryPage([priorHead, older], advancedHead, true)
  const revisions = flattenArtifactHistoryPages(pages).map((version) => version.revision)

  assert.equal(revisions.length, 101)
  assert.equal(new Set(revisions).size, 101)
  assert.deepEqual(revisions.slice(0, 3), [101, 100, 99])
  assert.equal(revisions.at(-1), 1)
  assert.equal(artifactHistoryNextCursor(pages), undefined)
})

test('loading older history follows the oldest loaded page cursor', () => {
  const pages = mergeArtifactHistoryPage([page(100, 51, 51)], page(50, 1, 1), false)
  assert.equal(artifactHistoryNextCursor(pages), 1)
  assert.equal(flattenArtifactHistoryPages(pages).length, 100)
})
