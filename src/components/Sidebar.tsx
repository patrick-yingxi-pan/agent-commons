import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, PanelLeftClose, Plus, Search } from 'lucide-react'
import type { Project, ScheduledRun, Session, SectionId } from '../types'
import { ResizeHandle } from './ResizeHandle'
import { SessionFilterMenu } from './SessionFilterMenu'
import { SECTION_META, SECTION_ORDER } from '../lib/sections'
import { useProjects, useRecentRuns } from '../api'
import { useRelations } from '../controller/useRelations'
import { getLayout, setLayout } from '../lib/uiPrefs'
import {
  filterSessions,
  loadSessionFilter,
  saveSessionFilter,
  type SessionFilter,
} from '../lib/sessionFilter'

// Stable empty fallback so the filter useMemo's deps don't churn while projects load.
const NO_PROJECTS: Project[] = []

export function Sidebar({
  sessions,
  activeId,
  activeSection,
  onSelect,
  onNewSession,
  onOpenSection,
  onToggleCollapse,
  onOpenSearch,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  sessions: Session[]
  activeId: string
  activeSection: SectionId | null
  onSelect: (id: string) => void
  onNewSession: () => void
  onOpenSection: (s: SectionId) => void
  /** Collapse the rail (its own toggle, top-left). Re-opening is handled by a
   *  floating control in the parent, since this one hides with the rail. */
  onToggleCollapse: () => void
  /** Open the floating search palette (the rail keeps only an icon). */
  onOpenSearch: () => void
  /** Drag-to-resize wiring; the parent owns the width and clamps it. */
  onResizeStart: () => void
  onResize: (clientX: number) => void
  onResizeEnd: () => void
}) {
  const inSession = activeSection === null
  // The "Scheduled" section folds (persisted) to save rail space.
  const [schedOpen, setSchedOpen] = useState<boolean>(() => getLayout('schedOpen', true))
  // The recent-runs feed comes from the server now (a single live source) — a run
  // the daemon fires appears here without a reload, via the event stream.
  const recentRuns = useRecentRuns().data ?? []

  // Recents "Filter & sort": the persisted choice, plus the project membership /
  // names it needs to filter and group by project (read from the relations graph).
  const [filter, setFilter] = useState<SessionFilter>(loadSessionFilter)
  const updateFilter = (next: SessionFilter) => {
    setFilter(next)
    saveSessionFilter(next)
  }
  const { projectIdForSession } = useRelations()
  const projects = useProjects().data ?? NO_PROJECTS
  const { groups, total } = useMemo(() => {
    const projectName = (pid: string) => projects.find((p) => p.id === pid)?.name ?? 'Project'
    return filterSessions(sessions, filter, {
      projectIdOf: projectIdForSession,
      projectName,
      now: Date.now(),
    })
  }, [sessions, filter, projectIdForSession, projects])

  const toggleSched = () =>
    setSchedOpen((v) => {
      setLayout('schedOpen', !v)
      return !v
    })

  return (
    <aside className="relative flex h-full w-full shrink-0 flex-col border-r border-line bg-sidebar">
      <ResizeHandle side="right" onStart={onResizeStart} onMove={onResize} onEnd={onResizeEnd} />
      {/* Rail header — the collapse toggle sits at the top-left, with a search
          icon beside it; both on one line (no separate product top bar). Search
          opens a floating palette rather than filtering inline. */}
      <div className="flex items-center gap-1 px-2 pt-2.5">
        <button
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
        >
          <PanelLeftClose size={18} />
        </button>
        <button
          onClick={onOpenSearch}
          title="Search  (⌘K)"
          aria-label="Search"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
        >
          <Search size={18} />
        </button>
      </div>

      {/* Nav: a new session plus the cross-cutting tools. */}
      <nav className="mt-3 px-2">
        <NavRow icon={<Plus size={16} />} label="New session" onClick={onNewSession} />
        {SECTION_ORDER.map((id) => {
          const { label, Icon, beta } = SECTION_META[id]
          return (
            <NavRow
              key={id}
              icon={<Icon size={16} />}
              label={label}
              beta={beta}
              active={activeSection === id}
              onClick={() => onOpenSection(id)}
            />
          )
        })}
      </nav>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* Recent scheduled runs — each opens the session that run executed in
            (not the Scheduled page). Foldable to save rail space. */}
        {recentRuns.length > 0 && (
          <>
            <button
              onClick={toggleSched}
              aria-expanded={schedOpen}
              className="flex w-full items-center gap-1 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint transition hover:text-ink-soft"
            >
              <ChevronRight
                size={12}
                className={`shrink-0 transition-transform ${schedOpen ? 'rotate-90' : ''}`}
              />
              Scheduled
              <span className="ml-1 font-normal normal-case tracking-normal text-ink-faint">
                recent runs
              </span>
            </button>
            {schedOpen &&
              recentRuns.map(({ task, run, session }) => {
                const active = inSession && session.id === activeId
                return (
                  <button
                    key={session.id}
                    onClick={() => onSelect(session.id)}
                    title={`${run.when} · ${run.summary}`}
                    className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
                      active ? 'bg-surface shadow-sm ring-1 ring-line-strong' : 'hover:bg-surface/70'
                    }`}
                  >
                    <RunDot status={run.status} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{task.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">{run.absolute}</span>
                  </button>
                )
              })}
          </>
        )}

        {/* Recents — one compact line per conversation, filtered / sorted / grouped
            by the "Filter & sort" menu. When Group by ≠ None each bucket gets a
            small header; otherwise it's one flat, header-less list. */}
        <div className="mt-3 flex items-center justify-between pr-1">
          <SectionLabel className="mt-0">Recents</SectionLabel>
          <SessionFilterMenu filter={filter} onChange={updateFilter} projects={projects} />
        </div>

        {groups.map((g) => (
          <Fragment key={g.key}>
            {g.label && <GroupHeader>{g.label}</GroupHeader>}
            {g.sessions.map((c) => (
              <SessionRow
                key={c.id}
                session={c}
                active={inSession && c.id === activeId}
                onSelect={() => onSelect(c.id)}
              />
            ))}
          </Fragment>
        ))}
        {total === 0 && (
          <p className="px-2 py-3 text-[12px] text-ink-faint">No sessions match these filters.</p>
        )}
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
            P
          </div>
          <div className="leading-tight">
            <div className="text-xs font-medium text-ink">Patrick Pan</div>
            <div className="text-[11px] text-ink-faint">Prototype workspace</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavRow({
  icon,
  label,
  beta,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  beta?: boolean
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${
        active ? 'bg-panel-2 font-medium text-ink' : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {beta && (
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
          Beta
        </span>
      )}
    </button>
  )
}

function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint ${className}`}
    >
      {children}
    </div>
  )
}

/** One Recents row — a leading dot plus the session title. */
function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: Session
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      title={session.preview}
      className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
        active ? 'bg-surface shadow-sm ring-1 ring-line-strong' : 'hover:bg-surface/70'
      }`}
    >
      <Dot active={active} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{session.title}</span>
    </button>
  )
}

/** A group divider label shown above each bucket when Group by ≠ None. */
function GroupHeader({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold text-ink-faint">{children}</div>
}

/** A leading status dot — filled for the active item, a hollow ring otherwise. */
function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        active ? 'bg-accent' : 'border border-line-strong bg-transparent'
      }`}
    />
  )
}

/** A run's leading dot, colored by outcome: green ok, red failed, muted skipped,
 *  accent while running. */
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
