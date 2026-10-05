import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAttachmentInput } from './attachmentInput.ts'
import { fsRecentKey } from './fs.ts'
import { documentFormatForName, isRefreshServedAttachmentRequest, isServedTextSnapshot, isSnapshotId, SERVED_TEXT_SNAPSHOT_MAX_BYTES } from './servedTextSnapshot.ts'

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

test('accepts complete v2 document snapshots only when ready metadata matches the path extension', () => {
  const snapshots = [
    { ...valid, version: 2, path: 'reports/scan.PDF', documentImport: { format: 'pdf', status: 'ready', pages: 4, textPages: 2 } },
    { ...valid, version: 2, path: 'brief.docx', documentImport: { format: 'docx', status: 'ready' } },
    { ...valid, version: 2, path: 'budget.xlsx', documentImport: { format: 'xlsx', status: 'ready' } },
    { ...valid, version: 2, path: 'launch.pptx', documentImport: { format: 'pptx', status: 'ready' } },
  ]
  for (const snapshot of snapshots) assert.equal(isServedTextSnapshot(snapshot), true)
  assert.equal(isServedTextSnapshot({ ...valid, text: '' }), true, 'v1 whole-text snapshots retain valid empty files')
  assert.equal(documentFormatForName('pdf'), undefined)
  assert.equal(documentFormatForName('reports/pdf'), undefined)
  assert.equal(documentFormatForName('reports/brief.docx'), 'docx')
})

test('rejects v2 snapshots with absent, failed, malformed, mismatched, or extra document metadata', () => {
  const ready = { format: 'pdf', status: 'ready', pages: 4, textPages: 2 }
  const malformed: unknown[] = [
    { ...valid, version: 2 },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: { format: 'pdf' } },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: { ...ready, status: 'invalid' } },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: { ...ready, extra: true } },
    { ...valid, version: 2, path: 'scan.docx', documentImport: ready },
    { ...valid, version: 2, path: 'scan.txt', documentImport: ready },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: { format: 'docx', status: 'ready' } },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: ready, extra: true },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: { ...ready, pages: -1 } },
    { ...valid, version: 2, path: 'scan.pdf', documentImport: { ...ready, textPages: 5 } },
    { ...valid, version: 2, path: 'scan.pdf', text: 'x'.repeat(SERVED_TEXT_SNAPSHOT_MAX_BYTES + 1), documentImport: ready },
    { ...valid, version: 2, path: 'scan.docx', text: '', documentImport: { format: 'docx', status: 'ready' } },
    { ...valid, version: 2, path: 'scan.docx', text: ' \n\t', documentImport: { format: 'docx', status: 'ready' } },
  ]
  for (const value of malformed) assert.equal(isServedTextSnapshot(value), false, JSON.stringify(value))
})

test('refresh requests preserve legacy receipt shape and bind v2 snapshot receipts exactly', () => {
  const snapshot = { ...valid, version: 2, path: 'brief.docx', documentImport: { format: 'docx', status: 'ready' } }
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  assert.equal(isRefreshServedAttachmentRequest({ expectedSnapshotId: null, requestId }), true)
  assert.equal(isRefreshServedAttachmentRequest({ expectedSnapshotId: valid.snapshotId, requestId }), true)
  assert.equal(isRefreshServedAttachmentRequest({ expectedSnapshotId: null, requestId: snapshot.snapshotId, snapshot }), true)
  const invalid: unknown[] = [
    { expectedSnapshotId: null, requestId, snapshot: { ...snapshot, version: 1 } },
    { expectedSnapshotId: null, requestId, snapshot: { ...snapshot, documentImport: { format: 'docx', status: 'invalid' } } },
    { expectedSnapshotId: null, requestId, snapshot: { ...snapshot, path: 'wrong.pdf' } },
    { expectedSnapshotId: null, requestId, snapshot: { ...snapshot, snapshotId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } },
    { expectedSnapshotId: snapshot.snapshotId, requestId: snapshot.snapshotId, snapshot },
    { expectedSnapshotId: null, requestId, snapshot, extra: true },
  ]
  for (const value of invalid) assert.equal(isRefreshServedAttachmentRequest(value), false, JSON.stringify(value))
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

  const documentSnapshot = {
    ...valid,
    version: 2,
    path: 'reports/scan.pdf',
    documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 1 },
  }
  const documentAttachment = {
    ...attachment,
    id: fsRecentKey('cloud', documentSnapshot.path),
    label: 'scan.pdf',
    textSnapshot: documentSnapshot,
  }
  assert.equal(isAttachmentInput(documentAttachment), true)
  assert.equal(isAttachmentInput({ ...documentAttachment, documentImport: documentSnapshot.documentImport }), false)
  assert.equal(isAttachmentInput({ ...documentAttachment, textSnapshot: { ...documentSnapshot, path: 'reports/other.pdf' } }), false)
})
