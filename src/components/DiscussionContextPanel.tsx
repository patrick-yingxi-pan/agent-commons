import { ExternalLink, MessageSquare, RefreshCw, Trash2 } from 'lucide-react'
import type { Attachment } from '../types'
import type { AttachmentInputStatus } from '../../contract/attachmentInput'
import { PanelShell } from './PanelShell'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'

const noop = () => {}

/** Displays only the immutable saved reference. Rendering this panel never
 *  resolves the source discussion; Refresh is an explicit owner callback. */
export function DiscussionContextPanel({
  attachment,
  onRefresh,
  onRemove,
  onOpenSource,
  busy = false,
  onClose = noop,
  inputStatus,
}: {
  attachment: Attachment
  onRefresh?: (attachment: Attachment) => void
  onRemove?: (id: string) => void
  onOpenSource?: (discussionId: string) => void
  busy?: boolean
  onClose?: () => void
  inputStatus?: AttachmentInputStatus
}) {
  const snapshot = attachment.discussionSnapshot
  const isDeferredDraft = !snapshot && !!attachment.discussionCaptureId
  const headerRight = (
    <>
      {onRefresh && snapshot && (
        <button type="button" disabled={busy} onClick={() => onRefresh(attachment)} className={`${SECONDARY_BUTTON_CLASS} inline-flex items-center gap-1 px-2 py-1 text-[11px]`}>
          <RefreshCw size={12} />Refresh copy
        </button>
      )}
      {onRemove && (
        <button type="button" disabled={busy} onClick={() => onRemove(attachment.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-50" aria-label="Remove discussion context" title="Remove discussion context">
          <Trash2 size={14} />
        </button>
      )}
    </>
  )

  return (
    <PanelShell
      icon={<MessageSquare size={15} className="text-ink-faint" />}
      title={attachment.label}
      count={snapshot?.postCount}
      headerRight={headerRight}
      onClose={onClose}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-panel p-3" data-discussion-context-panel>
        {snapshot ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-faint">
              <span>Saved copy · {formatCapturedAt(snapshot.capturedAt)} · {snapshot.postCount} {snapshot.postCount === 1 ? 'post' : 'posts'}</span>
              {onOpenSource && <button type="button" onClick={() => onOpenSource(snapshot.discussionId)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-soft transition hover:bg-panel-2 hover:text-ink"><ExternalLink size={12} />Open source</button>}
            </div>
            <textarea
              aria-label="Saved discussion copy"
              readOnly
              value={snapshot.text}
              className="min-h-48 w-full flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none"
            />
            <p className="text-[11px] leading-relaxed text-ink-faint">This is a saved copy. It does not update when the source changes; refreshing checks that you can still read the source. Everyone with access to this conversation can read this copy.</p>
            {inputStatus && inputStatus !== 'ready' && <p role="status" className="rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink-soft">Not sent as model input. {inputStatus === 'total-limit' || inputStatus === 'item-limit' ? 'This turn’s attachment limit is reached. Remove other attachments to include this copy.' : 'This copy is unavailable within the input limits. Refresh it or attach the discussion again.'}</p>}
          </>
        ) : isDeferredDraft ? (
          <div className="rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed text-ink-soft">
            <p className="font-medium text-ink">Discussion copy queued for this draft</p>
            <p className="mt-1">The saved copy will be captured on the first send, after checking that you can still read the source. No source content is copied into the draft yet.</p>
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed text-ink-soft">No saved discussion copy is available. Nothing is fetched from the source when this panel opens.</p>
        )}
      </div>
    </PanelShell>
  )
}

function formatCapturedAt(value: string | number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'capture time unavailable' : `captured ${date.toLocaleString()}`
}
