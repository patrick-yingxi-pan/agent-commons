import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalConnectionId, isLocalFolderCapture, isLocalFolderCaptureV1, isLocalFolderCaptureV2, isLocalFolderRefreshRequest } from './localFolderCapture.ts'
import { isServedFolderSnapshot } from './servedFolderSnapshot.ts'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const capture = {
  version: 1,
  snapshotId: ID,
  capturedAt: '2026-10-04T12:00:00.000Z',
  connectionId: 'LOCAL_0123456789ABCDEF0123456789ABCDEF',
  files: [
    { name: 'a.md', sizeBytes: 4, snapshot: { text: 'body' } },
    { name: 'b.png', sizeBytes: 8, snapshot: { omitted: 'unsupported' } },
  ],
}

test('local folder capture and refresh request are closed bounded detached values', () => {
  assert.equal(isLocalConnectionId(capture.connectionId), true)
  assert.equal(isLocalFolderCapture(capture), true)
  assert.equal(isLocalFolderCapture({ ...capture, path: '/private/path' }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: [] , extra: true }), false)
  assert.equal(isLocalFolderCapture({ ...capture, capturedAt: '2026-10-04T12:00:00Z' }), false)
  assert.equal(isLocalFolderCapture({ ...capture, connectionId: 'LOCAL_lowercase' }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: [{ ...capture.files[0], name: ['..', 'secret.md'].join('/') }] }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: [{ ...capture.files[0], snapshot: { text: 'body', omitted: 'budget' } }] }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: [{ ...capture.files[0], sizeBytes: 3 }] }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: [{ ...capture.files[0], snapshot: { text: 'x'.repeat(64 * 1024 + 1) }, sizeBytes: 64 * 1024 + 1 }] }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: Array.from({ length: 501 }, (_, i) => ({ name: `f${String(i).padStart(3, '0')}.txt`, sizeBytes: 0, snapshot: { omitted: 'unsupported' } })) }), false)
  assert.equal(isLocalFolderCapture({ ...capture, files: [] }), true, 'empty is an explicit successful capture')
  const recursive = { ...capture, version: 2 as const, scope: 'recursive' as const, files: [
    { name: 'a/notes.md', sizeBytes: 4, snapshot: { text: 'body' } },
    { name: 'b/notes.md', sizeBytes: 4, snapshot: { text: 'body' } },
  ] }
  assert.equal(isLocalFolderCaptureV1(recursive), false, 'v1 remains flat and exact')
  assert.equal(isLocalFolderCaptureV2(recursive), true)
  assert.equal(isLocalFolderCapture(recursive), true)
  assert.equal(isLocalFolderCaptureV2({ ...recursive, scope: 'flat' }), false)
  assert.equal(isLocalFolderCaptureV2({ ...recursive, extra: true }), false)
  assert.equal(isLocalFolderCaptureV1({ ...capture, files: [{ ...capture.files[0], name: 'src/notes.md' }] }), false,
    'v1 remains strict about nested paths')

  const request = { expectedSnapshotId: null, requestId: ID, snapshot: capture }
  assert.equal(isLocalFolderRefreshRequest(request), true)
  assert.equal(isLocalFolderRefreshRequest({ ...request, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), false)
  assert.equal(isLocalFolderRefreshRequest({ ...request, extra: 1 }), false)
  assert.equal(isLocalFolderRefreshRequest({ ...request, snapshot: { ...recursive, snapshotId: ID } }), true)
})

test('served and local folder captures share the same file limits and policy', () => {
  assert.equal(isServedFolderSnapshot({
    version: 1, snapshotId: ID, capturedAt: capture.capturedAt, sourceId: 'cloud', path: 'docs', files: capture.files,
  }), true)
  assert.equal(isServedFolderSnapshot({
    version: 1, snapshotId: ID, capturedAt: capture.capturedAt, sourceId: 'cloud', path: 'docs',
    files: [{ ...capture.files[0], name: '.hidden.md' }],
  }), false)
})
