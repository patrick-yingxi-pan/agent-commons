import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as attachmentInput from './attachmentInput.ts'
import { fsRecentKey } from './fs.ts'
import { isServedImageFileName, isServedImageSnapshot } from './servedImageSnapshot.ts'
import { isRefreshServedAttachmentRequest, isSnapshotId } from './servedTextSnapshot.ts'

const snapshot = {
  version: 1,
  snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  capturedAt: '2026-10-04T12:00:00.000Z',
  sourceId: 'cloud',
  path: 'photos/cover.jpg',
  image: {
    id: `img-${'a'.repeat(64)}`,
    mimeType: 'image/png',
    width: 1600,
    height: 900,
    byteLength: 4096,
  },
}

function servedAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: fsRecentKey(snapshot.sourceId, snapshot.path),
    label: 'cover.jpg',
    kind: 'photo',
    source: { id: snapshot.sourceId, kind: 'cloud', label: 'Cloud storage' },
    imageSnapshot: snapshot,
    ...overrides,
  }
}

test('attachment admission rejects malformed served-image snapshot payloads', () => {
  const malformed: unknown[] = [
    null,
    [],
    { ...snapshot, version: 2 },
    { ...snapshot, snapshotId: 'not-a-uuid' },
    { ...snapshot, sourceId: 'ui-host' },
    { ...snapshot, capturedAt: '2026-02-30T12:00:00.000Z' },
    { ...snapshot, path: '../cover.jpg' },
    { ...snapshot, path: 'cover.jpg', extra: true },
    { ...snapshot, image: { ...snapshot.image, mimeType: 'image/jpeg' } },
    { ...snapshot, image: { ...snapshot.image, width: 2001 } },
    { ...snapshot, image: { ...snapshot.image, height: 2001 } },
    { ...snapshot, image: { ...snapshot.image, byteLength: 0 } },
    { ...snapshot, image: { ...snapshot.image, id: 'img-no-digest' } },
    { ...snapshot, image: { ...snapshot.image, extra: 'not closed' } },
  ]
  assert.equal(isServedImageSnapshot(snapshot), true)
  assert.equal(isServedImageSnapshot({ ...snapshot, image: { ...snapshot.image, width: 2000, height: 2000 } }), true)
  assert.equal(isServedImageFileName('photos/capture.SVG'), true)
  for (const name of ['png', 'photos/png', 'notes.txt', 'image.avif']) assert.equal(isServedImageFileName(name), false)
  for (const value of malformed) assert.equal(isServedImageSnapshot(value), false, JSON.stringify(value))
  for (const value of malformed) {
    assert.equal(attachmentInput.isAttachmentInput(servedAttachment({ imageSnapshot: value })), false, JSON.stringify(value))
  }
})

test('binds a served snapshot to a source-qualified attachment and refuses competing content slots', () => {
  assert.equal(attachmentInput.isAttachmentInput(servedAttachment()), true)
  const invalid = [
    servedAttachment({ id: fsRecentKey('cloud', 'photos/other.jpg') }),
    servedAttachment({ source: { id: 'runner:elsewhere', kind: 'runner', label: 'Runner' } }),
    servedAttachment({ source: { ...servedAttachment().source, kind: 'runner' } }),
    servedAttachment({ kind: 'file', label: 'notes.txt', id: fsRecentKey('cloud', 'docs/notes.txt'), imageSnapshot: { ...snapshot, path: 'docs/notes.txt' } }),
    servedAttachment({ image: snapshot.image }),
    servedAttachment({ textSnapshot: { version: 1 } }),
    servedAttachment({ previewText: 'not the captured image' }),
    servedAttachment({ documentImport: { format: 'pdf', status: 'ready' } }),
    servedAttachment({ previewUrl: 'blob:https://example.test/image' }),
    servedAttachment({ imageSnapshot: { ...snapshot, sourceId: 'runner:elsewhere' } }),
    servedAttachment({ imageSnapshot: { ...snapshot, path: 'photos/other.jpg' } }),
  ]
  for (const value of invalid) assert.equal(attachmentInput.isAttachmentInput(value), false)

  for (const sourceId of ['cloud', 'runner:runner_7']) {
    const path = 'photos/capture.svg'
    const source = { id: sourceId, kind: sourceId === 'cloud' ? 'cloud' : 'runner', label: sourceId }
    assert.equal(attachmentInput.isAttachmentInput({
      ...servedAttachment(),
      id: fsRecentKey(sourceId, path),
      source,
      imageSnapshot: { ...snapshot, sourceId, path },
    }), true)
  }
  const legacyFilePath = 'docs/cover.bmp'
  assert.equal(attachmentInput.isAttachmentInput({
    ...servedAttachment(), kind: 'file', id: fsRecentKey('cloud', legacyFilePath),
    imageSnapshot: { ...snapshot, path: legacyFilePath },
  }), true)
})

