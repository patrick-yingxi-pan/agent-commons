import type { Attachment } from '../../contract/entities.ts'
import { documentFormatForName } from '../../contract/servedTextSnapshot.ts'
import { accountGeneration } from '../api/account.ts'
import { readFsSnapshot } from '../api/fsReads.ts'
import { refreshSessionAttachment } from '../api/servedAttachmentCommands.ts'
import { loadSession } from '../api/commands.ts'
import { enqueueContextMutation } from './contextMutations.ts'
import { createServedAttachmentRefreshIntent } from './servedAttachmentRefreshIntent.ts'

/** The same exact-target, acknowledgement-owned Refresh for every panel tier. */
export function refreshServedAttachment(sessionId: string, attachment: Attachment) {
  const generation = accountGeneration()
  const assertCurrent = () => {
    if (generation !== accountGeneration()) throw new Error('Your account changed. Nothing was saved.')
  }
  return enqueueContextMutation(sessionId, createServedAttachmentRefreshIntent(sessionId, attachment, crypto.randomUUID(), {
    assertCurrent,
    capture: async (source, path, requestId) => {
      if (documentFormatForName(path)) {
        const { captureServedDocument } = await import('./servedDocumentCapture.ts')
        // Loading a parser boundary can outlive the account that requested it.
        assertCurrent()
        return captureServedDocument(source, path, requestId)
      }
      assertCurrent()
      return { ...await readFsSnapshot(source, path), snapshotId: requestId }
    },
    refresh: refreshSessionAttachment,
    reconcile: async (id, signal) => {
      const session = await loadSession(id, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
      if (!session.workspace) throw new Error('The current saved context is unavailable.')
      return { contexts: session.contexts ?? [], workspace: session.workspace }
    },
  }))
}
