import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiRequestError } from '../api/client.ts'
import { describeStructuredArtifactMutationFailure } from './structuredArtifactMutations.ts'

test('whole-body conflicts describe the complete saved content without assuming a sheet or deck', () => {
  const failure = describeStructuredArtifactMutationFailure(new ApiRequestError('conflict', 'revision changed', 409))
  assert.deepEqual(failure, {
    message: 'This artifact changed elsewhere. Compare the latest saved content below. Retry replaces the entire saved content with your held draft; Dismiss keeps the draft editable.',
    retryable: true,
  })
  assert.match(failure.message, /entire saved content/)
  assert.doesNotMatch(failure.message, /sheet|deck|slide|workbook/i)
})

test('validation and authorization failures keep a format-neutral complete draft for review', () => {
  const invalid = describeStructuredArtifactMutationFailure(new ApiRequestError('invalid_request', 'Document title is required.', 400))
  assert.equal(invalid.retryable, false)
  assert.match(invalid.message, /complete draft/)
  const missing = describeStructuredArtifactMutationFailure(new ApiRequestError('not_found', 'Missing.', 404))
  assert.equal(missing.retryable, false)
  assert.match(missing.message, /artifact edit/)
})
