import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearArtifactHistoryRestoreHolds,
  clearArtifactPermanentDeletionHolds,
  holdArtifactHistoryRestore,
  holdArtifactPermanentDeletion,
  isArtifactHistoryRestoreHeld,
  isArtifactPermanentDeletionHeld,
  releaseArtifactHistoryRestore,
  releaseArtifactPermanentDeletion,
} from './artifactBodyOperationHolds.ts'

test('artifact history restore and permanent deletion hold the same artifact exclusively', (t) => {
  t.after(() => {
    clearArtifactHistoryRestoreHolds()
    clearArtifactPermanentDeletionHolds()
  })

  assert.equal(holdArtifactHistoryRestore('artifact-a'), true)
  assert.equal(holdArtifactPermanentDeletion('artifact-a'), false,
    'permanent deletion cannot race a reviewed history restore')
  releaseArtifactHistoryRestore('artifact-a')

  assert.equal(holdArtifactPermanentDeletion('artifact-a'), true)
  assert.equal(holdArtifactHistoryRestore('artifact-a'), false,
    'history restore cannot start after permanent deletion intent is accepted')
  assert.equal(isArtifactPermanentDeletionHeld('artifact-a'), true)
  assert.equal(isArtifactHistoryRestoreHeld('artifact-a'), false)

  releaseArtifactPermanentDeletion('artifact-a')
  assert.equal(isArtifactPermanentDeletionHeld('artifact-a'), false)
  assert.equal(holdArtifactHistoryRestore('artifact-a'), true)
})
