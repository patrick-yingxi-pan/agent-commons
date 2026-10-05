import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalGitCapture, isLocalGitConnectionId, isLocalGitRefreshRequest } from './localGitCapture.ts'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const capture = {
  version: 1, snapshotId: ID, capturedAt: '2026-10-04T12:00:00.000Z',
  connectionId: 'GIT_0123456789ABCDEF0123456789ABCDEF',
  files: [{ path: '.github/workflows/check.yml', sizeBytes: 4, snapshot: { text: 'test' } }],
}

test('Local Git capture is a closed saved-copy receipt with an opaque Git-only identity', () => {
  assert.equal(isLocalGitConnectionId(capture.connectionId), true)
  assert.equal(isLocalGitCapture(capture), true)
  assert.equal(isLocalGitCapture({ ...capture, path: '/private/repo' }), false)
  assert.equal(isLocalGitCapture({ ...capture, connectionId: 'LOCAL_0123456789ABCDEF0123456789ABCDEF' }), false)
  assert.equal(isLocalGitCapture({ ...capture, files: [{ ...capture.files[0], path: '../secret' }] }), false)
  assert.equal(isLocalGitCapture({ ...capture, files: [], extra: true }), false)
  const request = { expectedSnapshotId: null, requestId: ID, snapshot: capture }
  assert.equal(isLocalGitRefreshRequest(request), true)
  assert.equal(isLocalGitRefreshRequest({ ...request, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), false)
  assert.equal(isLocalGitRefreshRequest({ ...request, extra: 1 }), false)
})