test('uses nested served image refs and ids for the shared model-input projection without changing local images', () => {
  const served = servedAttachment()
  const ref = snapshot.image
  assert.deepEqual(attachmentInput.attachmentImageRef?.(served), ref)
  assert.equal(attachmentInput.attachmentSnapshotId?.(served), snapshot.snapshotId)

  const local = {
    id: 'local-photo', label: 'local.png', kind: 'photo',
    image: { ...snapshot.image, id: `img-${'b'.repeat(64)}`, mimeType: 'image/jpeg' },
  }
  assert.deepEqual(attachmentInput.attachmentImageRef?.(local), local.image)
  assert.equal(attachmentInput.attachmentSnapshotId?.(local), null)
  assert.equal(attachmentInput.planAttachmentInput([served as never])[0]?.status, 'image-ready')
  assert.equal(attachmentInput.planAttachmentInput([local as never])[0]?.status, 'image-ready')
  assert.equal(attachmentInput.attachmentImageRef?.(undefined), undefined)
  assert.equal(attachmentInput.attachmentSnapshotId?.(undefined), null)

  const large = Array.from({ length: 3 }, (_, index) => {
    const path = `photos/large-${index}.png`
    return servedAttachment({
      id: fsRecentKey('cloud', path),
      imageSnapshot: {
        ...snapshot, path, snapshotId: `${String(index + 1).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        image: { ...snapshot.image, byteLength: 3 * 1024 * 1024 },
      },
    })
  })
  assert.deepEqual(attachmentInput.planAttachmentInput(large as never[]).map(({ status }) => status), [
    'image-ready', 'image-ready', 'image-total-limit',
  ])

  const counted = Array.from({ length: 9 }, (_, index) => {
    const path = `photos/count-${index}.png`
    return servedAttachment({
      id: fsRecentKey('cloud', path),
      imageSnapshot: {
        ...snapshot, path, snapshotId: `${String(index + 1).repeat(8)}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      },
    })
  })
  assert.equal(attachmentInput.planAttachmentInput(counted as never[])[8]?.status, 'image-count-limit')
})

test('refresh requests retain text compatibility and bind image snapshots to a distinct exact receipt', () => {
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  assert.equal(isSnapshotId(snapshot.snapshotId), true)
  assert.equal(isRefreshServedAttachmentRequest({ expectedSnapshotId: null, requestId }), true)
  assert.equal(isRefreshServedAttachmentRequest({
    expectedSnapshotId: null,
    requestId: snapshot.snapshotId,
    imageSnapshot: snapshot,
  }), true)

  const invalid: unknown[] = [
    { expectedSnapshotId: null, requestId, imageSnapshot: snapshot },
    { expectedSnapshotId: snapshot.snapshotId, requestId: snapshot.snapshotId, imageSnapshot: snapshot },
    { expectedSnapshotId: null, requestId: snapshot.snapshotId, imageSnapshot: { ...snapshot, path: 'other.txt' } },
    { expectedSnapshotId: null, requestId: snapshot.snapshotId, imageSnapshot: snapshot, extra: true },
    { expectedSnapshotId: null, requestId: snapshot.snapshotId, snapshot },
  ]
  for (const value of invalid) assert.equal(isRefreshServedAttachmentRequest(value), false)
})
