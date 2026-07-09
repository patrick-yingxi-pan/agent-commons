import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderInput,
  FolderMinus,
  PanelLeftClose,
  PauseCircle,
  Pencil,
  Pin,
  PinOff,
  Play,
  PlayCircle,
  Plus,
  Bell,
  Search,
  Trash2,
} from 'lucide-react'
import type { Project, ScheduledTask, Session, SectionId } from '../types'
import { ResizeHandle } from './ResizeHandle'
import { SessionFilterMenu } from './SessionFilterMenu'
import { ScheduledFilterMenu } from './ScheduledFilterMenu'
import { RowMenu, projectMenuItems, type RowMenuItem } from './RowMenu'
import { SECTION_META, SECTION_ORDER, SECTION_SUBVIEWS } from '../lib/sections'
import { SIDEBAR_HOVER } from '../lib/sidebar'
import { removeSchedule, runScheduleNow, toggleScheduleEnabled, useNotifications, useProjects, useSchedules } from '../api'
import { AccountChip } from './AccountMenu'
import { useRelations } from '../controller/useRelations'
import { runSessionId } from '../../contract/ids.ts'
import { getLayout, setLayout } from '../lib/uiPrefs'
import {
  filterSessions,
  loadSessionFilter,
  saveSessionFilter,
  type SessionFilter,
} from '../lib/sessionFilter'
import {
  filterRoutines,
  loadRoutineFilter,
  saveRoutineFilter,
  type RoutineFilter,
} from '../lib/routineFilter'

// Stable empty fallback so the filter useMemo's deps don't churn while projects load.
const NO_PROJECTS: Project[] = []

