import type { SessionContextState } from '../../contract/api.ts'
import { isServedFolderSnapshot } from '../../contract/servedFolderSnapshot.ts'
import type { Workspace, WorkspaceFolder } from '../../contract/entities.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { isWorkspaceFolder, replaceServedFolderSnapshot, workspaceFolders } from '../../contract/workspaceFolders.ts'
import { removeFolderFromLive, type Live } from '../data/liveSession.ts'

export interface ServedFolderRefreshTarget {
  folderId: string
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
export function mergeServedFolderRefresh(
  current: Live,
  returned: SessionContextState,
  target: ServedFolderRefreshTarget,
): Live {
  const attached = findFolder(current.workspaces, target.folderId)
  if (!attached) return current
  const currentSnapshotId = attached.folder.snapshot?.snapshotId ?? null
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
  const snapshot = canonical.folder.snapshot
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
  if (!isServedFolderSnapshot(snapshot) || snapshot.sourceId !== source.sourceId || snapshot.path !== source.entryId) return current
  if (target.reconciled !== true && snapshot.snapshotId !== target.requestId) return current

  return {
    ...current,
    workspaces: current.workspaces.map((workspace) => workspace === attached.workspace
      ? replaceServedFolderSnapshot(workspace, target.folderId, snapshot) : workspace),
  }
}
