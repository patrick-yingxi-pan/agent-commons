/** ── The conversation title bar — ONE primitive, every host ──────────────────
 *  The header a conversation surface wears: serif title + the live home
 *  breadcrumb (its project, or the routine a scheduled run belongs to — read
 *  from the LIVE relation graph, so an AI "file this session" edit updates it
 *  immediately). Extracted from App so the primary surface AND a split
 *  conversation pane wear the SAME bar (form follows function — panes are
 *  homogeneous, spec ADAPT-17): the narrow tier passes its in-flow rail-toggle
 *  `leading`; other tiers pass nothing — the collapsed rail's reopen control
 *  occupies its own gutter column in the shell (UI-3), so no pane ever indents
 *  for floating chrome. Must render under RelationsProvider (it reads
 *  useRelations). */
import type { ReactNode } from 'react'
import { CalendarClock, Download, Folder, Search } from 'lucide-react'
import type { Session } from '../types'
import type { NavLocation } from '../lib/nav'
import { useRelations } from '../controller/useRelations'
import { BackButton } from './BackButton'
import { RunHistoryMenu } from './RunHistoryMenu'
import { SessionShareButton } from './SessionShareButton'
import { identityTitleProps, identityBreadcrumbProps, IDENTITY_BREADCRUMB_TEXT_CLASS, IDENTITY_HEADER_GROUP_CLASS, IDENTITY_HEADER_ACTIONS_CLASS } from '../lib/identityTitle'

/** The slice of a Session the bar reads — a pane without the full server row
 *  (a run session outside the list) can pass a shell. */
export type TitleBarSession = Pick<Session, 'id' | 'title'> & {
  scheduledRunOf?: Session['scheduledRunOf']
  /** Viewer-relative ownership — gates the share door. Absent = not owned (a
   *  pane shell without the full server row, or a granted visitor's read). */
  own?: Session['own']
}

export function SessionTitleBar({
  session,
  leading,
  back,
  onOpenProject,
  onOpenSchedule,
  onSelectRun,
  onFind,
  onDownload,
}: {
  session: TitleBarSession
  /** Narrow tier: the in-flow rail toggle, rendered at the bar's left. */
  leading?: ReactNode
  /** A conversation opened from a PAGE (ADAPT-18): the bar leads with the one
   *  back control (BackButton), returning to — and naming — that origin. */
  back?: { to: NavLocation; onBack: () => void }
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
  /** A scheduled-run session's sibling-run navigation — the floating
   *  run-history click-down at the bar's right (UI-15: a switcher is chrome,
   *  never a pane). Selecting a run opens its session in place. */
  onSelectRun?: (sessionId: string) => void
  onFind?: () => void
  onDownload?: () => void
}) {
  const { projectForSessionId } = useRelations()
  // A scheduled run's session belongs to its routine, not a project — the server
  // tags the run session with `scheduledRunOf`, so the breadcrumb links back to
  // the routine without a client-side lookup.
  const runOf = session.scheduledRunOf
  const homeProject = runOf ? undefined : projectForSessionId(session.id)
  const home = runOf ? { id: runOf.taskId, name: runOf.taskName } : homeProject
  const HomeIcon = runOf ? CalendarClock : Folder
  return (
    <div
      className={`flex min-h-[52px] shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-canvas/80 py-2 pr-4 ${
        leading ? 'pl-2' : 'pl-4'
      }`}
      data-session-title-bar
    >
      <div data-identity-header-group className={IDENTITY_HEADER_GROUP_CLASS}>
        {leading}
        {back && <BackButton to={back.to} onBack={back.onBack} />}
        {/* The identity group owns free space. Its intrinsic basis moves the
            action cluster below when a pane cannot fit both readable groups. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <h1 {...identityTitleProps(session.title)} className="truncate font-serif text-[15px] font-semibold leading-tight text-ink">
            {session.title}
          </h1>
          {home && (
            <button
              onClick={() => runOf ? onOpenSchedule(home.id) : onOpenProject(home.id)}
              {...identityBreadcrumbProps(runOf ? `Open the ${home.name} routine` : `Open ${home.name}`)}
            >
              <HomeIcon size={12} className="shrink-0" />
              <span className={IDENTITY_BREADCRUMB_TEXT_CLASS}>
                {runOf ? 'Scheduled run of' : 'In'} <span className="font-medium">{home.name}</span>
              </span>
            </button>
          )}
        </div>
      </div>
      <div data-identity-header-actions className={IDENTITY_HEADER_ACTIONS_CLASS}>
        {runOf && onSelectRun && (
          <RunHistoryMenu taskId={runOf.taskId} activeRunSessionId={session.id} onSelectRun={onSelectRun} />
        )}
        {session.own && <SessionShareButton sessionId={session.id} />}
        {[
          { label: 'Find in conversation', onClick: onFind, Icon: Search },
          { label: 'Download conversation', onClick: onDownload, Icon: Download },
        ].map(({ label, onClick, Icon }) => onClick && (
          <button key={label} type="button" onClick={onClick} aria-label={label} title={label}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition hover:bg-panel-2 hover:text-ink">
            <Icon size={16} />
          </button>
        ))}
      </div>
    </div>
  )
}
