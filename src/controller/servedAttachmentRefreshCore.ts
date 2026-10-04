import type { SessionContextState } from '../../contract/api.ts'
import { parseFsRecentKey } from '../../contract/fs.ts'
import { type Live } from '../data/liveSession.ts'

export interface ServedAttachmentRefreshTarget {
  attachmentId: string
  expectedSnapshotId: string | null
  requestId: string
  /** Reconciliation reads canonical truth; a mutation acknowledgement must
   * prove this exact request id before it can update the local projection. */
  reconciled?: boolean
  /** Snapshot present when the read-only reconciliation began. A late read may
   * not overwrite a newer local attachment state. */
  baselineSnapshotId?: string | null
}

/** Merge only one refresh target. A late reply cannot resurrect a detached
 * attachment, replace a locally newer snapshot, or rewind another live field. */
export function mergeServedAttachmentRefresh(
  current: Live,
  returned: SessionContextState,
  target: ServedAttachmentRefreshTarget,
): Live {
  const attached = current.attachments.find((item) => item.id === target.attachmentId)
  if (!attached) return current
  const currentSnapshotId = attached.textSnapshot?.snapshotId ?? null
  if (target.reconciled === true) {
    if (currentSnapshotId !== target.baselineSnapshotId) return current
  } else if (currentSnapshotId !== target.expectedSnapshotId && currentSnapshotId !== target.requestId) return current

  const source = parseFsRecentKey(target.attachmentId)
  if (!source || attached.source?.id !== source.sourceId) return current
  const canonical = returned.workspace.attachments.find((item) => item.id === target.attachmentId)
  if (!canonical) {
    return target.reconciled === true
      ? { ...current, attachments: current.attachments.filter((item) => item.id !== target.attachmentId) }
      : current
  }
  if (canonical.source?.id !== source.sourceId || canonical.source.kind === 'ui-host') return current
  const snapshot = canonical.textSnapshot
  if (snapshot && (snapshot.sourceId !== source.sourceId || snapshot.path !== source.entryId)) return current
  if (target.reconciled !== true && snapshot?.snapshotId !== target.requestId) return current

  return {
    ...current,
    attachments: current.attachments.map((item) => {
      if (item.id !== target.attachmentId) return item
      const { textSnapshot: _oldSnapshot, ...metadata } = item
      if (!snapshot) return metadata
      const { previewText: _preview, documentImport: _import, ...savedMetadata } = metadata
      return { ...savedMetadata, textSnapshot: snapshot }
    }),
  }
}
