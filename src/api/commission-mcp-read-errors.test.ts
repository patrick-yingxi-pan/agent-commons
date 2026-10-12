import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRequestError } from './client.ts'
import { commissionMcpReviewReadErrorKind } from './commissionMcpReadErrors.ts'

test('private Commission MCP access denials are unavailable while other failures can retry', () => {
  for (const status of [401, 403, 404]) assert.equal(commissionMcpReviewReadErrorKind(new ApiRequestError('internal', 'private', status)), 'unavailable')
  for (const error of [new ApiRequestError('internal', 'server error', 500), new ApiRequestError('internal', 'offline', 0), new Error('offline')]) {
    assert.equal(commissionMcpReviewReadErrorKind(error), 'transient')
  }
})
