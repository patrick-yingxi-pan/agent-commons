/** The empty conversation surface — the draft's "What should we work on?"
 *  invitation (with the FWD-1 pre-attach launcher) and the reopened-empty
 *  session's quieter variant. ONE component for every conversation host
 *  (the singleton surface and every split pane) — a draft must look the same
 *  wherever it renders (homogeneity, universal split Phase 6). */
import { AddContextButton } from './AddContextButton'
import type { Live } from '../data/liveSession'
import type { AddedContext } from '../types'

export function EmptyState({
  mode,
  live,
  onNewSessionWith,
}: {
  mode: 'draft' | 'empty'
  /** The draft's live context (drives the launcher's "Added" ticks). Draft mode only. */
  live?: Live
  /** Start a new chat with a context pre-attached (FWD-1). Draft mode only. */
  onNewSessionWith?: (ctx: AddedContext) => void
}) {
  if (mode === 'draft') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <div className="font-serif text-xl font-semibold text-ink">What should we work on?</div>
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
        <div className="font-serif text-xl font-semibold text-ink">No messages yet</div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          Start typing below to pick this session back up.
        </p>
      </div>
    </div>
  )
}
