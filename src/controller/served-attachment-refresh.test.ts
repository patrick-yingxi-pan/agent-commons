import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionContextState } from '../../contract/api.ts'
import type { Attachment } from '../../contract/entities.ts'
import { fsRecentKey, type FsSource } from '../../contract/fs.ts'
import type { ServedTextSnapshot } from '../../contract/servedTextSnapshot.ts'
import { EMPTY_LIVE, type Live } from '../data/liveSession.ts'
import { mergeServedAttachmentRefresh } from './servedAttachmentRefreshCore.ts'
import { isAttachmentInput } from '../../contract/attachmentInput.ts'
import { discussionContextId, type DiscussionSnapshot } from '../../contract/discussionSnapshot.ts'

const source: FsSource = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }
const expectedSnapshotId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const remoteSnapshotId = '33333333-3333-4333-8333-333333333333'

function snapshot(snapshotId: string): ServedTextSnapshot {
  return { version: 1, snapshotId, capturedAt: '2026-01-01T00:00:00.000Z', sourceId: source.id, path: 'docs/a.md', text: snapshotId }
}

function attachment(textSnapshot?: ServedTextSnapshot): Attachment {
  return {
    id: fsRecentKey(source.id, 'docs/a.md'),
    label: 'a.md',
    kind: 'file',
    source,
    ...(textSnapshot ? { textSnapshot } : {}),
  }
}

function state(attachments: Attachment[], connectors = []): SessionContextState {
  return { contexts: [], workspace: { workspaces: [], repos: [], connectors, attachments } }
}

function live(attachments: Attachment[], connectors: Live['connectors'] = []): Live {
  return { ...EMPTY_LIVE, attachments, connectors }
}

test('exact refresh acknowledgement updates only its still-current attached target', () => {
  const other = { id: 'slack', label: 'Slack', kind: 'connector' as const }
  const current = live([attachment(snapshot(expectedSnapshotId))], [other])
  const returned = state([attachment(snapshot(requestId))], [])
  const merged = mergeServedAttachmentRefresh(current, returned, {
    attachmentId: attachment().id,
    expectedSnapshotId,
    requestId,
    reconciled: false,
  })

  assert.equal(merged.attachments[0]?.textSnapshot?.snapshotId, requestId)
  assert.deepEqual(merged.connectors, [other], 'the complete returned workspace cannot overwrite unrelated live state')
})

test('refresh acknowledgement cannot restore a detached file or rewind a newer snapshot', () => {
  const targetId = attachment().id
  const returned = state([attachment(snapshot(requestId))])
  const detached = mergeServedAttachmentRefresh(live([]), returned, {
    attachmentId: targetId, expectedSnapshotId, requestId, reconciled: false,
  })
  assert.deepEqual(detached.attachments, [], 'an acknowledgement cannot resurrect a locally detached target')

  const newer = attachment(snapshot(remoteSnapshotId))
  const preserved = mergeServedAttachmentRefresh(live([newer]), state([attachment(snapshot(requestId))]), {
    attachmentId: targetId, expectedSnapshotId, requestId, reconciled: false,
  })
  assert.equal(preserved.attachments[0]?.textSnapshot?.snapshotId, remoteSnapshotId)
})

test('authoritative dismissal reconciliation adopts a newer target snapshot and honors detach', () => {
  const targetId = attachment().id
  const reconciled = mergeServedAttachmentRefresh(live([attachment(snapshot(expectedSnapshotId))]), state([attachment(snapshot(remoteSnapshotId))]), {
    attachmentId: targetId, expectedSnapshotId, requestId, reconciled: true, baselineSnapshotId: expectedSnapshotId,
  })
  assert.equal(reconciled.attachments[0]?.textSnapshot?.snapshotId, remoteSnapshotId)

  const detached = mergeServedAttachmentRefresh(live([attachment(snapshot(expectedSnapshotId))]), state([]), {
    attachmentId: targetId, expectedSnapshotId, requestId, reconciled: true, baselineSnapshotId: expectedSnapshotId,
  })
  assert.deepEqual(detached.attachments, [], 'authoritative absence applies a detach instead of reviving stale state')
})

test('late refresh reconciliation preserves a target changed during the read', () => {
  const targetId = attachment().id
  const current = live([attachment(snapshot(remoteSnapshotId))])
  const staleRead = state([attachment(snapshot(requestId))])
  const merged = mergeServedAttachmentRefresh(current, staleRead, {
    attachmentId: targetId,
    expectedSnapshotId,
    requestId,
    reconciled: true,
    baselineSnapshotId: expectedSnapshotId,
  })
  assert.equal(merged.attachments[0]?.textSnapshot?.snapshotId, remoteSnapshotId)

  const nowDetached = mergeServedAttachmentRefresh(live([]), staleRead, {
    attachmentId: targetId,
    expectedSnapshotId,
    requestId,
    reconciled: true,
    baselineSnapshotId: expectedSnapshotId,
  })
  assert.deepEqual(nowDetached.attachments, [], 'a late read cannot restore a detach that landed while it was pending')
})

test('capturing a legacy preview replaces its preview-only payload with one valid saved copy', () => {
  const legacy = { ...attachment(), previewText: 'legacy preview' }
  const merged = mergeServedAttachmentRefresh(live([legacy]), state([attachment(snapshot(requestId))]), {
    attachmentId: legacy.id, expectedSnapshotId: null, requestId,
  })
  assert.equal(merged.attachments[0]?.previewText, undefined)
  assert.equal(merged.attachments[0]?.textSnapshot?.snapshotId, requestId)
  assert.equal(isAttachmentInput(merged.attachments[0]), true)
})

