import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAttachmentInput } from './attachmentInput.ts'
import { fsRecentKey } from './fs.ts'
import { isServedTextSnapshot, isSnapshotId, SERVED_TEXT_SNAPSHOT_MAX_BYTES } from './servedTextSnapshot.ts'

const valid = {
  version: 1,
  snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  capturedAt: '2026-10-04T12:00:00.000Z',
  sourceId: 'cloud',
  path: 'reports/notes.txt',
  text: 'captured text\n',
}

test('accepts exact cloud and runner served-text snapshots and UUID v4 ids only', () => {
  assert.equal(isSnapshotId(valid.snapshotId), true)
  assert.equal(isSnapshotId('aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'), false)
  assert.equal(isSnapshotId('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'), false)
  assert.equal(isServedTextSnapshot(valid), true)
  assert.equal(isServedTextSnapshot({ ...valid, sourceId: 'runner:runner_7' }), true)
})

test('requires the exact own-key snapshot shape and rejects malformed provenance, time, path, and text', () => {
  const malformed: unknown[] = [
    null,
    [],
    { ...valid, version: 2 },
    { ...valid, snapshotId: 'not-a-uuid' },
    { ...valid, sourceId: 'runner:' },
    { ...valid, sourceId: 'ui-host' },
    { ...valid, capturedAt: '2026-02-30T12:00:00.000Z' },
    { ...valid, capturedAt: '2026-10-04T12:00:00Z' },
    { ...valid, path: '../secret.txt' },
    { ...valid, path: '/absolute.txt' },
    { ...valid, path: 'folder\\secret.txt' },
    { ...valid, path: 'folder/.hidden.txt' },
    { ...valid, path: 'folder//notes.txt' },
    { ...valid, text: 'before\0after' },
    { ...valid, extra: 'not part of the contract' },
  ]
  for (const value of malformed) assert.equal(isServedTextSnapshot(value), false, JSON.stringify(value))

  const inheritedRequired = Object.assign(Object.create({ text: valid.text }), {
    version: valid.version,
    snapshotId: valid.snapshotId,
    capturedAt: valid.capturedAt,
    sourceId: valid.sourceId,
    path: valid.path,
  })
  assert.equal(isServedTextSnapshot(inheritedRequired), false)
})

test('bounds both UTF-8 bytes and path depth/length at the declared snapshot limits', () => {
  assert.equal(SERVED_TEXT_SNAPSHOT_MAX_BYTES, 64 * 1024)
  assert.equal(isServedTextSnapshot({ ...valid, text: 'é'.repeat(SERVED_TEXT_SNAPSHOT_MAX_BYTES / 2) }), true)
  assert.equal(isServedTextSnapshot({ ...valid, text: 'é'.repeat(SERVED_TEXT_SNAPSHOT_MAX_BYTES / 2 + 1) }), false)
  assert.equal(isServedTextSnapshot({ ...valid, text: 'x'.repeat(SERVED_TEXT_SNAPSHOT_MAX_BYTES + 1) }), false)
  assert.equal(isServedTextSnapshot({ ...valid, path: `a/${'b/'.repeat(62)}last.txt` }), true)
  assert.equal(isServedTextSnapshot({ ...valid, path: `a/${'b/'.repeat(63)}last.txt` }), false)
  assert.equal(isServedTextSnapshot({ ...valid, path: 'a'.repeat(4097) }), false)
})

test('an attachment binds a saved snapshot to the exact source and source-qualified path', () => {
  const attachment = {
    id: fsRecentKey(valid.sourceId, valid.path),
    label: 'notes.txt',
    kind: 'file',
    source: { id: valid.sourceId, kind: 'cloud', label: 'Cloud storage' },
    textSnapshot: valid,
  }
  assert.equal(isAttachmentInput(attachment), true)
  assert.equal(isAttachmentInput({ ...attachment, id: fsRecentKey('cloud', 'other.txt') }), false)
  assert.equal(isAttachmentInput({ ...attachment, source: { ...attachment.source, id: 'runner:other' } }), false)
  assert.equal(isAttachmentInput({ ...attachment, source: { ...attachment.source, kind: 'runner' } }), false)
  assert.equal(isAttachmentInput({ ...attachment, textSnapshot: { ...valid, sourceId: 'runner:other' } }), false)
  assert.equal(isAttachmentInput({ ...attachment, textSnapshot: { ...valid, path: 'other.txt' } }), false)
  assert.equal(isAttachmentInput({ ...attachment, kind: 'photo' }), false)
  assert.equal(isAttachmentInput({ ...attachment, previewText: 'preview is not the saved body' }), false)
})
