import type { Attachment } from '../../contract/entities.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { readFsSnapshot } from '../api/fsReads.ts'
import { refreshSessionAttachment } from '../api/servedAttachmentCommands.ts'
import { loadSession } from '../api/commands.ts'
import { DRAFT_ID, workspaceOf } from '../data/liveSession.ts'
import { enqueueContextMutation } from './contextMutations.ts'

/** The same exact-target, acknowledgement-owned Refresh for every panel tier. */
export function refreshServedAttachment(sessionId: string, attachment: Attachment) {
  const attachmentId = attachment.id
  const expectedSnapshotId = attachment.textSnapshot?.snapshotId ?? null
  const requestId = crypto.randomUUID()
  return enqueueContextMutation(sessionId, {
    plan: ({ live, focus }) => ({
      live, focus, operations: [],
      attachmentRefresh: { attachmentId, expectedSnapshotId, requestId },
    }),
    mutate: async ({ live }) => {
      const current = live.attachments.find((item) => item.id === attachmentId)
      const source = parseFsRecentKey(attachmentId)
      if (!current || !source || current.source?.id !== source.sourceId ||
          current.source.kind !== (source.sourceId === 'cloud' ? 'cloud' : 'runner')) throw new Error('This served file is no longer attached.')
      if (sessionId !== DRAFT_ID) {
        return refreshSessionAttachment(sessionId, attachmentId, { expectedSnapshotId, requestId })
      }
      if ((current.textSnapshot?.snapshotId ?? null) !== expectedSnapshotId) throw new Error('This saved copy changed. Reopen it before refreshing.')
      const snapshot = await readFsSnapshot(source.sourceId, source.entryId)
      const { previewText: _preview, documentImport: _import, ...metadata } = current
      return {
        contexts: [],
        workspace: { ...workspaceOf(live), attachments: live.attachments.map((item) => item.id === attachmentId
          ? { ...metadata, textSnapshot: { ...snapshot, snapshotId: requestId } } : item) },
      }
    },
    reconcile: async ({ live }, signal) => {
      if (sessionId === DRAFT_ID) return { contexts: [], workspace: workspaceOf(live) }
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      const session = await loadSession(sessionId, boundedSignal)
      if (!session.workspace) throw new Error('The current saved context is unavailable.')
      return {
        contexts: session.contexts ?? [],
        workspace: session.workspace,
      }
    },
  })
}
