/** ── The run-history click-down (UI-15: a chooser is chrome, never a pane) ───
 *  A scheduled routine's run *is* a session; its run history is NAVIGATION
 *  among sibling runs — transient chrome, not content. So it floats: a
 *  click-down anchored in the run session's title bar, through the shared
 *  popover funnel (POPOVER_SURFACE + useDismissable + usePopoverShift). The
 *  runs PANE this replaces tiled the list beside the thread, making every run
 *  session read as two split windows (docs/ui-invariants.md UI-15). Selecting
 *  a run retargets the conversation in place; the title bar's breadcrumb is
 *  the door to the routine's page. */
import { useState } from 'react'
import { Check, ChevronDown, History } from 'lucide-react'
import { useSchedules } from '../api'
import { runSessionId } from '../../contract/ids.ts'
import { relativeTime } from '../lib/relativeTime'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { useDismissable } from '../lib/useDismissable'
import type { ScheduledRun } from '../types'

export function RunHistoryMenu({
  taskId,
  activeRunSessionId,
  onSelectRun,
}: {
  taskId: string
  /** The run session this menu floats over — its row shows the check. */
  activeRunSessionId: string
  /** Open another run's session (the same door every session navigation uses —
   *  the hosting pane retargets in place). */
  onSelectRun: (sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const task = (useSchedules().data ?? []).find((t) => t.id === taskId)

  // Unresolved registry (still loading) or a gone routine: render NOTHING —
  // asserting "0 runs" in chrome would state a count nobody knows (the honest-
  // unknown rule the usage gauge follows), and a chooser without a subject has
  // nothing to choose.
  if (!task) return null
  const runs = task.runs
  const steps = task.steps.length

  return (
    <div ref={wrapRef} className="relative ml-auto shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Run history"
        aria-label="Run history"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium shadow-sm transition ${
          open ? 'border-accent bg-surface text-ink' : 'border-line bg-surface text-ink-soft hover:border-accent hover:text-ink'
        }`}
      >
        <History size={13} />
        <span className="tabular-nums">
          {runs.length} run{runs.length === 1 ? '' : 's'}
        </span>
        <ChevronDown size={13} className="text-ink-faint" />
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Run history"
          data-run-history
          className={`absolute right-0 top-full z-30 mt-1.5 w-[280px] ${POPOVER_SURFACE}`}
        >
          <div className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {task?.name ?? 'Runs'}
          </div>
          <div className="max-h-[min(50dvh,360px)] overflow-y-auto p-1.5 pt-0.5">
            {runs.map((run) => {
              const sid = runSessionId(taskId, run.id)
              const isActive = sid === activeRunSessionId
              return (
                <button
                  key={run.id}
                  onClick={() => {
                    setOpen(false)
                    if (!isActive) onSelectRun(sid)
                  }}
                  title={run.summary}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
                    isActive ? 'bg-panel-2/60' : 'hover:bg-panel-2/60'
                  }`}
                >
                  <RunDot status={run.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{relativeTime(run.at)}</div>
                    <div className="truncate text-[11px] text-ink-faint">
                      {Math.min(run.reachedStep, steps)}/{steps} step{steps === 1 ? '' : 's'}
                    </div>
                  </div>
                  {isActive && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              )
            })}
            {runs.length === 0 && <p className="px-2 py-2 text-[12px] text-ink-faint">No runs yet.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/** A run's leading dot, colored by outcome — same vocabulary as the routine
 *  page's rail. */
function RunDot({ status }: { status: ScheduledRun['status'] }) {
  const color =
    status === 'failed'
      ? 'bg-red-500'
      : status === 'skipped'
        ? 'bg-line-strong'
        : status === 'running'
          ? 'bg-accent'
          : 'bg-emerald-500'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={status} />
}