export function Sidebar({
  sessions,
  activeId,
  activeSection,
  activeSubview,
  onSelect,
  onNewSession,
  onOpenSection,
  onOpenSubview,
  onLeafNavigate,
  onOpenSchedule,
  onPinSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onToggleCollapse,
  onOpenSearch,
  onOpenNotifications,
  resizable = true,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  sessions: Session[]
  activeId: string
  activeSection: SectionId | null
  /** The active section's selected sub-view (lib/subviews) — the drill-in menu's
   *  highlight. null when the section has no sub-views. */
  activeSubview: string | null
  onSelect: (id: string) => void
  onNewSession: () => void
  onOpenSection: (s: SectionId) => void
  /** Switch the active section's sub-view (a rail drill-in row). */
  onOpenSubview: (id: string) => void
  /** Dismiss the narrow-tier rail drawer after a *leaf* navigation (a sub-view, or a
   *  section with no sub-views). Undefined off the narrow tier. Drilling into a
   *  section's sub-menu deliberately does NOT call this — the menu must stay visible. */
  onLeafNavigate?: () => void
  /** Open a routine's page in the Scheduled section (the row menu / "no runs" yet). */
  onOpenSchedule: (scheduleId: string) => void
  /** Row-menu session edits (controller-owned: delete navigates away if active). */
  onPinSession: (id: string, pinned: boolean) => void
  onRenameSession: (id: string, title: string) => void
  onArchiveSession: (id: string, archived: boolean) => void
  onDeleteSession: (id: string) => void
  /** Collapse the rail (its own toggle, top-left). Re-opening is handled by a
   *  floating control in the parent, since this one hides with the rail. */
  onToggleCollapse: () => void
  /** Open the floating search palette (the rail keeps only an icon). */
  onOpenSearch: () => void
  /** Open the notification inbox (D24) — the bell beside the search icon. */
  onOpenNotifications: () => void
  /** Drag-to-resize wiring; the parent owns the width and clamps it. On the
   *  narrow tier the rail is a fixed-width drawer, so the handle is dropped. */
  resizable?: boolean
  onResizeStart: () => void
  onResize: (clientX: number) => void
  onResizeEnd: () => void
}) {
  const inSession = activeSection === null
  // Rail navigation is an inline disclosure tree (VSCode-explorer style): a section with
  // sub-nodes (SECTION_SUBVIEWS) carries a chevron and expands IN PLACE to show its
  // children indented below it — no push, no back button, siblings stay visible. Several
  // sections can be open at once. An effect expands the active section, so a deep-link
  // into it reveals its children.
  const [expanded, setExpanded] = useState<Set<SectionId>>(() => {
    const s = new Set<SectionId>()
    if (activeSection && SECTION_SUBVIEWS[activeSection]) s.add(activeSection)
    return s
  })
  useEffect(() => {
    if (activeSection && SECTION_SUBVIEWS[activeSection])
      setExpanded((prev) => (prev.has(activeSection) ? prev : new Set(prev).add(activeSection)))
  }, [activeSection])
  const toggleExpand = (id: SectionId) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Clicking a section row: open its page, and — if it has children — expand it in place
  // (keeping the narrow drawer open so the children show, so you can pick one). A childless
  // section is a leaf: it navigates and dismisses the narrow drawer.
  const onSectionClick = (id: SectionId) => {
    onOpenSection(id)
    if (SECTION_SUBVIEWS[id]) setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    else onLeafNavigate?.()
  }
  // Clicking a child (a sub-node): make sure its section is active, then select it, and
  // dismiss the narrow drawer (a child is a leaf — it navigates).
  const onChildClick = (id: SectionId, subviewId: string) => {
    if (activeSection !== id) onOpenSection(id)
    onOpenSubview(subviewId)
    onLeafNavigate?.()
  }
  // The bell's badge (D24) — live via the tenant-targeted notification.changed event.
  const unreadCount = (useNotifications().data ?? []).filter((r) => !r.read).length
  // The "Scheduled" section folds (persisted) to save rail space.
  const [schedOpen, setSchedOpen] = useState<boolean>(() => getLayout('schedOpen', true))
  // The rail now lists scheduled *routines* (each entry is the recurring workflow,
  // not one run of it) — the same live source the Scheduled section reads.
  const routines = useSchedules().data ?? []

  const { applyOp, projectIdForSession, scheduleProjectId } = useRelations()
  const projects = useProjects().data ?? NO_PROJECTS
  const projectName = (pid: string) => projects.find((p) => p.id === pid)?.name ?? 'Project'

  // Recents "Filter & sort": the persisted choice, plus the project membership /
  // names it needs to filter and group by project (read from the relations graph).
  const [filter, setFilter] = useState<SessionFilter>(loadSessionFilter)
  const updateFilter = (next: SessionFilter) => {
    setFilter(next)
    saveSessionFilter(next)
  }
  const { groups, total } = useMemo(() => {
    return filterSessions(sessions, filter, {
      projectIdOf: projectIdForSession,
      projectName,
      now: Date.now(),
    })
  }, [sessions, filter, projectIdForSession, projects])

  // The Scheduled feed gets the same "Filter & sort" control, retuned for routines
  // (Status active/paused, group by project). Its own persisted choice + project
  // resolver (routine → project, via the relations graph).
  const [routineFilter, setRoutineFilter] = useState<RoutineFilter>(loadRoutineFilter)
  const updateRoutineFilter = (next: RoutineFilter) => {
    setRoutineFilter(next)
    saveRoutineFilter(next)
  }
  const { groups: routineGroups, total: routineTotal } = useMemo(() => {
    return filterRoutines(routines, routineFilter, {
      projectIdOfTask: scheduleProjectId,
      projectName,
    })
  }, [routines, routineFilter, scheduleProjectId, projects])

  const toggleSched = () =>
    setSchedOpen((v) => {
      setLayout('schedOpen', !v)
      return !v
    })

  // Open a routine from the rail: land on its latest run (a run *is* a session);
  // a routine that hasn't run yet opens its page instead.
  const openRoutine = (task: ScheduledTask) => {
    const latest = task.runs[0]
    if (latest) onSelect(runSessionId(task.id, latest.id))
    else onOpenSchedule(task.id)
  }

  // The project-membership menu items, shared by sessions and routines, built from
  // the relation op each entity files under.
  const sessionProjectItems = (s: Session): RowMenuItem[] =>
    projectMenuItems(
      projectIdForSession(s.id),
      projects,
      (projectId) =>
        applyOp({
          kind: 'file-session',
          sessionId: s.id,
          sessionTitle: s.title,
          projectId,
          projectName: projectName(projectId ?? projectIdForSession(s.id) ?? ''),
        }),
      { add: <FolderInput size={15} />, remove: <FolderMinus size={15} /> },
    )

  const routineProjectItems = (t: ScheduledTask): RowMenuItem[] =>
    projectMenuItems(
      scheduleProjectId(t.id),
      projects,
      (projectId) =>
        applyOp({
          kind: 'link-schedule-project',
          scheduleId: t.id,
          scheduleName: t.name,
          projectId,
          projectName: projectName(projectId ?? scheduleProjectId(t.id) ?? ''),
        }),
      { add: <FolderInput size={15} />, remove: <FolderMinus size={15} /> },
    )

  return (
    <aside className="relative flex h-full w-full shrink-0 flex-col border-r border-line bg-sidebar">
      {resizable && (
        <ResizeHandle side="right" onStart={onResizeStart} onMove={onResize} onEnd={onResizeEnd} />
      )}
      {/* Rail header — the collapse toggle sits at the top-left, with a search
          icon beside it; both on one line (no separate product top bar). Search
          opens a floating palette rather than filtering inline. */}
      <div className="flex items-center gap-1 px-2 pt-2.5">
        <button
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition ${SIDEBAR_HOVER} hover:text-ink`}
        >
          <PanelLeftClose size={18} />
        </button>
        <button
          onClick={onOpenSearch}
          title="Search  (⌘K)"
          aria-label="Search"
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition ${SIDEBAR_HOVER} hover:text-ink`}
        >
          <Search size={18} />
        </button>
        {/* The bell (D24) — the inbox of public acts on what you watch, own, or
            posted. The badge is the unread count, live via notification.changed. */}
        <button
          onClick={onOpenNotifications}
          title="Notifications"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          className={`relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition ${SIDEBAR_HOVER} hover:text-ink`}
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Nav: "New session" is pinned; below it every section is a node in an inline
          disclosure tree. A section with sub-nodes expands in place to show them indented
          (no push, no back button); siblings stay put. Filtering (kinds/status/…) is NOT
          here — it's on the page. */}
      <nav className="mt-3 px-2">
        <NavRow icon={<Plus size={16} />} label="New session" onClick={onNewSession} />
        {SECTION_ORDER.map((id) => {
          const { label, Icon, beta } = SECTION_META[id]
          const children = SECTION_SUBVIEWS[id]
          const isExpanded = expanded.has(id)
          return (
            <Fragment key={id}>
              <SectionTreeRow
                icon={<Icon size={16} />}
                label={label}
                beta={beta}
                hasChildren={!!children}
                expanded={isExpanded}
                // The section row is "active" only on its own default view (subview null);
                // when a child is selected the child carries the highlight instead.
                active={activeSection === id && activeSubview == null}
                onToggle={() => toggleExpand(id)}
                onOpen={() => onSectionClick(id)}
              />
              {children &&
                isExpanded &&
                children.map((sv) => (
                  <SubNavRow
                    key={sv.id}
                    label={sv.label}
                    active={activeSection === id && activeSubview === sv.id}
                    onClick={() => onChildClick(id, sv.id)}
                  />
                ))}
            </Fragment>
          )
        })}
      </nav>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* Scheduled — each row is a recurring routine; clicking opens its latest
            run, with a right panel to switch among runs. Foldable to save space. */}
        {routines.length > 0 && (
          <>
            <div className="flex items-center justify-between pr-1">
              <button
                onClick={toggleSched}
                aria-expanded={schedOpen}
                className={`flex flex-1 items-center gap-1 rounded-md px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink-soft`}
              >
                {/* Label left-aligned (matching RECENTS + the row dots); the fold
                    caret sits to its right, Claude-app "Recents ⌄" style. */}
                Scheduled
                <ChevronRight
                  size={12}
                  className={`shrink-0 transition-transform ${schedOpen ? 'rotate-90' : ''}`}
                />
                <span className="font-normal normal-case tracking-normal text-ink-faint">
                  routines
                </span>
              </button>
              {schedOpen && (
                <ScheduledFilterMenu
                  filter={routineFilter}
                  onChange={updateRoutineFilter}
                  projects={projects}
                />
              )}
            </div>
            {schedOpen && (
              <>
                {routineGroups.map((g) => (
                  <Fragment key={g.key}>
                    {g.label && <GroupHeader>{g.label}</GroupHeader>}
                    {g.tasks.map((t) => (
                      <RoutineRow
                        key={t.id}
                        task={t}
                        active={inSession && activeId.startsWith(`srun-${t.id}-`)}
                        onOpen={() => openRoutine(t)}
                        menuItems={[
                          {
                            kind: 'action',
                            key: 'run',
                            label: 'Run now',
                            icon: <Play size={15} />,
                            onSelect: () => void runScheduleNow(t.id),
                          },
                          {
                            kind: 'action',
                            key: 'toggle',
                            label: t.enabled ? 'Pause' : 'Resume',
                            icon: t.enabled ? <PauseCircle size={15} /> : <PlayCircle size={15} />,
                            onSelect: () => void toggleScheduleEnabled(t.id, !t.enabled),
                          },
                          { kind: 'divider', key: 'd1' },
                          ...routineProjectItems(t),
                          { kind: 'divider', key: 'd2' },
                          {
                            kind: 'action',
                            key: 'delete',
                            label: 'Delete',
                            icon: <Trash2 size={15} />,
                            danger: true,
                            confirm: `Delete the “${t.name}” routine? A server restart restores the seed.`,
                            onSelect: () => void removeSchedule(t.id),
                          },
                        ]}
                      />
                    ))}
                  </Fragment>
                ))}
                {routineTotal === 0 && (
                  <p className="px-2 py-2 text-[12px] text-ink-faint">No routines match these filters.</p>
                )}
              </>
            )}
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
                onRename={(title) => onRenameSession(c.id, title)}
                menuItems={[
                  {
                    kind: 'action',
                    key: 'pin',
                    label: c.pinned ? 'Unpin' : 'Pin',
                    icon: c.pinned ? <PinOff size={15} /> : <Pin size={15} />,
                    onSelect: () => onPinSession(c.id, !c.pinned),
                  },
                  {
                    kind: 'action',
                    key: 'rename',
                    label: 'Rename',
                    icon: <Pencil size={15} />,
                    onSelect: () => {}, // wired to the row's inline editor below
                  },
                  ...sessionProjectItems(c),
                  { kind: 'divider', key: 'd1' },
                  {
                    kind: 'action',
                    key: 'archive',
                    label: c.status === 'archived' ? 'Unarchive' : 'Archive',
                    icon: c.status === 'archived' ? <ArchiveRestore size={15} /> : <Archive size={15} />,
                    onSelect: () => onArchiveSession(c.id, c.status !== 'archived'),
                  },
                  {
                    kind: 'action',
                    key: 'delete',
                    label: 'Delete',
                    icon: <Trash2 size={15} />,
                    danger: true,
                    confirm: `Delete “${c.title}”? A server restart restores the seed.`,
                    onSelect: () => onDeleteSession(c.id),
                  },
                ]}
              />
            ))}
          </Fragment>
        ))}
        {total === 0 && (
          <p className="px-2 py-3 text-[12px] text-ink-faint">No sessions match these filters.</p>
        )}
      </div>

      <AccountChip />
    </aside>
  )
}

