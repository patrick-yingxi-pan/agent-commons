import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LIVE, type Live } from '../data/liveSession.ts'
import type { SessionContextState } from '../../contract/api.ts'
import type { Workspace } from '../../contract/entities.ts'
import { fsRecentKey } from '../../contract/fs.ts'
import { mergeServedFolderRefresh } from './servedFolderRefreshCore.ts'

const snapshot = (snapshotId: string, text: string) => ({
  version: 1 as const, snapshotId, capturedAt: '2026-10-04T12:00:00.000Z',
  sourceId: 'cloud', path: 'docs', files: [{ name: 'notes.md', sizeBytes: text.length, snapshot: { text } }],
})
const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const folderId = fsRecentKey('cloud', 'docs')
const localConnectionId = 'LOCAL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const
const localFolderId = fsRecentKey('ui-host', localConnectionId)
const localCapture = (snapshotId: string, text: string, connectionId = localConnectionId) => ({
  version: 1 as const, snapshotId, capturedAt: '2026-10-04T12:00:00.000Z', connectionId,
  files: [{ name: 'notes.md', sizeBytes: new TextEncoder().encode(text).length, snapshot: { text } }],
})
const initialWorkspace: Workspace = {
  id: 'ws', label: 'Workspace',
  folders: [{ id: folderId, label: 'Docs', snapshot: snapshot(sid, 'old') }],
  artifacts: [{ id: 'keep', name: 'keep.md', kind: 'doc', meta: 'authored' }],
}
const live: Live = { ...EMPTY_LIVE, workspaces: [initialWorkspace] }
const returned = (workspaces: Workspace[]): SessionContextState => ({
  contexts: [], workspace: { workspaces, repos: [], connectors: [], attachments: [] },
})

test('folder refresh merges only exact target snapshot and leaves other live workspace state alone', () => {
  const unchanged = { id: 'other', label: 'Other', folders: [], artifacts: [] }
  const next = mergeServedFolderRefresh({ ...live, workspaces: [...live.workspaces, unchanged], connectors: [{ id: 'c', label: 'C', kind: 'connector' }] },
    returned([{ ...initialWorkspace, folders: [{ id: folderId, label: 'Docs', snapshot: snapshot(requestId, 'new') }] }]),
    { folderId, expectedSnapshotId: sid, requestId })
  assert.equal(next.workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, requestId)
  assert.equal(next.workspaces[0]?.artifacts[0]?.id, 'keep')
  assert.equal(next.workspaces[1]?.id, 'other')
  assert.equal(next.connectors[0]?.id, 'c')
})