test('image receipt merge preserves exact target, newer snapshots, kind and reconciliation baseline', () => {
  const image = { id: 'img-' + 'a'.repeat(64), mimeType: 'image/png' as const, width: 2, height: 2, byteLength: 80 }
  const captured = (snapshotId: string) => ({ version: 1 as const, snapshotId, capturedAt: '2026-01-01T00:00:00.000Z', sourceId: 'cloud', path: 'a.png', image })
  for (const kind of ['file', 'photo'] as const) {
    const photo = { id: 'cloud::a.png', label: 'a.png', kind, source, imageSnapshot: captured(expectedSnapshotId) }
    const target = { attachmentId: photo.id, expectedSnapshotId, requestId }
    const canonical = { ...photo, imageSnapshot: captured(requestId) }
    const merged = mergeServedAttachmentRefresh(live([photo]), state([canonical]), target)
    assert.deepEqual(merged.attachments, [canonical])
    assert.equal(isAttachmentInput(merged.attachments[0]), true)
    const newer = { ...photo, imageSnapshot: captured(remoteSnapshotId) }
    assert.deepEqual(mergeServedAttachmentRefresh(live([newer]), state([canonical]), target).attachments, [newer])
    assert.deepEqual(mergeServedAttachmentRefresh(live([]), state([canonical]), target).attachments, [])
    assert.deepEqual(mergeServedAttachmentRefresh(live([photo]), state([canonical]), { ...target, reconciled: true, baselineSnapshotId: remoteSnapshotId }).attachments, [photo])
    assert.deepEqual(mergeServedAttachmentRefresh(live([photo]), state([newer]), { ...target, reconciled: true, baselineSnapshotId: expectedSnapshotId }).attachments, [newer])
    assert.deepEqual(mergeServedAttachmentRefresh(live([photo]), state([{ ...canonical, kind: kind === 'photo' ? 'file' : 'photo' }]), target).attachments, [photo])
    const legacy = { ...photo, imageSnapshot: undefined, previewUrl: 'stale://unreadable' }
    const upgrade = mergeServedAttachmentRefresh(live([legacy]), state([canonical]), { ...target, expectedSnapshotId: null })
    assert.equal(upgrade.attachments[0].previewUrl, undefined)
    assert.deepEqual(upgrade.attachments[0].imageSnapshot, canonical.imageSnapshot)
  }
})

function discussionSnapshot(snapshotId: string, text: string): DiscussionSnapshot {
  return { version: 1, snapshotId, capturedAt: '2026-10-06T10:00:00.000Z', discussionId: 'thread-1', title: 'Thread one', postCount: 2, text }
}

test('Discussion refresh merges only the still-attached target with its exact server snapshot', () => {
  const original = discussionSnapshot(expectedSnapshotId, 'saved copy')
  const refreshed = discussionSnapshot(requestId, 'refreshed copy')
  const item: Attachment = { id: discussionContextId(original.discussionId), label: original.title, kind: 'discussion', discussionCaptureId: requestId, discussionSnapshot: original }
  const other = attachment(snapshot(expectedSnapshotId))
  const current = live([item, other])
  const returned = state([{ ...item, discussionCaptureId: undefined, discussionSnapshot: refreshed }])
  const target = { attachmentId: item.id, expectedSnapshotId, requestId }
  const merged = mergeServedAttachmentRefresh(current, returned, target)
  assert.deepEqual(merged.attachments[0]?.discussionSnapshot, refreshed)
  assert.equal(merged.attachments[0]?.discussionCaptureId, undefined, 'acknowledgement clears pending capture intent')
  assert.deepEqual(merged.attachments[1], other, 'the complete server workspace cannot replace unrelated live attachment state')
  assert.equal(isAttachmentInput(merged.attachments[0]), true)

  assert.deepEqual(mergeServedAttachmentRefresh(current, state([{ ...item, discussionSnapshot: discussionSnapshot(remoteSnapshotId, 'wrong request') }]), target), current,
    'an acknowledgement must prove the exact request id')
  assert.deepEqual(mergeServedAttachmentRefresh(live([other]), returned, target), live([other]),
    'a late acknowledgement cannot resurrect a locally detached Discussion')
})

test('Discussion dismissal reconciliation is baseline-fenced and never resurrects a detached reference', () => {
  const original = discussionSnapshot(expectedSnapshotId, 'saved copy')
  const refreshed = discussionSnapshot(remoteSnapshotId, 'server current copy')
  const item: Attachment = { id: discussionContextId(original.discussionId), label: original.title, kind: 'discussion', discussionSnapshot: original }
  const other = attachment(snapshot(expectedSnapshotId))
  const target = { attachmentId: item.id, expectedSnapshotId, requestId, reconciled: true, baselineSnapshotId: expectedSnapshotId }

  const merged = mergeServedAttachmentRefresh(live([item, other]), state([{ ...item, discussionSnapshot: refreshed }]), target)
  assert.deepEqual(merged.attachments[0]?.discussionSnapshot, refreshed)
  assert.deepEqual(merged.attachments[1], other)

  const changedLocally = { ...item, discussionSnapshot: discussionSnapshot(requestId, 'newer local copy') }
  assert.deepEqual(mergeServedAttachmentRefresh(live([changedLocally]), state([{ ...item, discussionSnapshot: refreshed }]), target).attachments, [changedLocally],
    'a reconciliation started from an older snapshot cannot rewind a newer local copy')
  assert.deepEqual(mergeServedAttachmentRefresh(live([]), state([{ ...item, discussionSnapshot: refreshed }]), target).attachments, [],
    'a late read cannot resurrect a detached Discussion')

  const absent = mergeServedAttachmentRefresh(live([item, other]), state([other]), target)
  assert.deepEqual(absent.attachments, [other], 'authoritative absence removes only the refreshed target')
})
