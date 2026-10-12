import { lazy, Suspense, type ComponentProps, useRef } from 'react'
import { GitPullRequest, X } from 'lucide-react'
import type { AgentProposalsReviewDialog } from './AgentProposalsReviewDialog.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'

const Dialog = lazy(() => import('./AgentProposalsReviewDialog.tsx').then((module) => ({ default: module.AgentProposalsReviewDialog })))
type Props = ComponentProps<typeof AgentProposalsReviewDialog>

function LoadState({ failed = false, onClose, label }: { failed?: boolean; onClose: () => void; label: string }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, onClose)
  useBoundedDialog(dialogRef)
  return <div className={BOUNDED_DIALOG_LAYER_CLASS} onMouseDown={onClose}
    role="dialog" aria-modal="true" aria-label={`Proposals — ${label}`}>
    <div className={SCRIM_CLASS} />
    <div ref={dialogRef} data-bounded-dialog="resource-form" onMouseDown={(event) => event.stopPropagation()}
      className={`w-[640px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <GitPullRequest size={16} className="shrink-0 text-ink-faint" />
        <span style={{ overflowWrap: 'anywhere' }} className="min-w-0 flex-1 text-[15px] font-semibold text-ink">Proposals — {label}</span>
        <button onClick={onClose} aria-label="Close" className="text-ink-faint transition hover:text-ink"><X size={16} /></button>
      </div>
      <div className={`${BOUNDED_DIALOG_BODY_CLASS} space-y-2 p-4 text-[12px] text-ink-soft`} role={failed ? 'alert' : 'status'}
        data-agent-proposal-review-load={failed ? 'failed' : 'loading'}>
        {failed ? <>
          <p>The proposal review couldn’t be loaded. No decision was made.</p>
          <p>Copy unsent workspace text before reloading, then review the latest proposal.</p>
          <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[12px]`}
            onClick={() => window.location.reload()}>Reload proposal review</button>
        </> : <p>Loading proposal review…</p>}
      </div>
    </div>
  </div>
}

/** The review queue is conditional owner content. Loading and failure expose no
 * decision controls; once loaded the established review dialog owns the actions. */
export function DeferredAgentProposalsReviewDialog(props: Props) {
  return <DeferredLoadBoundary fallback={<LoadState failed onClose={props.onClose} label={props.agent.label} />}>
    <Suspense fallback={<LoadState onClose={props.onClose} label={props.agent.label} />}>
      <Dialog {...props} />
    </Suspense>
  </DeferredLoadBoundary>
}
