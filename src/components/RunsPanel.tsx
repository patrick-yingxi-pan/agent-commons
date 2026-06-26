import { CalendarClock, Check, ChevronRight } from 'lucide-react'
import { PanelShell } from './PanelShell'
import { useSchedules } from '../api'
import { runSessionId } from '../../contract/ids.ts'
import { relativeTime } from '../lib/relativeTime'
import type { ScheduledRun } from '../types'

/** ── The scheduled-run session's right panel ──────────────────────────────────
 *  A scheduled routine's run *is* a session; opening the routine from the rail
 *  lands on its latest run. This panel is how you move around that routine without
 *  leaving the thread: every run listed newest-first (switch among them), and a
 *  jump back to the routine's page. Shown whenever a `scheduledRunOf` session is
 *  open and no attached-context panel has the right rail. */
export function RunsPanel({
  taskId,
  activeRunSessionId,
  onSelectRun,
  onOpenRoutine,
  onClose,
}: {
  taskId: string
  activeRunSessionId: string
  onSelectRun: (sessionId: string) => void
  onOpenRoutine: (taskId: string) => void
  onClose: () => void
}) {
  const task = (useSchedules().data ?? []).find((t) => t.id === taskId)
  const runs = task?.runs ?? []
  const steps = task?.steps.length ?? 0
  const active = runs.find((r) => runSessionId(taskId, r.id) === activeRunSessionId)

  return (
    <PanelShell
      icon={<CalendarClock size={16} className="text-ink-soft" />}
      title={task?.name ?? 'Scheduled runs'}
      count={runs.length || undefined}
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* The active run's progress, echoing the routine rail's reach. */}
        {active && (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-panel-2/40 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Progress</span>
            <span className="text-[12px] font-medium text-ink">
              {Math.min(active.reachedStep, steps)} of {steps} step{steps === 1 ? '' : 's'}
            </span>
          </div>
        )}

        <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Runs</div>
        <div className="flex flex-col">
          {runs.map((run) => {
            const sid = runSessionId(taskId, run.id)
            const isActive = sid === activeRunSessionId
            return (
              <button
                key={run.id}
                onClick={() => onSelectRun(sid)}
                title={run.summary}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
                  isActive ? 'bg-surface shadow-sm ring-1 ring-line-strong' : 'hover:bg-panel-2/60'
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
          {runs.length === 0 && (
            <p className="px-2 py-2 text-[12px] text-ink-faint">No runs yet.</p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <button
          onClick={() => onOpenRoutine(taskId)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium text-ink shadow-sm transition hover:border-accent"
        >
          <span className="flex items-center gap-2">
            <CalendarClock size={15} className="text-ink-soft" />
            View routine
          </span>
          <ChevronRight size={15} className="text-ink-faint" />
        </button>
      </div>
    </PanelShell>
  )
}

/** A run's leading dot, colored by outcome — same vocabulary as the rail. */
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
