import type { Attachment } from '../../contract/entities.ts'
import type { SessionContextState } from '../../contract/api.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { documentFormatForName, type RefreshServedAttachmentRequest, type ServedTextSnapshot } from '../../contract/servedTextSnapshot.ts'
import { isServedImageFileName, isServedImageSnapshot, type ServedImageSnapshot } from '../../contract/servedImageSnapshot.ts'
import { attachmentSnapshotId } from '../../contract/attachmentInput.ts'
import { DRAFT_ID, workspaceOf } from '../data/liveSession.ts'
import type { ContextMutationIntent } from './contextMutationsCore.ts'

interface RefreshDependencies {
  assertCurrent(): void
  capture(source: string, path: string, requestId: string): Promise<ServedTextSnapshot | ServedImageSnapshot>
  refresh(sessionId: string, attachmentId: string, request: RefreshServedAttachmentRequest, expectedSessionUserId?: string | null): Promise<SessionContextState>
  reconcile(sessionId: string, signal: AbortSignal): Promise<SessionContextState>
}

/** One intent owns one successfully captured source copy. A lost acknowledgement
 * retries those exact bytes, while failed capture can be explicitly retried. */
export function createServedAttachmentRefreshIntent(sessionId: string, attachment: Attachment, requestId: string, deps: RefreshDependencies): ContextMutationIntent {
  const attachmentId = attachment.id
  const expectedSnapshotId = attachmentSnapshotId(attachment)
  let captured: ServedTextSnapshot | ServedImageSnapshot | undefined
  return {
    plan: ({ live, focus }) => ({ live, focus, operations: [], attachmentRefresh: { attachmentId, expectedSnapshotId, requestId } }),
    mutate: async ({ live }, _plan, expectedSessionUserId) => {
      deps.assertCurrent()
      const current = live.attachments.find((item) => item.id === attachmentId)
      if (!current || current.kind !== attachment.kind) throw new Error('This context is no longer attached.')
      const currentId = attachmentSnapshotId(current)
      if (currentId !== expectedSnapshotId && currentId !== requestId) throw new Error('This saved copy changed. Use saved state, then review it before refreshing again.')
      if (current.kind === 'artifact') {
        if (!expectedSnapshotId || !current.artifactSnapshot) throw new Error('There is no saved Artifact copy to refresh.')
        if (sessionId === DRAFT_ID) throw new Error('Send this conversation before refreshing its saved Artifact copy.')
        return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId }, expectedSessionUserId)
      }
      if (current.kind === 'discussion') {
        if (!expectedSnapshotId || !current.discussionSnapshot) throw new Error('There is no saved discussion copy to refresh.')
        if (sessionId === DRAFT_ID) throw new Error('Send this conversation before refreshing its saved discussion copy.')
        // Discussion Refresh is server-owned: only the target and its expected
        // snapshot receipt cross the API boundary. No source lookup or prose
        // capture runs in the renderer.
        return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId }, expectedSessionUserId)
      }
      const source = parseFsRecentKey(attachmentId)
      if (!source || current.source?.id !== source.sourceId ||
          current.source.kind !== (source.sourceId === 'cloud' ? 'cloud' : 'runner')) throw new Error('This served file is no longer attached.')
      if (sessionId !== DRAFT_ID && !documentFormatForName(source.entryId) && !isServedImageFileName(source.entryId)) {
        return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId }, expectedSessionUserId)
      }
      captured ??= await deps.capture(source.sourceId, source.entryId, requestId)
      deps.assertCurrent()
      if (sessionId !== DRAFT_ID) {
        if (isServedImageSnapshot(captured)) {
          return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId, imageSnapshot: captured }, expectedSessionUserId)
        }
        if (captured.version !== 2) throw new Error('The document capture is invalid. The saved copy is unchanged.')
        return deps.refresh(sessionId, attachmentId, { expectedSnapshotId, requestId, snapshot: captured }, expectedSessionUserId)
      }
      const { previewText: _preview, previewUrl: _url, documentImport: _import, image: _image, textSnapshot: _text, imageSnapshot: _snapshot, ...metadata } = current
      return { contexts: [], workspace: { ...workspaceOf(live), attachments: live.attachments.map((item) => item.id === attachmentId
        ? { ...metadata, ...(isServedImageSnapshot(captured) ? { imageSnapshot: captured } : { textSnapshot: captured }) } : item) } }
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
