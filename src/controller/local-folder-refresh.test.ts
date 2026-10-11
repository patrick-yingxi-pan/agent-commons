import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { localFolderRefreshScope } from './localFolderRefreshCore.ts'

test('Refresh retains the saved local folder scope, including legacy flat snapshots', () => {
  assert.equal(localFolderRefreshScope(undefined), 'flat')
  assert.equal(localFolderRefreshScope({
    version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    capturedAt: '2026-10-04T12:00:00.000Z', connectionId: 'LOCAL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', files: [],
  }), 'flat')
  assert.equal(localFolderRefreshScope({
    version: 2, scope: 'recursive', snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    capturedAt: '2026-10-04T12:00:00.000Z', connectionId: 'LOCAL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', files: [],
  }), 'recursive')
})

test('one Refresh captures once and reuses those exact bytes for retry', () => {
  const source = stripComments(read(join(ROOT, 'src/controller/localFolderRefresh.ts')))
  assert.match(source, /localFolderRefreshScope\(folder\.localSnapshot\)/)
  assert.match(source, /let captured: LocalFolderCapture \| undefined/)
  assert.match(source, /captured \?\?= await captureLocalFolder\(connectionId, requestId, window, captureScope\)/)
  assert.match(source, /snapshot: captured/)
})