// The account/tenant chip + switcher/onboarding menu moved to ./AccountMenu.tsx
// (multi-account P7 — it grew the sign-in / create-account / workspace flows).

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
        active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
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

/** One section node in the rail's disclosure tree. A chevron (only when the section has
 *  sub-nodes) expands/collapses its children in place; the icon + label opens the page.
 *  The chevron toggles WITHOUT navigating; the row body navigates — VSCode-explorer
 *  behaviour, so you can peek at a section's children without leaving where you are. */
function SectionTreeRow({
  icon,
  label,
  beta,
  hasChildren,
  expanded,
  active,
  onToggle,
  onOpen,
}: {
  icon: ReactNode
  label: string
  beta?: boolean
  hasChildren: boolean
  expanded: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={`group flex w-full items-center rounded-lg pr-2 text-[13px] transition ${
        active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
      }`}
    >
      {hasChildren ? (
        <button
          onClick={onToggle}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-faint transition hover:text-ink"
        >
          <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden />
      )}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {beta && (
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">Beta</span>
        )}
      </button>
    </div>
  )
}

/** One child node under an expanded section — indented, with a leading dot echoing the
 *  Recents rows, so the two-level tree reads clearly. */
function SubNavRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-7 pr-2 text-[13px] transition ${
        active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'border border-line-strong bg-transparent'}`}
      />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
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

/** One Recents row — a leading dot (or pin), the title, and a hover "⋮" menu.
 *  "Rename" flips the title into an inline editor; the rest go through the menu's
 *  own handlers. The main region selects the session; the menu sits outside that
 *  button so its clicks don't also open the thread. */
function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  menuItems,
}: {
  session: Session
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  menuItems: RowMenuItem[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)

  const commit = () => {
    const next = draft.trim()
    if (next && next !== session.title) onRename(next)
    setEditing(false)
  }
  const startRename = () => {
    setDraft(session.title)
    setEditing(true)
  }
  // Splice the live rename starter into the menu's "Rename" item.
  const items = menuItems.map((it) =>
    it.kind === 'action' && it.key === 'rename' ? { ...it, onSelect: startRename } : it,
  )

  return (
    <div
      className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 transition ${
        active ? 'bg-surface shadow-sm ring-1 ring-line-strong' : SIDEBAR_HOVER
      }`}
    >
      {session.pinned ? (
        <Pin size={12} className="shrink-0 text-ink-faint" />
      ) : (
        <Dot active={active} />
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-1 py-0.5 text-[13px] text-ink outline-none focus:border-accent"
        />
      ) : (
        <button
          onClick={onSelect}
          title={session.preview}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
        >
          {session.title}
        </button>
      )}
      {!editing && <RowMenu ariaLabel={`Actions for ${session.title}`} items={items} />}
    </div>
  )
}

