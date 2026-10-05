import type { WorkspaceFolder } from '../../contract/entities.ts'
import type { LocalFolderCapture } from '../../contract/localFolderCapture.ts'
import { replaceLocalFolderSnapshot, workspaceFolders } from '../../contract/workspaceFolders.ts'
import { captureLocalFolder, captureLocalFolderSource } from '../api/localFolders.ts'
import { refreshLocalSessionFolder } from '../api/localFolderCommands.ts'
import { loadSession } from '../api/commands.ts'
import { DRAFT_ID, workspaceOf } from '../data/liveSession.ts'
import { enqueueContextMutation } from './contextMutations.ts'

/** Capture once per logical Refresh; lost acknowledgements retry those exact
 * bytes. Source reads are not repeated by reconciliation or by model turns. */
export function refreshLocalFolder(sessionId: string, folder: WorkspaceFolder) {
  const connectionId = folder.localSnapshot?.connectionId
  if (!connectionId) throw new Error('Choose this folder again to create a refreshable connection.')
  const identity = captureLocalFolderSource()
  const expectedSnapshotId = folder.localSnapshot!.snapshotId
  const requestId = crypto.randomUUID()
  let captured: LocalFolderCapture | undefined
  return enqueueContextMutation(sessionId, {
    plan: ({ live, focus }) => ({ live, focus, operations: [], folderRefresh: { kind: 'local', folderId: folder.id, expectedSnapshotId, requestId } }),
    mutate: async ({ live }) => {
      identity.assertCurrent()
      const current = live.workspaces.flatMap(workspaceFolders).find(item => item.id === folder.id)
      const currentId = current?.localSnapshot?.snapshotId
      if (!current || (currentId !== expectedSnapshotId && currentId !== requestId)) throw new Error('This saved folder changed. Use saved state, then review it before refreshing again.')
      captured ??= await captureLocalFolder(connectionId, requestId)
      identity.assertCurrent()
      if (sessionId !== DRAFT_ID) return refreshLocalSessionFolder(sessionId, folder.id, { expectedSnapshotId, requestId, snapshot: captured }, identity)
      return { contexts: [], workspace: { ...workspaceOf(live), workspaces: live.workspaces.map(workspace => workspaceFolders(workspace).some(item => item.id === folder.id)
        ? replaceLocalFolderSnapshot(workspace, folder.id, captured!) : workspace) } }
    },
    reconcile: async ({ live }, signal) => {
      identity.assertCurrent()
      if (sessionId === DRAFT_ID) return { contexts: [], workspace: workspaceOf(live) }
      const session = await loadSession(sessionId, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
      identity.assertCurrent()
      if (!session.workspace) throw new Error('The current saved context is unavailable.')
      return { contexts: session.contexts ?? [], workspace: session.workspace }
    },
  })
}
