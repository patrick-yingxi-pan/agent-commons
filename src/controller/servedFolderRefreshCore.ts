import type { SessionContextState } from '../../contract/api.ts'
import { isServedFolderSnapshot } from '../../contract/servedFolderSnapshot.ts'
import { isLocalFolderCapture } from '../../contract/localFolderCapture.ts'
import { isLocalGitCapture } from '../../contract/localGitCapture.ts'
import type { Workspace, WorkspaceFolder } from '../../contract/entities.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { isWorkspaceFolder, replaceLocalFolderSnapshot, replaceLocalGitSnapshot, replaceServedFolderSnapshot, workspaceFolders } from '../../contract/workspaceFolders.ts'
import { removeFolderFromLive, type Live } from '../data/liveSession.ts'

export interface ServedFolderRefreshTarget {
  folderId: string
  kind?: 'local' | 'git'
  expectedSnapshotId: string | null
  requestId: string
  reconciled?: boolean
  baselineSnapshotId?: string | null
}

function findFolder(workspaces: Workspace[], folderId: string): { workspace: Workspace; folder: WorkspaceFolder } | undefined {
  for (const workspace of workspaces) {
    const folder = workspaceFolders(workspace).find((item) => item.id === folderId)
    if (folder) return { workspace, folder }
  }
  return undefined
}

function replaceCanonicalLegacyFolder(workspace: Workspace, folder: WorkspaceFolder, canonical: Workspace): Workspace {
  const target = { id: folder.id, label: folder.label }
  const folders = workspace.folders ?? []
  const existsExplicitly = folders.some((item) => item.id === folder.id)
  return {
    ...workspace,
    folders: existsExplicitly
      ? folders.map((item) => item.id === folder.id ? target : item)
      : [...folders, target],
    // A canonical legacy folder has no saved copy. Replace just its rows with
    // the canonical legacy projection instead of leaving stale snapshot files.
    artifacts: [
      ...(workspace.artifacts ?? []).filter((artifact) => artifact.source?.id !== folder.id),
      ...(canonical.artifacts ?? []).filter((artifact) => artifact.source?.id === folder.id),
    ],
  }
}

/** Merge one exact saved-folder target without replacing unrelated live state. */
export function mergeFolderRefresh(
  current: Live,
  returned: SessionContextState,
  target: ServedFolderRefreshTarget,
): Live {
  const attached = findFolder(current.workspaces, target.folderId)
  if (!attached) return current
  const snapshotField = target.kind === 'local' ? 'localSnapshot' : target.kind === 'git' ? 'gitSnapshot' : 'snapshot'
  const currentSnapshotId = attached.folder[snapshotField]?.snapshotId ?? null
  if (target.reconciled === true) {
    if (currentSnapshotId !== target.baselineSnapshotId) return current
  } else if (currentSnapshotId !== target.expectedSnapshotId && currentSnapshotId !== target.requestId) return current

  const source = parseFsRecentKey(target.folderId)
  if (!source) return current
  const canonical = findFolder(returned.workspace.workspaces, target.folderId)
  if (!canonical) {
    if (target.reconciled !== true) return current
    return removeFolderFromLive(current, target.folderId)
  }
  const snapshot = canonical.folder[snapshotField]
  if (!isWorkspaceFolder(canonical.folder)) return current

  if (!snapshot) {
    if (target.reconciled !== true) return current
    const returnedWorkspace = returned.workspace.workspaces.find((workspace) => workspaceFolders(workspace).some((folder) => folder.id === target.folderId))
    if (!returnedWorkspace) return current
    return {
      ...current,
      workspaces: current.workspaces.map((workspace) => workspace === attached.workspace
        ? replaceCanonicalLegacyFolder(workspace, canonical.folder, returnedWorkspace) : workspace),
    }
  }
  if (target.kind === 'local') {
    if (!isLocalFolderCapture(snapshot) || source.sourceId !== 'ui-host' || snapshot.connectionId !== source.entryId) return current
  } else if (target.kind === 'git') {
    if (!isLocalGitCapture(snapshot) || source.sourceId !== 'ui-host' || snapshot.connectionId !== source.entryId) return current
  } else if (!isServedFolderSnapshot(snapshot) || snapshot.sourceId !== source.sourceId || snapshot.path !== source.entryId) return current
  if (target.reconciled !== true && snapshot.snapshotId !== target.requestId) return current

  return {
    ...current,
    workspaces: current.workspaces.map((workspace) => workspace === attached.workspace
      ? isLocalFolderCapture(snapshot)
        ? replaceLocalFolderSnapshot(workspace, target.folderId, snapshot)
        : isLocalGitCapture(snapshot)
          ? replaceLocalGitSnapshot(workspace, target.folderId, snapshot)
          : replaceServedFolderSnapshot(workspace, target.folderId, snapshot) : workspace),
  }
}

/** Compatibility export for served-folder callers and their existing locks. */
export const mergeServedFolderRefresh = mergeFolderRefresh
