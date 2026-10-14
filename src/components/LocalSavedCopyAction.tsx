import { useLocalGitSavedCopyFailed, useLocalGitSavedCopyPending } from '../controller/localGitSavedCopies.ts'
import type { LocalSavedCopySourceKind } from '../controller/localGitSavedCopiesCore.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { localFileSavedCopy } from '../controller/localFileSavedCopy.ts'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { SOFT_BUTTON_CLASS } from '../lib/button.ts'

export function LocalSavedCopyAction({
  source, connectionId, intentScope, receipt, preview, disabled, isAttached, isCurrent, subscribeCurrent, onAttach,
  actionLabel = 'Attach saved copy', pendingLabel = 'Saving saved copy…',
}: {
  source: LocalSavedCopySourceKind
  connectionId: string
  intentScope: string
  receipt: number
  preview: LocalBrowsePreview
  disabled: boolean
  isAttached: boolean
  isCurrent: (receipt: number) => boolean
  subscribeCurrent: (listener: () => void) => () => void
  onAttach: (file: PreparedLocalFileSavedCopy) => void | Promise<unknown>
  actionLabel?: string
  pendingLabel?: string
}) {
  const pending = useLocalGitSavedCopyPending(intentScope, connectionId, receipt, source)
  const failed = useLocalGitSavedCopyFailed(intentScope, connectionId, receipt, source)
  const attachable = ('image' in preview.snapshot && !!preview.snapshot.image) ||
    ('text' in preview.snapshot && typeof preview.snapshot.text === 'string')
  if (!attachable) return null
  const attachWaiting = pending
  const attach = () => {
    if (disabled || !isCurrent(receipt) || isAttached || attachWaiting) return
    void localFileSavedCopy.submit({
      scope: intentScope,
      connectionId,
      receipt,
      sourceKind: source,
      preview,
      isCurrent: () => isCurrent(receipt),
      subscribeCurrent,
      onAttach,
    }).catch(() => { /* the shared receipt registry exposes failure across remounts */ })
  }
  return <>
    <button type="button" disabled={disabled || attachWaiting || isAttached} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
      onClick={attach}>{isAttached ? 'Added' : attachWaiting ? pendingLabel : actionLabel}</button>
    {failed && <p role="alert" className="text-[12px] text-danger-text">Could not confirm this saved copy. Check the context update before trying again.</p>}
  </>
}