/** A group divider label shown above each bucket when Group by ≠ None. */
function GroupHeader({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold text-ink-faint">{children}</div>
}

/** One Scheduled-routine row — an outcome/paused dot, the routine name, its short
 *  cadence, and a hover "⋮" menu. Clicking opens the routine's latest run. */
function RoutineRow({
  task,
  active,
  onOpen,
  menuItems,
}: {
  task: ScheduledTask
  active: boolean
  onOpen: () => void
  menuItems: RowMenuItem[]
}) {
  const cadence = task.cadence.split('·')[0]?.trim() || task.cadence
  return (
    <div
      className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 transition ${
        active ? 'bg-surface shadow-sm ring-1 ring-line-strong' : SIDEBAR_HOVER
      }`}
    >
      <RoutineDot enabled={task.enabled} lastStatus={task.lastStatus} />
      <button
        onClick={onOpen}
        title={`${task.cadence} · ${task.subtitle}`}
        className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
      >
        {task.name}
      </button>
      <span className="shrink-0 text-[11px] text-ink-faint group-hover:hidden">{cadence}</span>
      <RowMenu ariaLabel={`Actions for ${task.name}`} items={menuItems} />
    </div>
  )
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

/** A routine's leading dot: muted when paused, red on a failed last run, else
 *  green (healthy / active). */
function RoutineDot({
  enabled,
  lastStatus,
}: {
  enabled: boolean
  lastStatus: ScheduledTask['lastStatus']
}) {
  const color = !enabled ? 'bg-line-strong' : lastStatus === 'failed' ? 'bg-red-500' : 'bg-emerald-500'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={enabled ? lastStatus : 'paused'} />
}
