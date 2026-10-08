import { ExternalLink, FileText, RefreshCw, Trash2 } from 'lucide-react'
import type { Attachment } from '../types'
import type { AttachmentInputStatus } from '../../contract/attachmentInput'
import { artifactSnapshotText } from '../../contract/artifactSnapshot'
import { PanelShell } from './PanelShell'
import { SavedArtifactBodyView } from './artifactPreview'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'

const noop = () => {}

/** Only saved content is rendered. Following the source and replacing this
 * copy are separate, explicit acts governed by the destination controller. */
export function ArtifactContextPanel({ attachment, onRefresh, onRemove, onOpenSource, busy = false, onClose = noop, inputStatus }: {
  attachment: Attachment
  onRefresh?: (attachment: Attachment) => void
  onRemove?: (id: string) => void
  onOpenSource?: (artifactId: string) => void
  busy?: boolean
  onClose?: () => void
  inputStatus?: AttachmentInputStatus
}) {
  const snapshot = attachment.artifactSnapshot
  const headerRight = <>
    {onRefresh && snapshot && <button type="button" disabled={busy} title={busy ? 'Wait for this context action to finish' : 'Replace this copy with the current readable source'} onClick={() => onRefresh(attachment)} className={`${SECONDARY_BUTTON_CLASS} inline-flex items-center gap-1 px-2 py-1 text-[11px]`}><RefreshCw size={12} />Refresh copy</button>}
    {onRemove && <button type="button" disabled={busy} onClick={() => onRemove(attachment.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-50" aria-label="Remove Artifact context" title={busy ? 'Wait for this context action to finish' : 'Remove Artifact context'}><Trash2 size={14} /></button>}
  </>
  return <PanelShell icon={<FileText size={15} className="text-ink-faint" />} title={attachment.label} headerRight={headerRight} onClose={onClose}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-panel p-3" data-artifact-context-panel data-artifact-context-id={attachment.id}>
      {snapshot ? <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-faint">
          <span>Saved Artifact copy · revision {snapshot.revision} · {new Date(snapshot.capturedAt).toLocaleString()}</span>
          {onOpenSource && <button type="button" onClick={() => onOpenSource(snapshot.artifactId)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-soft transition hover:bg-panel-2 hover:text-ink"><ExternalLink size={12} />View source Artifact</button>}
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">This saved copy does not update live. Refresh checks source access again. Everyone with access to this conversation can read the copy, even if source access is later revoked.</p>
        {inputStatus && inputStatus !== 'ready' && <p role="status" className="rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink-soft">Not sent as model input. {inputStatus === 'total-limit' || inputStatus === 'item-limit' ? 'This turn’s attachment limit is reached. Remove other attachments to include this copy.' : 'This copy is unavailable within the input limits. Refresh it or attach the Artifact again.'}</p>}
        <div role="region" aria-label="Saved Artifact content" tabIndex={0} className="min-h-48 min-w-0 overflow-auto rounded-lg border border-line bg-surface p-3" data-artifact-context-content>
          <SavedArtifactBodyView body={snapshot.body} name={snapshot.title} />
        </div>
        <details className="text-[12px] text-ink-soft">
          <summary className="cursor-pointer rounded-md py-1">Exact reference text and data</summary>
          <textarea aria-label="Saved Artifact reference data" readOnly value={artifactSnapshotText(snapshot)} className="mt-2 min-h-40 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink" />
        </details>
      </> : attachment.artifactCaptureId ? <div className="rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed text-ink-soft">
        <p className="font-medium text-ink">Artifact copy queued for this draft</p>
        <p className="mt-1">The saved copy will be captured on the first send, after checking that you can still read the source. No source content is copied into the draft yet.</p>
      </div> : <p className="rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed text-ink-soft">No saved Artifact copy is available. Nothing is fetched from the source when this panel opens.</p>}
    </div>
  </PanelShell>
}
