/** The development runner's fixed host mapping, shared by invocation and source
 * browsing. Changing a grant narrows access; it never rebinds a physical root. */
import type { Runner } from '../contract/index.ts'
import type { FolderSnapshotFile } from '../contract/localFolderSnapshot.mjs'
import { folderSnapshotPermitted, fsReader, type FsReader, type FolderSnapshotAccess } from './fs.ts'
import { RUNNER_FS_BINDINGS } from './data/runners.ts'
import { isGranted, scopeMatches } from './runnerScopes.ts'

type FsCapability = 'fs.read' | 'fs.list'
// One reader per configured binding for this service lifetime, never per request.
const bindings = new Map(Object.entries(RUNNER_FS_BINDINGS).map(([id, binding]) =>
  [id, { scope: binding.scope, reader: fsReader(binding.root) }] as const))

export function runnerFs(runner: Runner) {
  const binding = bindings.get(runner.id)
  if (!binding) return undefined
  const { scope, reader: base } = binding
  const logicalPath = (path: string) => path ? `${scope}/${path}` : scope
  const permits = (capability: FsCapability, path: string) => isGranted(runner, capability, logicalPath(path))
  // Ancestors of explicit list grants are navigation only: expose the granted
  // branch, never sibling names or files. Reads still require the exact grant.
  const browsable = (path: string) => runner.capabilities.find((cap) => cap.type === 'fs.list')?.scopes
    .some((grant) => scopeMatches(grant, logicalPath(path)) || scopeMatches(logicalPath(path), grant)) ?? false
  const supports = (capability: FsCapability) => runner.capabilities.find((cap) => cap.type === capability)?.scopes.some((grant) =>
    scopeMatches(grant, scope) || scopeMatches(scope, grant)) ?? false
  const snapshotAccess: FolderSnapshotAccess = {
    canList: (entry) => permits('fs.list', entry),
    canRead: (entry) => permits('fs.read', entry),
  }
  // Authority-only: a caller can re-resolve the current registry after an await
  // without rereading the source or trusting an obsolete Runner object.
  const permitsFolderSnapshot = (path: string, files: FolderSnapshotFile[]) =>
    browsable(path) && supports('fs.read') && folderSnapshotPermitted(path, files, snapshotAccess)
  const reader: FsReader = {
    root: base.root,
    list() {
      if (!browsable('')) return { files: [], photos: [], folders: [] }
      const catalog = base.list()
      if (!catalog) return undefined
      const folders = []
      for (const entry of catalog.folders.filter((entry) => browsable(entry.id))) {
        const folder = reader.folderContents(entry.id)
        if (!folder) return undefined
        folders.push({ ...entry, fileCount: folder.artifacts.length })
      }
      return {
        files: catalog.files.filter((entry) => permits('fs.list', entry.id)),
        photos: catalog.photos.filter((entry) => permits('fs.list', entry.id)),
        folders,
      }
    },
    folderContents(path) {
      if (!browsable(path)) return undefined
      const folder = base.folderContents(path)
      if (!folder) return undefined
      const artifacts = folder.artifacts.filter((entry) => permits('fs.list', entry.id))
      return { ...folder, artifacts, meta: `${artifacts.length} file${artifacts.length === 1 ? '' : 's'}` }
    },
    async folderSnapshot(path) {
      if (!browsable(path) || !supports('fs.read')) return undefined
      // Never forward caller-supplied access predicates: this facade owns the
      // runner wall, including filtering names before budget selection/reads.
      const snapshot = await base.folderSnapshot(path, snapshotAccess)
      // The base check predates this await continuation. Narrowing here must
      // not publish a captured name/body merely because some other grant remains.
      return snapshot && permitsFolderSnapshot(path, snapshot)
        ? snapshot : undefined
    },
    readText: (path) => permits('fs.read', path) ? base.readText(path) : undefined,
    readSnapshot: (path) => permits('fs.read', path) ? base.readSnapshot(path) : undefined,
    readBytes: (path) => permits('fs.read', path) ? base.readBytes(path) : undefined,
  }
  return {
    reader,
    supports,
    /** Check the current registry grant for one exact logical file without
     * reading that file's bytes. Served-document Refresh uses this after the
     * renderer has already imported and frozen its saved text. */
    permitsRead: (path: string) => permits('fs.read', path),
    permitsFolderSnapshot,
    relativeTarget(target: string): string | undefined {
      if (target === scope) return ''
      return target.startsWith(`${scope}/`) ? target.slice(scope.length + 1) : undefined
    },
  }
}