test('folder refresh does not resurrect a detached target or rewind a newer local snapshot', () => {
  const ack = returned([{ ...initialWorkspace, folders: [{ id: folderId, label: 'Docs', snapshot: snapshot(requestId, 'ack') }] }])
  assert.equal(mergeServedFolderRefresh({ ...live, workspaces: [] }, ack, { folderId, expectedSnapshotId: sid, requestId }).workspaces.length, 0)
  const newer = snapshot('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'newer')
  const current = { ...live, workspaces: [{ ...initialWorkspace, folders: [{ id: folderId, label: 'Docs', snapshot: newer }] }] }
  assert.equal(mergeServedFolderRefresh(current, ack, { folderId, expectedSnapshotId: sid, requestId }).workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, newer.snapshotId)
})

test('folder reconciliation adopts canonical capture, handles legacy folder, and only removes a confirmed detached target', () => {
  const captured = snapshot(requestId, 'canonical')
  const canonicalWorkspace: Workspace = { id: 'ws', label: 'Workspace', folders: [{ id: folderId, label: 'Docs', snapshot: captured }], artifacts: [] }
  const reconciled = mergeServedFolderRefresh(live, returned([canonicalWorkspace]), {
    folderId, expectedSnapshotId: sid, requestId, reconciled: true, baselineSnapshotId: sid,
  })
  assert.equal(reconciled.workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, requestId)

  const legacy: Workspace = { id: 'legacy', label: 'Legacy', artifacts: [{ id: 'old', name: 'old.md', kind: 'doc', meta: '', source: { id: folderId, label: 'Docs' } }] }
  const legacyLive = { ...EMPTY_LIVE, workspaces: [legacy] }
  const legacyMerged = mergeServedFolderRefresh(legacyLive, returned([{ ...legacy, folders: [{ id: folderId, label: 'Docs', snapshot: captured }] }]), {
    folderId, expectedSnapshotId: null, requestId,
  })
  assert.equal(legacyMerged.workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, requestId)
  assert.deepEqual(legacyMerged.workspaces[0]?.artifacts, [], 'legacy live folder artifact rows are replaced by snapshot.files projection')

  const detached = mergeServedFolderRefresh(live, returned([{ ...initialWorkspace, folders: [] }]), {
    folderId, expectedSnapshotId: sid, requestId, reconciled: true, baselineSnapshotId: sid,
  })
  assert.equal(detached.workspaces[0]?.folders?.some((folder) => folder.id === folderId), false)
  const targetOnly = { id: 'target-only', label: 'Target only', folders: [{ id: folderId, label: 'Docs', snapshot: snapshot(sid, 'old') }], artifacts: [] }
  const unrelatedEmpty = { id: 'unrelated-empty', label: 'Unrelated', artifacts: [] }
  const afterEmptyDetach = mergeServedFolderRefresh({ ...EMPTY_LIVE, workspaces: [targetOnly, unrelatedEmpty] }, returned([]), {
    folderId, expectedSnapshotId: sid, requestId, reconciled: true, baselineSnapshotId: sid,
  })
  assert.deepEqual(afterEmptyDetach.workspaces, [unrelatedEmpty], 'removing the last target drops only its now-empty workspace')

  const canonicalLegacyArtifact = { id: 'canonical-legacy', name: 'legacy.md', kind: 'doc' as const, meta: '', source: { id: folderId, label: 'Docs' } }
  const currentWithStaleRows = { ...live, workspaces: [{ ...initialWorkspace, artifacts: [
    ...initialWorkspace.artifacts,
    { id: 'stale-folder-row', name: 'stale.md', kind: 'doc' as const, meta: '', source: { id: folderId, label: 'Docs' } },
  ] }] }
  const canonicalLegacy = { ...initialWorkspace, folders: [{ id: folderId, label: 'Docs' }], artifacts: [canonicalLegacyArtifact] }
  const revertedToLegacy = mergeServedFolderRefresh(currentWithStaleRows, returned([canonicalLegacy]), {
    folderId, expectedSnapshotId: sid, requestId, reconciled: true, baselineSnapshotId: sid,
  })
  assert.equal(revertedToLegacy.workspaces[0]?.folders?.[0]?.snapshot, undefined)
  assert.deepEqual(revertedToLegacy.workspaces[0]?.artifacts, [initialWorkspace.artifacts[0], canonicalLegacyArtifact], 'canonical legacy rows replace stale saved-folder projection')

  const invalidCapture = { ...captured, files: [{ name: 'notes.md', sizeBytes: 1, snapshot: { text: 'wrong byte count' } }] }
  const rejected = mergeServedFolderRefresh(live, returned([{ ...initialWorkspace, folders: [{ id: folderId, label: 'Docs', snapshot: invalidCapture }] }]), {
    folderId, expectedSnapshotId: sid, requestId,
  })
  assert.equal(rejected.workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, sid, 'invalid canonical folder records are not merged')
  const staleReconcile = mergeServedFolderRefresh({ ...live, workspaces: [{ ...initialWorkspace, folders: [{ id: folderId, label: 'Docs', snapshot: snapshot(requestId, 'local newer') }] }] },
    returned([]), { folderId, expectedSnapshotId: sid, requestId, reconciled: true, baselineSnapshotId: sid })
  assert.equal(staleReconcile.workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, requestId)
})

test('local folder refresh replaces only the exact capture target and preserves unrelated newer live state', () => {
  const unrelatedId = fsRecentKey('ui-host', 'LOCAL_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
  const priorLocal = localCapture(sid, 'old')
  const unrelatedLocal = localCapture('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'newer unrelated')
  const workspace: Workspace = {
    id: 'ws', label: 'Workspace',
    folders: [
      { id: localFolderId, label: 'Local docs', localSnapshot: priorLocal },
      { id: unrelatedId, label: 'Other local folder', localSnapshot: unrelatedLocal },
    ],
    artifacts: [{ id: 'keep', name: 'authored.md', kind: 'doc', meta: 'authored' }],
  }
  const current = { ...live, workspaces: [workspace], repos: [{ id: 'newer-repo', label: 'Newer', path: '/repo' }] }
  const captured = localCapture(requestId, 'fresh local bytes')
  const result = mergeServedFolderRefresh(current, returned([{
    ...workspace,
    folders: [
      { id: localFolderId, label: 'Local docs', localSnapshot: captured },
      { id: unrelatedId, label: 'Other local folder', localSnapshot: localCapture(sid, 'stale unrelated') },
    ],
    artifacts: [],
  }]), { kind: 'local', folderId: localFolderId, expectedSnapshotId: sid, requestId })

  assert.equal(result.workspaces[0]?.folders?.find((folder) => folder.id === localFolderId)?.localSnapshot?.files[0]?.snapshot.text, 'fresh local bytes')
  assert.equal(result.workspaces[0]?.folders?.find((folder) => folder.id === unrelatedId)?.localSnapshot?.snapshotId, unrelatedLocal.snapshotId)
  assert.deepEqual(result.workspaces[0]?.artifacts, workspace.artifacts, 'authored rows survive targeted capture replacement')
  assert.deepEqual(result.repos, current.repos, 'newer unrelated session state is not replaced by the response')
})

test('local folder refresh rejects a mismatched connection receipt and keeps old or unresolved snapshots', () => {
  const workspace: Workspace = {
    id: 'local-ws', label: 'Local workspace',
    folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: localCapture(sid, 'saved') }],
    artifacts: [],
  }
  const current = { ...EMPTY_LIVE, workspaces: [workspace] }
  const target = { kind: 'local' as const, folderId: localFolderId, expectedSnapshotId: sid, requestId }
  const mismatched = mergeServedFolderRefresh(current, returned([{
    ...workspace,
    folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: localCapture(requestId, 'wrong receipt', 'LOCAL_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') }],
  }]), target)
  assert.equal(mismatched.workspaces[0]?.folders?.[0]?.localSnapshot?.snapshotId, sid)

  const missingAck = mergeServedFolderRefresh(current, returned([]), target)
  assert.equal(missingAck.workspaces[0]?.folders?.[0]?.localSnapshot?.snapshotId, sid, 'a missing target in an ordinary acknowledgement is not a detach')
  const missingCapture = mergeServedFolderRefresh(current, returned([{
    ...workspace, folders: [{ id: localFolderId, label: 'Local docs' }],
  }]), target)
  assert.equal(missingCapture.workspaces[0]?.folders?.[0]?.localSnapshot?.snapshotId, sid, 'an unresolved capture cannot erase saved bytes')

  const newer = localCapture('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'newer live state')
  const newerCurrent = { ...current, workspaces: [{ ...workspace, folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: newer }] }] }
  const staleAcknowledgement = mergeServedFolderRefresh(newerCurrent, returned([{
    ...workspace, folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: localCapture(requestId, 'stale response') }],
  }]), target)
  assert.equal(staleAcknowledgement.workspaces[0]?.folders?.[0]?.localSnapshot?.snapshotId, newer.snapshotId)
})

