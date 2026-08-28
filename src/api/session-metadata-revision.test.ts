import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAcceptSessionMetadata } from './sessionMetadataRevision.ts'

test('session metadata responses never rewind a newer cache projection', () => {
  assert.equal(shouldAcceptSessionMetadata({ metadataRevision: 2 }, { metadataRevision: 1 }), false)
  assert.equal(shouldAcceptSessionMetadata({ metadataRevision: 2 }, { metadataRevision: 2 }), true)
  assert.equal(shouldAcceptSessionMetadata({ metadataRevision: 2 }, { metadataRevision: 3 }), true)
})

test('legacy unrevisioned responses interoperate only until revisioned truth exists', () => {
  assert.equal(shouldAcceptSessionMetadata({}, {}), true)
  assert.equal(shouldAcceptSessionMetadata({}, { metadataRevision: 0 }), true)
  assert.equal(shouldAcceptSessionMetadata({ metadataRevision: 0 }, {}), false)
})
