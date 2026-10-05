import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseArtifactHistoryPage,
  parseArtifactHistoryVersion,
  parseArtifactHistoryVersionResult,
  parseArtifactHistoryEntries,
  parseArtifactHistoryBody,
  parseRestoreArtifactHistoryRequest,
  type ArtifactHistoryPage,
  type ArtifactHistoryVersion,
} from './artifactHistory.ts'

const doc = { type: 'doc' as const, title: 'Notes', blocks: [{ p: 'Saved text' }] }
const version: ArtifactHistoryVersion = {
  revision: 4,
  savedAt: '2026-01-02T03:04:05.000Z',
  reason: 'restore',
  restoredFromRevision: 2,
  body: doc,
}

test('artifact history parses bounded immutable versions with exact body provenance', () => {
  assert.deepEqual(parseArtifactHistoryVersion(version), version)
  assert.equal(parseArtifactHistoryVersion({ ...version, revision: 0 }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, restoredFromRevision: 4 }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, savedAt: 'not a timestamp' }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, extra: true }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, body: { ...doc, revision: 4 } }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, body: { type: 'doc', title: '', blocks: [] } }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, reason: 'edit', savedAt: null }), undefined)
  assert.equal(parseArtifactHistoryVersionResult({ artifactId: 'artifact-1', currentRevision: 3, version }), undefined)
})

test('history pages keep exact descending revisions and bounded pagination metadata', () => {
  const page: ArtifactHistoryPage = {
    artifactId: 'artifact-1', currentRevision: 4,
    versions: [
      { revision: 4, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 2 },
      { revision: 3, savedAt: '2026-01-02T03:03:00.000Z', reason: 'edit' },
    ],
    nextBeforeRevision: 3,
  }
  assert.deepEqual(parseArtifactHistoryPage(page), page)
  assert.equal(parseArtifactHistoryPage({ ...page, versions: [...page.versions].reverse() }), undefined)
  assert.equal(parseArtifactHistoryPage({ ...page, nextBeforeRevision: 4 }), undefined)
  assert.equal(parseArtifactHistoryPage({ ...page, versions: Array.from({ length: 51 }, (_, i) => ({ revision: 50 - i, savedAt: null, reason: 'baseline' })) }), undefined)
})

test('restore intent is closed and pins an exact safe current revision', () => {
  assert.deepEqual(parseRestoreArtifactHistoryRequest({ expectedRevision: 4 }), { expectedRevision: 4 })
  assert.equal(parseRestoreArtifactHistoryRequest({ expectedRevision: 4, revision: 2 }), undefined)
  assert.equal(parseRestoreArtifactHistoryRequest({ expectedRevision: -1 }), undefined)
  assert.equal(parseRestoreArtifactHistoryRequest({ expectedRevision: Number.MAX_SAFE_INTEGER + 1 }), undefined)
})

test('history preserves valid large legacy prose bodies and rejects malformed append ordering', () => {
  const body = { type: 'doc', title: 'Large legacy body', blocks: Array.from({ length: 12 }, () => ({ p: 'x'.repeat(2_000) })) }
  assert.ok(parseArtifactHistoryBody(body), 'history bounds honor the existing 100 × 2,000 prose-block envelope')
  assert.throws(() => parseArtifactHistoryEntries([['artifact-1', [
    { revision: 4, savedAt: null, reason: 'baseline', body: doc },
    { revision: 6, savedAt: '2026-01-02T03:04:05.000Z', reason: 'edit', body: doc },
  ]]]), /contiguous and monotonic/)
  assert.throws(() => parseArtifactHistoryEntries([['artifact-1', [
    { revision: 4, savedAt: null, reason: 'baseline', body: doc },
    { revision: 5, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 3, body: doc },
  ]]]), /restore source is missing/)
  assert.throws(() => parseArtifactHistoryEntries([['artifact-1', [
    { revision: 4, savedAt: null, reason: 'baseline', body: doc },
    { revision: 5, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 4, body: { ...doc, blocks: [{ p: 'different' }] } },
  ]]]), /differs from its source/)
})
