import type { Attachment } from '../../contract/entities.ts'
import type { SessionContextState } from '../../contract/api.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { documentFormatForName, type RefreshServedAttachmentRequest, type ServedTextSnapshot } from '../../contract/servedTextSnapshot.ts'
import { DRAFT_ID, workspaceOf } from '../data/liveSession.ts'
import type { ContextMutationIntent } from './contextMutationsCore.ts'

interface RefreshDependencies {
  assertCurrent(): void
  capture(source: string, path: string, requestId: string): Promise<ServedTextSnapshot>
  refresh(sessionId: string, attachmentId: string, request: RefreshServedAttachmentRequest, expectedSessionUserId?: string | null): Promise<SessionContextState>
  reconcile(sessionId: string, signal: AbortSignal): Promise<SessionContextState>
}

/** One intent owns one successfully captured document. A lost acknowledgement
 * retries those exact bytes, while failed capture can be explicitly retried. */
export function createServedAttachmentRefreshIntent(sessionId: string, attachment: Attachment, requestId: string, deps: RefreshDependencies): ContextMutationIntent {
  const attachmentId = attachment.id
  const expectedSnapshotId = attachment.textSnapshot?.snapshotId ?? null
  let captured: ServedTextSnapshot | undefined
  return {
    plan: ({ live, focus }) => ({ live, focus, operations: [], attachmentRefresh: { attachmentId, expectedSnapshotId, requestId } }),
    mutate: async ({ live }, _plan, expectedSessionUserId) => {
      deps.assertCurrent()
      const current = live.attachments.find((item) => item.id === attachmentId)
      const source = parseFsRecentKey(attachmentId)
      if (!current || !source || current.source?.id !== source.sourceId ||
          current.source.kind !== (source.sourceId === 'cloud' ? 'cloud' : 'runner')) throw new Error('This served file is no longer attached.')
      const currentId = current.textSnapshot?.snapshotId ?? null
      if (currentId !== expectedSnapshotId && currentId !== requestId) throw new Error('This saved copy changed. Use saved state, then review it before refreshing again.')
      if (sessionId !== DRAFT_ID && !documentFormatForName(source.entryId)) {
        return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId }, expectedSessionUserId)
      }
      captured ??= await deps.capture(source.sourceId, source.entryId, requestId)
      deps.assertCurrent()
      if (sessionId !== DRAFT_ID) {
        if (captured.version !== 2) throw new Error('The document capture is invalid. The saved copy is unchanged.')
        return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId, snapshot: captured }, expectedSessionUserId)
      }
      const { previewText: _preview, documentImport: _import, ...metadata } = current
      return { contexts: [], workspace: { ...workspaceOf(live), attachments: live.attachments.map((item) => item.id === attachmentId
        ? { ...metadata, textSnapshot: captured } : item) } }
    },
    reconcile: async ({ live }, signal) => {
      deps.assertCurrent()
      if (sessionId === DRAFT_ID) return { contexts: [], workspace: workspaceOf(live) }
      const state = await deps.reconcile(sessionId, signal)
      deps.assertCurrent()
      return state
    },
  }
}