test('local folder dismissal reconciliation applies only against the unchanged local baseline', () => {
  const workspace: Workspace = {
    id: 'local-ws', label: 'Local workspace',
    folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: localCapture(sid, 'before') }],
    artifacts: [],
  }
  const current = { ...EMPTY_LIVE, workspaces: [workspace] }
  const target = { kind: 'local' as const, folderId: localFolderId, expectedSnapshotId: sid, requestId, reconciled: true, baselineSnapshotId: sid }
  const canonicalCapture = localCapture(requestId, 'committed before lost acknowledgement')
  const reconciled = mergeServedFolderRefresh(current, returned([{
    ...workspace, folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: canonicalCapture }],
  }]), target)
  assert.equal(reconciled.workspaces[0]?.folders?.[0]?.localSnapshot?.files[0]?.snapshot.text, 'committed before lost acknowledgement')

  const nowNewer = localCapture('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'another refresh')
  const changed = { ...current, workspaces: [{ ...workspace, folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: nowNewer }] }] }
  const staleRead = mergeServedFolderRefresh(changed, returned([{
    ...workspace, folders: [{ id: localFolderId, label: 'Local docs', localSnapshot: canonicalCapture }],
  }]), target)
  assert.equal(staleRead.workspaces[0]?.folders?.[0]?.localSnapshot?.snapshotId, nowNewer.snapshotId, 'a dismissal read cannot rewind a changed local target')

  const confirmedDetached = mergeServedFolderRefresh(current, returned([]), target)
  assert.equal(confirmedDetached.workspaces.length, 0, 'authoritative dismissal may remove the exact unchanged target')
})
