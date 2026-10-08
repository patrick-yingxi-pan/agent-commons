import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import { useConversationDownload } from '../controller/useConversationDownload.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS, dialogReadRegionProps } from '../lib/dialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

export function ConversationDownload({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const downloadRef = useRef<HTMLButtonElement>(null)
  const { download, busy, notice } = useConversationDownload(sessionId)
  useFocusTrap(dialogRef, onClose, { initialFocus: downloadRef })
  useBoundedDialog(dialogRef)

  return createPortal(<div role="dialog" aria-modal="true" aria-label="Download conversation"
    className={BOUNDED_DIALOG_LAYER_CLASS} onMouseDown={onClose}>
    <div className={SCRIM_CLASS} />
    <div ref={dialogRef} data-bounded-dialog="conversation-download" onMouseDown={(event) => event.stopPropagation()}
      className={`w-[460px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <Download size={17} className="shrink-0 text-ink-soft" />
        <h2 className="min-w-0 flex-1 font-serif text-[15px] font-semibold text-ink">Download conversation</h2>
        <button type="button" aria-label="Close download" onClick={onClose} className="shrink-0 rounded-md p-1 text-ink-soft hover:bg-panel-2"><X size={16} /></button>
      </div>
      <div {...dialogReadRegionProps('Download details')} className={`${BOUNDED_DIALOG_BODY_CLASS} space-y-3 px-4 py-4 text-[13px] leading-relaxed text-ink-soft`}>
        <p>Take a readable Markdown copy of saved user and assistant messages, including retained compacted originals. Message text is preserved in literal blocks; archived and current messages are labeled separately.</p>
        <p>Attachments, tool details, and private context aren’t included. Unsent text isn’t included. Complete downloads are limited to 8 MiB.</p>
        <p>Once downloaded, the file is outside this conversation’s sharing controls.</p>
        {notice && <p role={notice.tone} aria-atomic="true" className="text-ink">{notice.message}</p>}
        {busy && <p role="status">Preparing Markdown…</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`} onClick={onClose}>Close</button>
        <button ref={downloadRef} type="button" disabled={busy} onClick={() => void download()}
          className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`}>Download Markdown</button>
      </div>
    </div>
  </div>, document.body)
}
