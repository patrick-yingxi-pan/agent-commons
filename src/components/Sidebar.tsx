import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Rows2,
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
  X,
} from 'lucide-react'
import type { ScheduledTask, Session, SectionId } from '../types'
import { ResizeHandle } from './ResizeHandle'
import { SessionFilterMenu } from './SessionFilterMenu'
import { ScheduledFilterMenu } from './ScheduledFilterMenu'
import { RowMenu, projectMenuItems, type RowMenuItem } from './RowMenu'
import { SECTION_META, SECTION_ORDER, SECTION_SUBVIEWS } from '../lib/sections'
import { SIDEBAR_HOVER, SIDEBAR_ICON_BUTTON } from '../lib/sidebar'
import { removeSchedule, runScheduleNow, toggleScheduleEnabled, useMe, useNotifications, useSchedules } from '../api'
import { AccountChip } from './AccountMenu'
import { useRelations } from '../controller/useRelations'
import { runSessionId } from '../../contract/ids.ts'
import { getLayout, setLayout } from '../lib/uiPrefs'
import {
  dragPane,
  layoutPanes,
  paneMax,
  RAIL_PANE_MIN,
  RAIL_RECENTS_DEFAULT,
  RAIL_SCHEDULED_DEFAULT,
  type PaneId,
  type PaneInput,
} from '../lib/railPanes'
import { LEFT_MIN, LEFT_MAX } from '../controller/useLayout'
import {
  clampSessionFilter,
  filterSessions,
  loadSessionFilter,
  saveSessionFilter,
  type SessionFilter,
} from '../lib/sessionFilter'
import {
  clampRoutineFilter,
  filterRoutines,
  loadRoutineFilter,
  saveRoutineFilter,
  type RoutineFilter,
} from '../lib/routineFilter'


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
  onOpenOwner,
  onSplitRow,
  onSplitCol,
  onCloseView,
  resizable = true,
  railW,
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
  /** A facet (sub-view) pick — carries its SECTION so the parent can route the
   *  pair into a focused split pane (the primary path ignores the section: the
   *  tree row already opened it). */
  onOpenSubview: (section: SectionId, id: string) => void
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
  /** Door to a namespace page (FWD-6 — the chip menu's Organizations rows). */
  onOpenOwner?: (name: string) => void
  /** Split the main view into panes (universal split) — each direction passed
   *  only when ITS viewport axis has room (row: width / the wide tier; col:
   *  height — canSplitRow/canSplitCol, src/lib/viewport.ts). Acts on the
   *  focused pane, duplicating its content beside (row) or below (col) it. */
  onSplitRow?: () => void
  onSplitCol?: () => void
  /** Close the FOCUSED pane — offered iff either split is (the cluster shows
   *  and hides as one) and a closable pane exists. Homogeneous: a secondary
   *  pane collapses; closing the primary tile relocates the primary role into
   *  the surviving pane (its content promotes into the controller, so the URL
   *  follows). */
  onCloseView?: () => void
  /** Drag-to-resize wiring; the parent owns the width and clamps it. On the
   *  narrow tier the rail is a fixed-width drawer, so the handle is dropped. */
  resizable?: boolean
  /** The rail's current width — the handle's aria-valuenow. */
  railW: number
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
  // The expansion set persists PER ACCOUNT through the scoped layout store
  // (one boolean per section — uiPrefs.ts), so a switch-back or reload finds
  // the tree folded exactly as that account left it. Only EXPLICIT toggles
  // persist; the active-section auto-expansion below stays derived (the
  // restored activeSection re-produces it), so navigating never pins a
  // section open in storage.
  const [expanded, setExpanded] = useState<Set<SectionId>>(() => {
    const s = new Set<SectionId>()
    for (const id of SECTION_ORDER) if (SECTION_SUBVIEWS[id] && getLayout(`treeOpen.${id}`, false)) s.add(id)
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
      setLayout(`treeOpen.${id}`, next.has(id))
      return next
    })

  // The maintainer console's rail row is CHROME gated on the identity's
  // `instanceAdmin` grant (the server's 404 wall is the real gate) — everyone
  // else sees the roster without it.
  const instanceAdmin = useMe().data?.instanceAdmin === true
  const visibleSections = useMemo(
    () => SECTION_ORDER.filter((id) => id !== 'admin' || instanceAdmin),
    [instanceAdmin],
  )
  // Fold / unfold all — one toggle over the whole tree. "All expanded" means every
  // section that HAS children is open; the control then collapses everything (VSCode's
  // "Collapse All"); otherwise it expands every expandable section at once.
  const expandableIds = useMemo(() => visibleSections.filter((id) => SECTION_SUBVIEWS[id]), [visibleSections])
  const allExpanded = expandableIds.every((id) => expanded.has(id))
  const toggleAll = () => {
    for (const id of expandableIds) setLayout(`treeOpen.${id}`, !allExpanded)
    setExpanded(allExpanded ? new Set() : new Set(expandableIds))
  }

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
    onOpenSubview(id, subviewId)
    onLeafNavigate?.()
  }
  // The "Scheduled" section folds (persisted) to save rail space.
  const [schedOpen, setSchedOpen] = useState<boolean>(() => getLayout('schedOpen', true))
  // The rail now lists scheduled *routines* (each entry is the recurring workflow,
  // not one run of it) — the same live source the Scheduled section reads.
  const routines = useSchedules().data ?? []

  const { applyOp, projectIdForSession, scheduleProjectId, allProjects } = useRelations()
  // The LIVE project registry — seeds + runtime-created (graph.extraProjects), the
  // same list the Projects page renders. The rail must not read the seed-only
  // /projects mirror: a just-created project would be nameless here ("Project")
  // and missing from every "Add to project" / filter menu (registries have one
  // home and live points-of-use).
  const projects = useMemo(() => allProjects(), [allProjects])
  const projectName = (pid: string) => projects.find((p) => p.id === pid)?.name ?? 'Project'

  // Recents "Filter & sort": the persisted choice, plus the project membership /
  // names it needs to filter and group by project (read from the relations graph).
  // The stored blob is browser-wide while its projectId is tenant-scoped, so the
  // choice CLAMPS at render (never in storage): a dangling id — another account's
  // project, or a deleted one — reads as 'all' instead of hiding every row.
  const [rawFilter, setFilter] = useState<SessionFilter>(loadSessionFilter)
  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const filter = clampSessionFilter(rawFilter, projectIds)
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
  const [rawRoutineFilter, setRoutineFilter] = useState<RoutineFilter>(loadRoutineFilter)
  const routineFilter = clampRoutineFilter(rawRoutineFilter, projectIds)
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

  // ── Resizable, foldable rail body panes (ADAPT-13) ──────────────────────────
  // The rail body is an accordion: each pane (Sections / Scheduled / Recents) folds
  // to its header, and open panes hold a persisted FIXED height except the TOP-most
  // open one, which flexes to fill — Sections is the pane with the most rows, so it
  // gets the spare height, and folding Scheduled/Recents drops their headers toward
  // the bottom, handing the space upward. A divider moves only on drag — folding or
  // new content never does; heights clamp at render (layoutPanes), never in storage.
  // The whole mechanism is gated on `resizable` (dropped on the narrow tier, ADAPT-11).
  const [sectionsOpen, setSectionsOpen] = useState<boolean>(() => getLayout('railSectionsOpen', true))
  const [recentsOpen, setRecentsOpen] = useState<boolean>(() => getLayout('railRecentsOpen', true))
  const toggleSectionsOpen = () =>
    setSectionsOpen((v) => {
      setLayout('railSectionsOpen', !v)
      return !v
    })
  const toggleRecentsOpen = () =>
    setRecentsOpen((v) => {
      setLayout('railRecentsOpen', !v)
      return !v
    })

  const stackRef = useRef<HTMLDivElement>(null)
  const scheduledPaneRef = useRef<HTMLDivElement>(null)
  const recentsPaneRef = useRef<HTMLDivElement>(null)
  const dragBottomRef = useRef(0)
  const [avail, setAvail] = useState(0)
  // Measure the stack synchronously before paint (no first-frame flash), then track
  // it live so window resize re-flows the flex pane while fixed panes stay put.
  useLayoutEffect(() => {
    const el = stackRef.current
    if (!el) return
    const update = () => setAvail(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [scheduledH, setScheduledH] = useState<number>(() => getLayout('railScheduledH', RAIL_SCHEDULED_DEFAULT))
  const [recentsH, setRecentsH] = useState<number>(() => getLayout('railRecentsH', RAIL_RECENTS_DEFAULT))
  const scheduledHRef = useRef(scheduledH)
  scheduledHRef.current = scheduledH
  const recentsHRef = useRef(recentsH)
  recentsHRef.current = recentsH

  const paneInputs: PaneInput[] = [
    { id: 'sections', present: true, open: sectionsOpen, height: 0 },
    { id: 'scheduled', present: routines.length > 0, open: schedOpen, height: scheduledH },
    { id: 'recents', present: true, open: recentsOpen, height: recentsH },
  ]
  const layout = layoutPanes(paneInputs, avail)
  const paneOf = (id: PaneId) => layout.find((p) => p.id === id)
  // A fixed (open, non-flex) pane gets an explicit height; the flex pane fills via
  // flex-1; a folded pane collapses to its (auto-height) header.
  const paneStyle = (id: PaneId) => {
    const l = paneOf(id)
    return resizable && l && l.open && !l.flex ? { height: l.height } : undefined
  }
  const paneClass = (id: PaneId) => {
    const l = paneOf(id)
    if (!resizable) return 'shrink-0'
    // The flex pane floors at a pane-min so a too-short rail can't squeeze it to 0px
    // (the stack scrolls instead — see the stack's overflow-y-auto below).
    return l?.flex ? 'relative flex min-h-[6rem] flex-1 flex-col' : 'relative flex min-h-0 shrink-0 flex-col'
  }

  // Drag a pane's TOP divider → a new FIXED height for THAT pane only (the flex pane
  // above absorbs). The pane's bottom edge stays put (everything below it is fixed),
  // so the drag anchors on it: height = bottom − cursor. Anchored on the effective
  // layout, so the clamp can't leak into storage.
  const startScheduledDrag = () => {
    dragBottomRef.current = scheduledPaneRef.current?.getBoundingClientRect().bottom ?? 0
  }
  const startRecentsDrag = () => {
    dragBottomRef.current = recentsPaneRef.current?.getBoundingClientRect().bottom ?? 0
  }
  // The move handlers refresh the persist ref THEMSELVES (not just at render): a
  // keyboard gesture runs move → end in one tick, before React re-renders, so an
  // at-render-only ref would persist one step stale (a reload snapped the pane back).
  const moveScheduledDrag = (clientY: number) => {
    const h = dragPane('scheduled', dragBottomRef.current - clientY, paneInputs, avail)
    scheduledHRef.current = h
    setScheduledH(h)
  }
  const moveRecentsDrag = (clientY: number) => {
    const h = dragPane('recents', dragBottomRef.current - clientY, paneInputs, avail)
    recentsHRef.current = h
    setRecentsH(h)
  }
  const persistScheduledH = () => setLayout('railScheduledH', scheduledHRef.current)
  const persistRecentsH = () => setLayout('railRecentsH', recentsHRef.current)

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
        <ResizeHandle
          side="right"
          label="Resize sidebar"
          value={railW}
          min={LEFT_MIN}
          max={LEFT_MAX}
          onStart={onResizeStart}
          onMove={onResize}
          onEnd={onResizeEnd}
        />
      )}
      {/* Rail header — the collapse toggle sits at the top-left, with a search
          icon beside it; both on one line (no separate product top bar). Search
          opens a floating palette rather than filtering inline. */}
      <div className="flex items-center gap-1 px-2 pt-2.5">
        <button
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className={SIDEBAR_ICON_BUTTON}
        >
          <PanelLeftClose size={18} />
        </button>
        <button
          onClick={onOpenSearch}
          title="Search  (⌘K)"
          aria-label="Search"
          className={SIDEBAR_ICON_BUTTON}
        >
          <Search size={18} />
        </button>
        {/* The bell (D24) — the inbox of public acts on what you watch, own, or
            posted. The badge is the unread count, live via notification.changed. */}
        <NotificationBell onClick={onOpenNotifications} />
        <PaneActionButtons onSplitRow={onSplitRow} onSplitCol={onSplitCol} onCloseView={onCloseView} />
      </div>

      {/* New session — pinned above the pane stack, in a labeled <nav> so e2e's
          navigation-role scoping finds it and the two rail navs stay landmark-unique
          (the Sections pane below is the second <nav>, carrying the section rows). */}
      <nav aria-label="Create" className="mt-3 shrink-0 px-2">
        <NavRow icon={<Plus size={16} />} label="New session" onClick={onNewSession} />
      </nav>

      {/* Rail body: an accordion of foldable, resizable panes — Sections, Scheduled,
          Recents (ADAPT-13). Each folds to its header; open panes hold a persisted FIXED
          height except the top-most open one, which flexes to fill — Sections has the
          most rows, so folding Scheduled/Recents drops their headers downward and hands
          the space to it. A divider moves only on drag (folding / new content never
          does); heights clamp at render, never in storage. On the narrow tier
          (`resizable` false) the dividers drop and the panes flow inside the scrolling
          drawer. */}
      <div
        ref={stackRef}
        className={
          resizable
            ? 'relative flex min-h-0 flex-1 flex-col overflow-y-auto'
            : 'min-h-0 flex-1 overflow-y-auto'
        }
      >
        {/* ── Sections pane ── the disclosure tree. A labeled <nav> so the section rows
            carry the navigation role (e2e scopes to it). */}
        <nav
          aria-label="Sections"
          data-rail-pane="sections"
          style={paneStyle('sections')}
          className={paneClass('sections')}
        >
          <PaneFoldHeader label="Sections" open={sectionsOpen} onToggle={toggleSectionsOpen}>
            <button
              onClick={toggleAll}
              title={allExpanded ? 'Collapse all' : 'Expand all'}
              aria-label={allExpanded ? 'Collapse all sections' : 'Expand all sections'}
              className={`flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink-soft`}
            >
              {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            </button>
          </PaneFoldHeader>
          {sectionsOpen && (
          <div className={resizable ? 'min-h-0 flex-1 overflow-y-auto px-2 pb-1' : 'px-2 pb-1'}>
        {visibleSections.map((id) => {
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
          </div>
          )}
        </nav>
        {/* ── Scheduled pane ── each row is a recurring routine; clicking opens its
            latest run. Folds to its header (like every pane); resizable when open. Its
            divider sits ABOVE it — a SIBLING between panes (an in-flow gutter), not
            inside a pane, so it never overlays scroll content / a scrollbar — and
            dragging it up grows this pane while the flex Sections pane absorbs. */}
        {routines.length > 0 && (
          <>
          {resizable && paneOf('scheduled')?.divider && (
            <PaneDivider
              label="Resize Scheduled pane"
              value={paneOf('scheduled')!.height}
              max={paneMax('scheduled', paneInputs, avail)}
              onStart={startScheduledDrag}
              onMove={moveScheduledDrag}
              onEnd={persistScheduledH}
            />
          )}
          <div
            ref={scheduledPaneRef}
            data-rail-pane="scheduled"
            style={paneStyle('scheduled')}
            className={paneClass('scheduled')}
          >
            <PaneFoldHeader label="Scheduled" open={schedOpen} onToggle={toggleSched} suffix="routines">
              <ScheduledFilterMenu
                filter={routineFilter}
                onChange={updateRoutineFilter}
                projects={projects}
              />
            </PaneFoldHeader>
            {schedOpen && (
              <div className={resizable ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
                {routineGroups.map((g) => (
                  <Fragment key={g.key}>
                    {g.label && <GroupHeader>{g.label}</GroupHeader>}
                    {g.tasks.map((t) => (
                      <RoutineRow
                        key={t.id}
                        task={t}
                        // Match the run session via the CONTRACT id-derivation, not a
                        // hand-rolled `srun-${t.id}-` prefix — that false-positived
                        // across task ids where one extends another (t1 vs t1-2:
                        // srun-t1-2-r1 startsWith srun-t1-).
                        active={inSession && t.runs.some((r) => runSessionId(t.id, r.id) === activeId)}
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
              </div>
            )}
          </div>
          </>
        )}

        {/* ── Recents pane ── one compact line per conversation. Folds to its header;
            a fixed-height pane at the bottom, its divider above it (like Scheduled). */}
        {resizable && paneOf('recents')?.divider && (
          <PaneDivider
            label="Resize Recents pane"
            value={paneOf('recents')!.height}
            max={paneMax('recents', paneInputs, avail)}
            onStart={startRecentsDrag}
            onMove={moveRecentsDrag}
            onEnd={persistRecentsH}
          />
        )}
        <div ref={recentsPaneRef} data-rail-pane="recents" className={paneClass('recents')} style={paneStyle('recents')}>
          <PaneFoldHeader label="Recents" open={recentsOpen} onToggle={toggleRecentsOpen}>
            <SessionFilterMenu filter={filter} onChange={updateFilter} projects={projects} />
          </PaneFoldHeader>
          {recentsOpen && (
          <div className={resizable ? 'min-h-0 flex-1 overflow-y-auto px-2 pb-3' : 'px-2 pb-3'}>

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
          )}
        </div>
      </div>

      <AccountChip onOpenOwner={onOpenOwner} />
    </aside>
  )
}

// The account/tenant chip + switcher/onboarding menu moved to ./AccountMenu.tsx
// (multi-account P7 — it grew the sign-in / create-account / workspace flows).

/** A pane's foldable header (ADAPT-13): the uppercase label doubles as a fold toggle
 *  with a rotating caret — the same affordance on every rail pane — and its right-side
 *  control (a filter menu, or the Sections fold-all button) shows only when open. */
/** The focused-pane action cluster — split right / split down / close — ONE
 *  component for every host: the rail's header trio row and the shell's
 *  collapsed mini-rail (App.tsx). The parent passes each handler only when the
 *  act is available, and each split direction is gated on ITS OWN viewport
 *  axis (canSplitRow: width; canSplitCol: height — src/lib/viewport.ts);
 *  close is offered iff either split is (plus a closable pane to aim at), so
 *  both hosts follow the SAME responsive rules by construction. Both split
 *  directions act on the FOCUSED pane, duplicating its content; panes are
 *  homogeneous, so the primary's tile closes too (useMainSplit). */
export function PaneActionButtons({
  onSplitRow,
  onSplitCol,
  onCloseView,
}: {
  onSplitRow?: () => void
  onSplitCol?: () => void
  onCloseView?: () => void
}) {
  return (
    <>
      {onSplitRow && (
        <button
          onClick={onSplitRow}
          title="Split right"
          aria-label="Split right"
          data-split-view="row"
          className={SIDEBAR_ICON_BUTTON}
        >
          <Columns2 size={18} />
        </button>
      )}
      {onSplitCol && (
        <button
          onClick={onSplitCol}
          title="Split down"
          aria-label="Split down"
          data-split-view="col"
          className={SIDEBAR_ICON_BUTTON}
        >
          <Rows2 size={18} />
        </button>
      )}
      {onCloseView && (
        <button
          onClick={onCloseView}
          title="Close pane"
          aria-label="Close pane"
          data-close-view
          className={SIDEBAR_ICON_BUTTON}
        >
          <X size={18} />
        </button>
      )}
    </>
  )
}

/** The notification bell + its live unread badge (D24) — ONE component for
 *  every host: the rail's header trio and the shell's collapsed mini-rail
 *  (App.tsx). The badge count reads the live notifications hook here, so a
 *  host can never render a bell without the unread cue. */
export function NotificationBell({ onClick }: { onClick: () => void }) {
  const unreadCount = (useNotifications().data ?? []).filter((r) => !r.read).length
  return (
    <button
      onClick={onClick}
      title="Notifications"
      aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      className={`relative ${SIDEBAR_ICON_BUTTON}`}
    >
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

function PaneFoldHeader({
  label,
  open,
  onToggle,
  suffix,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  suffix?: string
  children?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between pr-1 pt-2">
      <button
        onClick={onToggle}
        aria-expanded={open}
        // Include the suffix in the name so the Scheduled pane fold ("… Scheduled routines")
        // stays distinct from the Scheduled *section* row's chevron ("… Scheduled"), and the
        // accessible name matches the visible label (WCAG 2.5.3).
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}${suffix ? ` ${suffix}` : ''}`}
        className={`flex flex-1 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink-soft`}
      >
        {label}
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {suffix && (
          <span className="font-normal normal-case tracking-normal text-ink-faint">{suffix}</span>
        )}
      </button>
      {open && children}
    </div>
  )
}

/** A pane divider: an in-flow gutter carrying the shared horizontal ResizeHandle, so it
 *  sits BETWEEN two panes — not overlaying either pane's scroll content or scrollbar —
 *  with a persistent, easy-to-spot hairline centered in it. It rides ABOVE the pane it
 *  resizes (side="top": dragging / arrowing up grows that pane; the flex pane above —
 *  normally Sections — absorbs). */
function PaneDivider({
  label,
  value,
  max,
  onStart,
  onMove,
  onEnd,
}: {
  /** Distinct accessible name per divider ("Resize Sections pane", …) — see ResizeHandle. */
  label: string
  /** The pane's EFFECTIVE (on-screen) height and its current ceiling (`paneMax`) —
   *  the handle's aria-valuenow/-max; the floor is always RAIL_PANE_MIN. */
  value: number
  max: number
  onStart: () => void
  onMove: (clientY: number) => void
  onEnd: () => void
}) {
  return (
    <div className="relative h-2 shrink-0">
      <ResizeHandle
        side="top"
        label={label}
        value={value}
        min={RAIL_PANE_MIN}
        max={max}
        onStart={onStart}
        onMove={onMove}
        onEnd={onEnd}
      />
    </div>
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
      <button
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
      >
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
            // Not the IME-composition-commit Enter (isComposing) — that would
            // commit the rename mid-composition.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-1 py-0.5 text-[13px] text-ink outline-none focus:border-accent"
        />
      ) : (
        <button
          onClick={onSelect}
          title={session.preview}
          aria-current={active ? 'page' : undefined}
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
