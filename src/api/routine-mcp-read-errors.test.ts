import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRequestError } from './client.ts'
import { routineMcpReviewReadErrorKind } from './routineMcpReadErrors.ts'

test('owner-only Routine MCP access denials are unavailable, other errors remain retryable', () => {
  for (const status of [401, 403, 404]) {
    assert.equal(routineMcpReviewReadErrorKind(new ApiRequestError('internal', 'private', status)), 'unavailable')
  }
  for (const error of [new ApiRequestError('internal', 'server error', 500), new ApiRequestError('internal', 'offline', 0), new Error('offline')]) {
    assert.equal(routineMcpReviewReadErrorKind(error), 'transient')
  }
})
