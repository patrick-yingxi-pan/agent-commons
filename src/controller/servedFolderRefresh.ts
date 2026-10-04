import type { WorkspaceFolder } from '../../contract/entities.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { isServedPath, isServedSourceId } from '../../contract/servedTextSnapshot.ts'
import { replaceServedFolderSnapshot, workspaceFolders } from '../../contract/workspaceFolders.ts'
import { readFsFolderSnapshot } from '../api/fsReads.ts'
import { refreshSessionFolder } from '../api/servedFolderCommands.ts'
import { loadSession } from '../api/commands.ts'
import { DRAFT_ID, workspaceOf } from '../data/liveSession.ts'
import { enqueueContextMutation } from './contextMutations.ts'

/** Explicitly save/refresh one served folder. The request identity stays fixed
 * through the queue's retry and read-only reconciliation lifecycle. */
export function refreshServedFolder(sessionId: string, folder: WorkspaceFolder) {
  const folderId = folder.id
  const address = parseFsRecentKey(folderId)
  if (!address || !isServedSourceId(address.sourceId) || !isServedPath(address.entryId)) {
    throw new Error('This folder cannot be saved from its current source.')
  }
  const expectedSnapshotId = folder.snapshot?.snapshotId ?? null
  const requestId = crypto.randomUUID()
  return enqueueContextMutation(sessionId, {
    plan: ({ live, focus }) => ({
      live, focus, operations: [],
      folderRefresh: { folderId, expectedSnapshotId, requestId },
    }),
    mutate: async ({ live }) => {
      const current = live.workspaces.flatMap((workspace) => workspaceFolders(workspace))
        .find((candidate) => candidate.id === folderId)
      const currentSnapshotId = current?.snapshot?.snapshotId ?? null
      const alreadyCommitted = sessionId !== DRAFT_ID && currentSnapshotId === requestId
      if (!current || (currentSnapshotId !== expectedSnapshotId && !alreadyCommitted)) {
        throw new Error('This folder changed. Reopen it before saving again.')
      }
      if (sessionId !== DRAFT_ID) {
        return refreshSessionFolder(sessionId, folderId, { expectedSnapshotId, requestId })
      }
      const snapshot = await readFsFolderSnapshot(address.sourceId, address.entryId)
      const refreshed = { ...snapshot, snapshotId: requestId }
      return {
        contexts: [],
        workspace: {
          ...workspaceOf(live),
          workspaces: live.workspaces.map((workspace) => workspaceFolders(workspace).some((item) => item.id === folderId)
            ? replaceServedFolderSnapshot(workspace, folderId, refreshed) : workspace),
        },
      }
    },
    reconcile: async ({ live }, signal) => {
      // Drafts have no persisted authority; reconciliation only releases the
      // failed intent against current local state and never rereads the source.
      if (sessionId === DRAFT_ID) return { contexts: [], workspace: workspaceOf(live) }
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      const session = await loadSession(sessionId, boundedSignal)
      if (!session.workspace) throw new Error('The current saved context is unavailable.')
      return { contexts: session.contexts ?? [], workspace: session.workspace }
    },
  })
}
