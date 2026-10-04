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
