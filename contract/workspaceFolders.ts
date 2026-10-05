import type { Artifact, ArtifactKind, Workspace, WorkspaceFolder } from './entities.ts'
import { isServedFolderSnapshot } from './servedFolderSnapshot.ts'
import { isLocalFolderCapture, type LocalFolderCapture } from './localFolderCapture.ts'
import { isLocalGitCapture, type LocalGitCapture } from './localGitCapture.ts'
import { fsRecentKey } from './fs.ts'

export type WorkspaceArtifact = Artifact & { savedFolderSnapshot?: import('./localFolderSnapshot.mjs').FolderFileSnapshot; savedFolderSnapshotId?: string }

/** Selection is a file within a source-qualified folder, not the historical
 * artifact projection ID. This stays stable when a legacy folder is captured. */
export function workspaceArtifactKey(artifact: Pick<Artifact, 'id' | 'name' | 'source'>): string {
  return JSON.stringify(artifact.source ? [artifact.source.id, artifact.name] : [artifact.id])
}

export function isWorkspaceFolder(value: unknown): value is WorkspaceFolder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).some((key) => !['id', 'label', 'snapshot', 'localSnapshot', 'gitSnapshot'].includes(key))) return false
  if (typeof row.id !== 'string' || !row.id || typeof row.label !== 'string' || !row.label) return false
  if ([row.snapshot, row.localSnapshot, row.gitSnapshot].filter((item) => item !== undefined).length > 1) return false
  if (row.snapshot !== undefined) return isServedFolderSnapshot(row.snapshot) && row.id === fsRecentKey(row.snapshot.sourceId, row.snapshot.path)
  if (row.localSnapshot !== undefined) return isLocalFolderCapture(row.localSnapshot) && row.id === fsRecentKey('ui-host', row.localSnapshot.connectionId)
  if (row.gitSnapshot !== undefined) return isLocalGitCapture(row.gitSnapshot) && row.id === fsRecentKey('ui-host', row.gitSnapshot.connectionId)
  return true
}

/** Additive validator for workspace folder records; old workspace rows remain valid. */
export function validWorkspaceFolders(workspaces: unknown): boolean {
  if (!Array.isArray(workspaces)) return false
  const ids = new Set<string>()
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return false
    const folders = (workspace as Record<string, unknown>).folders
    if (folders !== undefined) {
      if (!Array.isArray(folders)) return false
      const explicitIds = new Set<string>()
      for (const folder of folders) {
        if (!isWorkspaceFolder(folder) || explicitIds.has(folder.id)) return false
        explicitIds.add(folder.id)
      }
    }
    // One folder may have many legacy file rows inside its container, but its
    // source-qualified identity must never resolve to two workspace containers.
    for (const folder of workspaceFolders(workspace as Workspace)) {
      if (ids.has(folder.id)) return false
      ids.add(folder.id)
    }
  }
  return true
}

export function workspaceFolders(workspace: Workspace): WorkspaceFolder[] {
  const explicit = Array.isArray(workspace.folders) ? workspace.folders : []
  const seen = new Set(explicit.map((folder) => folder.id))
  const legacy = (Array.isArray(workspace.artifacts) ? workspace.artifacts : []).flatMap((artifact) => {
    const source = artifact?.source
    if (!source || typeof source.id !== 'string' || typeof source.label !== 'string' || seen.has(source.id)) return []
    seen.add(source.id)
    return [{ id: source.id, label: source.label }]
  })
  return [...explicit, ...legacy]
}

const artifactKind = (name: string): ArtifactKind => {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return 'image'
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return 'sheet'
  if (['key', 'ppt', 'pptx'].includes(ext)) return 'slide'
  return ext === 'eml' ? 'email' : 'doc'
}

export function workspaceArtifacts(workspace: Workspace): WorkspaceArtifact[] {
  const folders = workspaceFolders(workspace)
  const captured = new Set(folders.filter((folder) => folder.snapshot || folder.localSnapshot || folder.gitSnapshot).map((folder) => folder.id))
  const legacy = (Array.isArray(workspace.artifacts) ? workspace.artifacts : []).filter((artifact) => !artifact?.source || !captured.has(artifact.source.id))
  const projected = folders.flatMap((folder): WorkspaceArtifact[] => {
    const snapshot = folder.snapshot ?? folder.localSnapshot ?? folder.gitSnapshot
    if (!snapshot) return []
    return snapshot.files.map((file) => {
      const name = 'path' in file ? file.path : file.name
      const id = 'sourceId' in snapshot
        ? fsRecentKey(snapshot.sourceId, `${snapshot.path}/${name}`)
        : fsRecentKey('ui-host', `${snapshot.connectionId}/${name}`)
      return {
        id, name, kind: artifactKind(name), meta: `${file.sizeBytes} bytes`, source: { id: folder.id, label: folder.label },
        savedFolderSnapshot: file.snapshot, savedFolderSnapshotId: snapshot.snapshotId,
      }
    })
  })
  return [...legacy, ...projected]
}

/** All saved-copy kinds replace exactly one container and its derived rows. */
function replaceFolderSnapshot(workspace: Workspace, folderId: string, fallbackLabel: string,
  saved: Pick<WorkspaceFolder, 'snapshot' | 'localSnapshot' | 'gitSnapshot'>): Workspace {
  const folders = workspaceFolders(workspace)
  const old = folders.find((folder) => folder.id === folderId)
  const folder: WorkspaceFolder = { id: folderId, label: old?.label ?? fallbackLabel, ...saved }
  const artifacts = (workspace.artifacts ?? []).filter((artifact) => artifact?.source?.id !== folderId)
  const nextFolders = old
    ? folders.map((item) => item.id === folderId ? folder : item)
    : [...folders, folder]
  return { ...workspace, artifacts, folders: nextFolders }
}

/** Replace one folder's saved snapshot and drop its old live artifact projection. */
export function replaceServedFolderSnapshot(workspace: Workspace, folderId: string, snapshot: import('./servedFolderSnapshot.ts').ServedFolderSnapshot): Workspace {
  return replaceFolderSnapshot(workspace, folderId, snapshot.path.split('/').at(-1) ?? folderId, { snapshot })
}

/** Replace one local folder's saved copy, never introducing its native path. */
export function replaceLocalFolderSnapshot(workspace: Workspace, folderId: string, snapshot: LocalFolderCapture): Workspace {
  if (folderId !== fsRecentKey('ui-host', snapshot.connectionId)) throw new Error('Local folder snapshot identity mismatch.')
  return replaceFolderSnapshot(workspace, folderId, folderId, { localSnapshot: snapshot })
}

/** Replace one local Git saved copy, preserving the folder container identity. */
export function replaceLocalGitSnapshot(workspace: Workspace, folderId: string, snapshot: LocalGitCapture): Workspace {
  if (folderId !== fsRecentKey('ui-host', snapshot.connectionId)) throw new Error('Local Git snapshot identity mismatch.')
  return replaceFolderSnapshot(workspace, folderId, folderId, { gitSnapshot: snapshot })
}
