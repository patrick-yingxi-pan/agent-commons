import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseArtifactDeletionPreview,
  parseArtifactDeletionRequest,
  parseArtifactDeletionResult,
} from './artifactDeletion.ts'

const reviewToken = 'a'.repeat(64)
const preview = {
  artifactId: 'artifact-reviewed', artifactName: 'notes.md', lifecycleRevision: 3, reviewToken,
  counts: { versions: 4, shares: 2, discussions: 3, proposals: 1 },
}

test('artifact deletion contract accepts exact bounded preview, request, and receipt shapes', () => {
  assert.deepEqual(parseArtifactDeletionPreview(preview), preview)
  assert.deepEqual(parseArtifactDeletionRequest({ expectedLifecycleRevision: 3, reviewToken }), {
    expectedLifecycleRevision: 3, reviewToken,
  })
  assert.deepEqual(parseArtifactDeletionResult({ artifactId: 'artifact-reviewed', deleted: true }), {
    artifactId: 'artifact-reviewed', deleted: true,
  })
})

test('artifact deletion contract rejects altered, negative, and noncanonical review inputs', () => {
  assert.equal(parseArtifactDeletionPreview({ ...preview, counts: { ...preview.counts, shares: -1 } }), undefined)
  assert.equal(parseArtifactDeletionPreview({ ...preview, reviewToken: 'not-opaque-enough' }), undefined)
  assert.equal(parseArtifactDeletionPreview({ ...preview, extra: true }), undefined)
  assert.equal(parseArtifactDeletionRequest({ expectedLifecycleRevision: -1, reviewToken }), undefined)
  assert.equal(parseArtifactDeletionRequest({ expectedLifecycleRevision: 3, reviewToken, state: 'deleted' }), undefined)
  assert.equal(parseArtifactDeletionResult({ artifactId: 'artifact-reviewed', deleted: false }), undefined)
})
