/** The empty conversation surface — the draft's "What should we work on?"
 *  invitation (with the FWD-1 pre-attach launcher) and the reopened-empty
 *  session's quieter variant. ONE component for every conversation host
 *  (the singleton surface and every split pane) — a draft must look the same
 *  wherever it renders (homogeneity, universal split Phase 6). */
import { AddContextButton } from './AddContextButton'
import { Cpu } from 'lucide-react'
import type { Live } from '../data/liveSession'
import type { AddedContext } from '../types'
import { PAGE_ACTION_BUTTON_CLASS } from '../lib/button'

export function EmptyState({
  mode,
  live,
  onNewSessionWith,
  onOpenModelSetup,
}: {
  mode: 'draft' | 'empty'
  /** The draft's live context (drives the launcher's "Added" ticks). Draft mode only. */
  live?: Live
  /** Start a new chat with a context pre-attached (FWD-1). Draft mode only. */
  onNewSessionWith?: (ctx: AddedContext) => void
  /** A resolved provider registry has no runnable entry. Opens the one Models
   * setup surface through this pane's normal, back-carrying navigation door. */
  onOpenModelSetup?: () => void
}) {
  if (mode === 'draft') {
    if (onOpenModelSetup) {
      return (
        <div className="flex h-full flex-col items-center justify-center px-4 py-6 text-center" data-model-setup>
          <div className="w-full max-w-md rounded-xl border border-line bg-panel px-5 py-5 text-left sm:px-6 sm:py-6">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-tint text-accent-strong">
              <Cpu size={18} aria-hidden />
            </div>
            <h2 className="font-serif text-xl font-semibold text-ink">Connect a model to begin</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
              Add a Messages API endpoint or connect one of your own AI sessions. Where secure device storage is
              available, API keys stay encrypted outside your workspace data.
            </p>
            <button
              type="button"
              onClick={onOpenModelSetup}
              className={`mt-5 ${PAGE_ACTION_BUTTON_CLASS}`}
            >
              Connect a model
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              After a connection is verified, this untouched draft reopens ready for your first message.
            </p>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <h2 className="font-serif text-xl font-semibold text-ink">What should we work on?</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            Start typing below. Attach a folder, a repo, or a connector and this one session grows a
            workspace or a code panel as the work needs it — no tabs, no lost context.
          </p>
          {live && onNewSessionWith && (
            // Pre-attached entry shortcuts (FWD-1): start this thread already holding a
            // repo / folder / connector — the old per-mode "New Code/Cowork" entries as
            // shortcuts, not tabs. Reuses the one attach funnel + picker.
            <div className="mt-4 flex justify-center">
              <AddContextButton
                variant="inline"
                label="Start with a repo, folder, or connector…"
                onAttach={onNewSessionWith}
                connectors={live.connectors}
                repos={live.repos}
                attachments={live.attachments}
                workspaces={live.workspaces}
              />
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h2 className="font-serif text-xl font-semibold text-ink">No messages yet</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          Start typing below to pick this session back up.
        </p>
      </div>
    </div>
  )
}
