/** ── The conversation title bar — ONE primitive, every host ──────────────────
 *  The header a conversation surface wears: serif title + the live home
 *  breadcrumb (its project, or the routine a scheduled run belongs to — read
 *  from the LIVE relation graph, so an AI "file this session" edit updates it
 *  immediately). Extracted from App so the primary surface AND a split
 *  conversation pane wear the SAME bar (form follows function — panes are
 *  homogeneous, spec ADAPT-17): the primary passes its rail-toggle `leading` /
 *  `leftOpen` indent; a pane passes neither. Must render under
 *  RelationsProvider (it reads useRelations). */
import type { ReactNode } from 'react'
import { CalendarClock, Folder } from 'lucide-react'
import type { Session } from '../types'
import { useRelations } from '../controller/useRelations'

/** The slice of a Session the bar reads — a pane without the full server row
 *  (a run session outside the list) can pass a shell. */
export type TitleBarSession = Pick<Session, 'id' | 'title'> & { scheduledRunOf?: Session['scheduledRunOf'] }

export function SessionTitleBar({
  session,
  leftOpen = true,
  leading,
  onOpenProject,
  onOpenSchedule,
}: {
  session: TitleBarSession
  /** Primary-surface indent: false reserves room for the floating rail-reopen
   *  control (`pl-14`). Panes (always inside the frame) keep the default. */
  leftOpen?: boolean
  /** Narrow tier: the in-flow rail toggle, rendered at the bar's left. */
  leading?: ReactNode
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
}) {
  const { projectForSessionId } = useRelations()
  // A scheduled run's session belongs to its routine, not a project — the server
  // tags the run session with `scheduledRunOf`, so the breadcrumb links back to
  // the routine without a client-side lookup.
  const runOf = session.scheduledRunOf
  const homeProject = runOf ? undefined : projectForSessionId(session.id)
  return (
    <div
      className={`flex min-h-[52px] shrink-0 items-center gap-1.5 border-b border-line bg-canvas/80 py-2 pr-4 ${
        leading ? 'pl-2' : leftOpen ? 'pl-4' : 'pl-14'
      }`}
      data-session-title-bar
    >
      {leading}
      <div className="flex min-w-0 flex-col justify-center gap-0.5">
        <span className="truncate font-serif text-[15px] font-semibold leading-tight text-ink">
          {session.title}
        </span>
        {runOf && (
          <button
            onClick={() => onOpenSchedule(runOf.taskId)}
            title={`Open the ${runOf.taskName} routine`}
            className="inline-flex w-fit items-center gap-1 text-[12px] text-ink-faint transition hover:text-ink"
          >
            <CalendarClock size={12} className="shrink-0" />
            <span>
              Scheduled run of <span className="font-medium">{runOf.taskName}</span>
            </span>
          </button>
        )}
        {homeProject && (
          <button
            onClick={() => onOpenProject(homeProject.id)}
            title={`Open ${homeProject.name}`}
            className="inline-flex w-fit items-center gap-1 text-[12px] text-ink-faint transition hover:text-ink"
          >
            <Folder size={12} className="shrink-0" />
            <span>
              In <span className="font-medium">{homeProject.name}</span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
