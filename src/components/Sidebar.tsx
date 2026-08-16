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
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronRight,
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
import { RAIL_INSTANCE_CAP, SECTION_INSTANCE_KEY } from '../lib/subviews'
import { SECTION_FILTERS } from '../lib/sectionFilter'
import {
  NoRowsRow,
  AgentTreeChildren,
  OwnerProfileChild,
  RailTreeBranch,
  SectionInstanceChildren,
  ShowAllRow,
  SubNavRow,
  type RailFoldSignal,
} from './SectionTreeChildren'
import { SectionFilterMenu } from './SectionFilterMenu'
import { OWNER_SECTION, type PaneSeed } from '../lib/paneNav'
import {
  SIDEBAR_ACTIVE,
  SIDEBAR_FOCUS_WITHIN,
  SIDEBAR_HOVER,
  SIDEBAR_ICON_BUTTON,
} from '../lib/sidebar'
import {
  removeSchedule,
  runScheduleNow,
  toggleScheduleEnabled,
  useMe,
  useDiscussions,
  useNotifications,
  useSchedules,
} from '../api'
import { AccountChip } from './AccountMenu'
import { useRelations } from '../controller/useRelations'
import { runSessionId } from '../../contract/ids.ts'
import { discussionTitle } from '../../contract/social.ts'
import {
  SCHEDULE_SECTIONS,
  scheduleSection,
  visibleCompositeSections,
  type ScheduleSectionId,
} from '../lib/compositeSections'
import { getLayout, setLayout } from '../lib/uiPrefs'
import {
  dragPane,
  layoutPanes,
  paneMax,
  planRailPaneClose,
  NO_RAIL_SPLIT,
  RAIL_PANE_MIN,
  RAIL_SPLIT_DEFAULT,
  splitRailSections,
  type PaneId,
  type PaneInput,
} from '../lib/railPanes'
import { LEFT_MIN, LEFT_MAX } from '../controller/useLayout'
import { clampSessionFilter, filterSessions, type SessionFilter, type SessionGroup } from '../lib/sessionFilter'
import { useSessionFilter } from '../lib/useSessionFilter'
import {
  clampRoutineFilter,
  filterRoutines,
  type RoutineGroup,
  type RoutineFilter,
} from '../lib/routineFilter'
import { useRoutineFilter } from '../lib/useRoutineFilter'
import { CompositeRailControls } from './CompositeRailControls'
import type { CompositeCommandKind, CompositeFoldSignal } from '../lib/compositeFeatures'
import { useCompositeFoldSignal } from '../lib/useCompositeFeatures'


/** Does this section's row expand? Every LIST kind counts (UI-19) — a declared
 *  surface list, its section-detail rows, or Sessions' canonical `/s/:id` rows.
 *  A standing door deliberately
 *  does NOT: it is one fixed row, so a section whose only child was a door would
 *  be a chevron hiding a single link. It rides a section that already expands
 *  (`src/lib/owner-door.test.ts` asserts that pairing, since losing it would make
 *  the door vanish with nothing failing). Module-level so the state initializer
 *  can call it before the component body runs. */
function hasChildren(id: SectionId): boolean {
  return id === 'sessions' || !!SECTION_SUBVIEWS[id] || !!SECTION_INSTANCE_KEY[id]
}

export function Sidebar({
  sessions,
  activeId,
  activeSection,
  activeSubview,
  activeSeed,
  onSelect,
  onNewSession,
  onOpenSection,
  onOpenSubview,
  onOpenDetail,
  onCompositeCommand,
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
  /** The focused pane's open DETAIL (its live seed: which project / artifact /
   *  context / provider / thread it shows) — the instance child's highlight, so
   *  a project opened from anywhere lights its row in the rail (UI-19). */
  activeSeed: PaneSeed | null
  onSelect: (id: string) => void
  onNewSession: () => void
  onOpenSection: (s: SectionId) => void
  /** Switch the active section's sub-view (a rail drill-in row). */
  /** A facet (sub-view) pick — carries its SECTION so the parent can route the
   *  pair into a focused split pane (the primary path ignores the section: the
   *  tree row already opened it). */
  onOpenSubview: (section: SectionId, id: string) => void
  /** Open ONE row of a content section — the section, seeded with the detail id
   *  (UI-19: a rail instance child is a place, so it opens that place). */
  onOpenDetail: (section: SectionId, seed: PaneSeed) => void
  /** Invoke the focused main page's matching resource capability. */
  onCompositeCommand: (section: SectionId, kind: CompositeCommandKind) => void
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
  // children carries a chevron and expands IN PLACE to show them indented below it — no
  // push, no back button, siblings stay visible. Several sections can be open at once.
  // An effect expands the active section, so a deep-link into it reveals its children.
  //
  // A section has children through the honest list cases (UI-19, src/lib/subviews.ts): declared
  // SURFACES (the Agents hub, the maintainer console, the Commons' lenses) or
  // live INSTANCES (its own rows — Projects, Artifacts, Contexts, Models,
  // Discussions), plus Sessions' `/s/:id` rows. One predicate, so every expand/fold mechanism below treats
  // both kinds identically.
  // The expansion set persists PER ACCOUNT through the scoped layout store
  // (one boolean per section — uiPrefs.ts), so a switch-back or reload finds
  // the tree folded exactly as that account left it. Only EXPLICIT toggles
  // persist; the active-section auto-expansion below stays derived (the
  // restored activeSection re-produces it), so navigating never pins a
  // section open in storage.
  const [expanded, setExpanded] = useState<Set<SectionId>>(() => {
    const s = new Set<SectionId>()
    for (const id of SECTION_ORDER) if (hasChildren(id) && getLayout(`treeOpen.${id}`, false)) s.add(id)
    if (activeSection && hasChildren(activeSection)) s.add(activeSection)
    return s
  })
  useEffect(() => {
    if (activeSection && hasChildren(activeSection))
      setExpanded((prev) => (prev.has(activeSection) ? prev : new Set(prev).add(activeSection)))
  }, [activeSection])
  // Persistence sits BESIDE each setState, never inside its updater: React may
  // run an updater during the render phase, and a setLayout there notifies the
  // live useSectionFilter readers mid-render — the "Cannot update a component
  // while rendering a different component" console error this rail shipped
  // until 2026-07-31. Locked by src/lib/pure-updaters.test.ts.
  const toggleExpand = (id: SectionId) => {
    const willOpen = !expanded.has(id)
    setLayout(`treeOpen.${id}`, willOpen)
    setExpanded((prev) => {
      const next = new Set(prev)
      willOpen ? next.add(id) : next.delete(id)
      return next
    })
  }

  // The maintainer console's rail row is CHROME gated on the identity's
  // `instanceAdmin` grant (the server's 404 wall is the real gate) — everyone
  // else sees the roster without it.
  const instanceAdmin = useMe().data?.instanceAdmin === true
  const visibleSections = useMemo(
    () => SECTION_ORDER.filter((id) => id !== 'admin' || instanceAdmin),
    [instanceAdmin],
  )
  // Fold / unfold all — two explicit acts, matching the composite page. The
  // signal reaches every mounted nested branch; expanding top-level rows mounts
  // the rest with the same request, so this controls the whole visible forest.
  const expandableIds = useMemo(() => visibleSections.filter(hasChildren), [visibleSections])
  const [railFoldSignal, setRailFoldSignal] = useState<RailFoldSignal | null>(null)
  const [branchFoldSignals, setBranchFoldSignals] = useState<Partial<Record<SectionId, CompositeFoldSignal>>>({})
  const compositeFold = useCompositeFoldSignal()
  const requestRailFold = (open: boolean) => {
    for (const id of expandableIds) setLayout(`treeOpen.${id}`, open)
    setExpanded(open ? new Set(expandableIds) : new Set())
    // A newer forest-wide posture supersedes older resource-local requests.
    // Otherwise a cached branch signal would keep winning through `??` below
    // and a later global Unfold all could leave that one branch collapsed.
    setBranchFoldSignals({})
    setRailFoldSignal((current) => ({ revision: (current?.revision ?? 0) + 1, expanded: open }))
  }
  // The selected composite's page and rail branch consume one bulk-disclosure
  // request. Keep the parent row visible — folding a resource collapses its
  // interiors, not the resource out of the forest altogether.
  useEffect(() => {
    if (!compositeFold) return
    if (hasChildren(compositeFold.section)) {
      setExpanded((current) =>
        current.has(compositeFold.section)
          ? current
          : new Set(current).add(compositeFold.section),
      )
    }
    setBranchFoldSignals((current) => ({
      ...current,
      [compositeFold.section]: compositeFold,
    }))
  }, [compositeFold?.revision])

  // Clicking a section row: open its page, and — if it has children — expand it in place
  // (keeping the narrow drawer open so the children show, so you can pick one). A childless
  // section is a leaf: it navigates and dismisses the narrow drawer.
  const onSectionClick = (id: SectionId) => {
    onOpenSection(id)
    if (hasChildren(id)) setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    else onLeafNavigate?.()
  }
  // Clicking a child (a sub-node): make sure its section is active, then select it, and
  // dismiss the narrow drawer (a child is a leaf — it navigates).
  const onChildClick = (id: SectionId, subviewId: string) => {
    if (activeSection !== id) onOpenSection(id)
    onOpenSubview(id, subviewId)
    onLeafNavigate?.()
  }
  // Scheduled is a normal instance branch in the account-resource forest. The
  // branch lists recurring routines (not runs) from the same live source as its
  // main page; a routine then discloses its sections and canonical resources.
  const routines = useSchedules().data ?? []

  const { applyOp, projectIdForSession, scheduleProjectId, allProjects } = useRelations()
  // The LIVE project registry — seeds + runtime-created (graph.extraProjects), the
  // same list the Projects page renders. The rail must not read the seed-only
  // /projects mirror: a just-created project would be nameless here ("Project")
  // and missing from every "Add to project" / filter menu (registries have one
  // home and live points-of-use).
  const projects = useMemo(() => allProjects(), [allProjects])
  const projectName = (pid: string) => projects.find((p) => p.id === pid)?.name ?? 'Project'

  // Sessions "Filter & sort": one live choice shared with the main page, plus
  // the project membership /
  // names it needs to filter and group by project (read from the relations graph).
  // The stored blob is browser-wide while its projectId is tenant-scoped, so the
  // choice CLAMPS at render (never in storage): a dangling id — another account's
  // project, or a deleted one — reads as 'all' instead of hiding every row.
  const [rawFilter, setFilter] = useSessionFilter()
  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const filter = clampSessionFilter(rawFilter, projectIds)
  const updateFilter = (next: SessionFilter) => setFilter(next)
  const { groups, total } = useMemo(() => {
    return filterSessions(sessions, filter, {
      projectIdOf: projectIdForSession,
      projectName,
      now: Date.now(),
    })
  }, [sessions, filter, projectIdForSession, projects])

  // The Scheduled branch gets the same "Filter & sort" control, retuned for
  // routines (Status active/paused, group by project). Its live per-account
  // choice is shared with the main page.
  const [rawRoutineFilter, setRoutineFilter] = useRoutineFilter()
  const routineFilter = clampRoutineFilter(rawRoutineFilter, projectIds)
  const updateRoutineFilter = (next: RoutineFilter) => {
    setRoutineFilter(next)
  }
  const { groups: routineGroups, total: routineTotal } = useMemo(() => {
    return filterRoutines(routines, routineFilter, {
      projectIdOfTask: scheduleProjectId,
      projectName,
    })
  }, [routines, routineFilter, scheduleProjectId, projects])

  // ── Generic split of ONE ordered resource forest (ADAPT-13) ────────────────
  // The split point is layout metadata, not a content container: the lower pane
  // begins at any ordinary top-level section and contains that ordered suffix.
  // Sessions is the default boundary, preserving quick access to conversation
  // history without giving it a second ontology or a special header.
  const [splitStart, setSplitStart] = useState<string>(() => getLayout('railSplitStart', 'sessions'))
  const sectionGroups = splitRailSections(visibleSections, splitStart)
  const splitActive = resizable && sectionGroups.length === 2
  const updateSplitStart = (next: string) => {
    setLayout('railSplitStart', next)
    setSplitStart(next)
  }
  const stackRef = useRef<HTMLDivElement>(null)
  const lowerPaneRef = useRef<HTMLDivElement>(null)
  const upperScrollRef = useRef<HTMLDivElement>(null)
  const lowerScrollRef = useRef<HTMLDivElement>(null)
  const pendingPaneCloseRef = useRef<{
    survivor: PaneId
    anchor: SectionId | null
    upperOffset: number
    lowerOffset: number
  } | null>(null)
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
  const [lowerH, setLowerH] = useState<number>(() =>
    getLayout('railSplitH', getLayout('railRecentsH', RAIL_SPLIT_DEFAULT)),
  )
  const lowerHRef = useRef(lowerH)
  lowerHRef.current = lowerH

  const paneInputs: PaneInput[] = [
    { id: 'upper', present: true, height: 0 },
    { id: 'lower', present: splitActive, height: lowerH },
  ]
  const layout = layoutPanes(paneInputs, avail)
  const paneOf = (id: PaneId) => layout.find((p) => p.id === id)
  // A fixed (open, non-flex) pane gets an explicit height; the flex pane fills via
  // flex-1; a folded pane collapses to its (auto-height) header.
  const paneStyle = (id: PaneId) => {
    const l = paneOf(id)
    return resizable && l && !l.flex ? { height: l.height } : undefined
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
  const startLowerDrag = () => {
    dragBottomRef.current = lowerPaneRef.current?.getBoundingClientRect().bottom ?? 0
  }
  // The move handlers refresh the persist ref THEMSELVES (not just at render): a
  // keyboard gesture runs move → end in one tick, before React re-renders, so an
  // at-render-only ref would persist one step stale (a reload snapped the pane back).
  const moveLowerDrag = (clientY: number) => {
    const h = dragPane('lower', dragBottomRef.current - clientY, paneInputs, avail)
    lowerHRef.current = h
    setLowerH(h)
  }
  const persistLowerH = () => setLayout('railSplitH', lowerHRef.current)

  // Apply a pane-close restoration only after React has committed the merged
  // forest. Doing this in the click handler's next animation frame races a
  // concurrent render and can still observe the old split DOM.
  useLayoutEffect(() => {
    const pending = pendingPaneCloseRef.current
    const body = upperScrollRef.current
    if (!pending || sectionGroups.length !== 1 || !body) return
    pendingPaneCloseRef.current = null
    if (pending.survivor === 'upper') {
      body.scrollTop = pending.upperOffset
      return
    }
    const anchor = pending.anchor
      ? body.querySelector<HTMLElement>(`[data-section-root="${pending.anchor}"]`)
      : null
    if (!anchor) {
      body.scrollTop = pending.lowerOffset
      return
    }
    const bodyTop = body.getBoundingClientRect().top
    const anchorTop = anchor.getBoundingClientRect().top
    body.scrollTop += anchorTop - bodyTop + pending.lowerOffset
  }, [splitStart])

  // Closing either half removes only the presentation split. The complete
  // forest returns in one pane, positioned where the pane the user kept was
  // being read: a direct scroll offset for the upper pane, or the lower pane's
  // first section plus its local offset when the upper pane is closed.
  const closeRailPane = (closing: PaneId) => {
    const plan = planRailPaneClose(sectionGroups, closing)
    if (!plan) return
    pendingPaneCloseRef.current = {
      survivor: plan.survivor,
      anchor: plan.anchor,
      upperOffset: upperScrollRef.current?.scrollTop ?? 0,
      lowerOffset: lowerScrollRef.current?.scrollTop ?? 0,
    }
    updateSplitStart(NO_RAIL_SPLIT)
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

  const sessionMenuItems = (session: Session): RowMenuItem[] => [
    {
      kind: 'action',
      key: 'pin',
      label: session.pinned ? 'Unpin' : 'Pin',
      icon: session.pinned ? <PinOff size={15} /> : <Pin size={15} />,
      onSelect: () => onPinSession(session.id, !session.pinned),
    },
    {
      kind: 'action',
      key: 'rename',
      label: 'Rename',
      icon: <Pencil size={15} />,
      onSelect: () => {}, // SessionRow replaces this with its inline editor.
    },
    ...sessionProjectItems(session),
    { kind: 'divider', key: 'd1' },
    {
      kind: 'action',
      key: 'archive',
      label: session.status === 'archived' ? 'Unarchive' : 'Archive',
      icon: session.status === 'archived' ? <ArchiveRestore size={15} /> : <Archive size={15} />,
      onSelect: () => onArchiveSession(session.id, session.status !== 'archived'),
    },
    {
      kind: 'action',
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 size={15} />,
      danger: true,
      confirm: `Delete “${session.title}”? A server restart restores the seed.`,
      onSelect: () => onDeleteSession(session.id),
    },
  ]

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

  const routineMenuItems = (t: ScheduledTask): RowMenuItem[] => [
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
  ]

  const railViewItems: RowMenuItem[] = [
    {
      kind: 'action',
      key: 'fold-all',
      label: 'Fold all',
      icon: <ChevronsUp size={15} />,
      onSelect: () => requestRailFold(false),
    },
    {
      kind: 'action',
      key: 'unfold-all',
      label: 'Unfold all',
      icon: <ChevronsDown size={15} />,
      onSelect: () => requestRailFold(true),
    },
    { kind: 'divider', key: 'layout-divider' },
    {
      kind: 'choice',
      key: 'lower-pane',
      label: 'Lower pane',
      icon: <Rows2 size={15} />,
      currentId:
        sectionGroups.length === 2 ? (sectionGroups[1][0] ?? NO_RAIL_SPLIT) : NO_RAIL_SPLIT,
      options: [
        { id: NO_RAIL_SPLIT, label: 'One pane' },
        ...visibleSections.slice(1).map((id) => ({
          id,
          label: `Start at ${SECTION_META[id].label}`,
        })),
      ],
      onPick: updateSplitStart,
    },
  ]
  if (splitActive) {
    railViewItems.push(
      { kind: 'divider', key: 'close-divider' },
      {
        kind: 'action',
        key: 'close-upper',
        label: 'Close upper pane',
        icon: <X size={15} />,
        onSelect: () => closeRailPane('upper'),
      },
      {
        kind: 'action',
        key: 'close-lower',
        label: 'Close lower pane',
        icon: <X size={15} />,
        onSelect: () => closeRailPane('lower'),
      },
    )
  }

  return (
    <aside
      className={`relative flex h-full w-full shrink-0 flex-col bg-sidebar ${
        resizable ? '' : 'border-r border-line'
      }`}
    >
      {resizable && (
        <ResizeHandle
          side="right"
          label="Resize sidebar"
          ownsEdge
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
      <div data-rail-toolbar className="flex items-center px-2 pt-2.5">
        <div data-rail-toolbar-group="global" className="flex items-center gap-1">
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
          {/* The bell (D24) — the inbox of public acts on what you watch, own,
              or posted. The badge is live via notification.changed. */}
          <NotificationBell onClick={onOpenNotifications} />
          <RowMenu
            ariaLabel="Rail view options"
            triggerIcon={<Rows2 size={18} />}
            triggerClassName={SIDEBAR_ICON_BUTTON}
            items={railViewItems}
          />
        </div>
        {(onSplitRow || onSplitCol || onCloseView) && (
          <div
            data-rail-toolbar-group="view"
            className="ml-auto flex items-center gap-1 border-l border-line pl-1.5"
          >
            <PaneActionButtons
              onSplitRow={onSplitRow}
              onSplitCol={onSplitCol}
              onCloseView={onCloseView}
            />
          </div>
        )}
      </div>

      {/* New session — pinned above the pane stack, in a labeled <nav> so e2e's
          navigation-role scoping finds it and the two rail navs stay landmark-unique
          (the Sections pane below is the second <nav>, carrying the section rows). */}
      <nav aria-label="Create" className="mt-3 shrink-0 px-2">
        {/* New session is a rail ROW, not a solid (owner directive 2026-08-10:
            "we don't need such a showy color for new session — spare the color
            for more important scenarios"). It had been the app's ONE CTA-tier
            solid, a claret slab across the top of a panel whose every other row
            is quiet text — which spent the loudest ink in the system on
            navigation chrome, and left nothing louder for the acts inside the
            workspace that actually commit something.
            What makes it findable now is POSITION (first row, its own <nav>) and
            the ringed glyph, not fill: the same way the desktop app's own
            sidebar does it. The accent survives here as the icon alone — one
            small claret mark, which is the seat law's "verbs wear accent" at the
            smallest dose that still reads. */}
        <button
          onClick={onNewSession}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink transition ${SIDEBAR_HOVER}`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-line-strong">
            <Plus size={13} className="text-accent" />
          </span>
          New session
        </button>
      </nav>

      {/* One resource forest, optionally projected into two independently
          scrolling panes. A split point only divides the ordered top-level
          rows; it adds no headers, containers, or hierarchy. On the narrow tier
          the divider drops and every row flows in one drawer. */}
      <div
        ref={stackRef}
        className={
          resizable
            ? 'relative flex min-h-0 flex-1 flex-col overflow-y-auto'
            : 'min-h-0 flex-1 overflow-y-auto'
        }
      >
        <nav aria-label="Sections" className="contents">
          {sectionGroups.map((sectionIds, paneIndex) => (
            <Fragment key={paneIndex === 0 ? 'upper' : `lower-${sectionIds[0]}`}>
              {paneIndex === 1 && splitActive && paneOf('lower')?.divider && (
                <PaneDivider
                  label="Resize lower rail pane"
                  value={paneOf('lower')!.height}
                  max={paneMax('lower', paneInputs, avail)}
                  onStart={startLowerDrag}
                  onMove={moveLowerDrag}
                  onEnd={persistLowerH}
                />
              )}
              <div
                ref={paneIndex === 1 ? lowerPaneRef : undefined}
                data-rail-pane={paneIndex === 0 ? 'upper' : 'lower'}
                style={paneStyle(paneIndex === 0 ? 'upper' : 'lower')}
                className={paneClass(paneIndex === 0 ? 'upper' : 'lower')}
              >
                <div
                  ref={paneIndex === 0 ? upperScrollRef : lowerScrollRef}
                  data-rail-scroll-pane={paneIndex === 0 ? 'upper' : 'lower'}
                  className={resizable ? 'min-h-0 flex-1 overflow-y-auto px-2 pb-1' : 'px-2 pb-1'}
                >
        {sectionIds.map((id) => {
          const { label, Icon, beta } = SECTION_META[id]
          const surfaces = SECTION_SUBVIEWS[id]
          const instanceKey = SECTION_INSTANCE_KEY[id]
          const isExpanded = expanded.has(id)
          // Which DETAIL page of this section the focused pane is showing (null
          // = the section's own default view) — the id a child highlights on.
          // Read from the pane's LIVE detail, so opening a project from anywhere
          // lights its rail row. Usually the instance key's id; the Commons
          // additionally hosts namespace PROFILES, whose detail key is
          // `ownerName` (OWNER_SECTION) — without this the section row would
          // claim to be on its feed while a profile filled the pane.
          const activeLeafId = instanceKey
            ? (activeSeed?.[instanceKey] ?? null)
            : id === 'agents'
              ? (activeSeed?.agentId ?? activeSeed?.promptId ?? activeSeed?.toolId ?? null)
            : id === OWNER_SECTION
              ? (activeSeed?.ownerName ?? null)
              : null
          const activeDetailId = activeSeed?.collectionSectionId ?? activeLeafId
          return (
            <Fragment key={id}>
              <SectionTreeRow
                sectionId={id}
                icon={<Icon size={16} />}
                label={label}
                beta={beta}
                hasChildren={hasChildren(id)}
                expanded={isExpanded}
                // The section row is "active" only on its own default view: no sub-view
                // AND no detail open — when a child is selected the child carries the
                // highlight instead.
                active={activeSection === id && activeSubview == null && activeDetailId === null}
                onToggle={() => toggleExpand(id)}
                onOpen={() => onSectionClick(id)}
                // The rail projection of the section's live filter (UI-19/UI-37).
                // Rendered for every section that has a partition, whether its
                // children are surfaces or rows; the page mirrors this control.
                trailing={
                  <div className="flex shrink-0 items-center gap-0.5">
                    {id === 'sessions' ? (
                      <SessionFilterMenu filter={filter} onChange={updateFilter} projects={projects} />
                    ) : id === 'scheduled' ? (
                      <ScheduledFilterMenu
                        filter={routineFilter}
                        onChange={updateRoutineFilter}
                        projects={projects}
                      />
                    ) : SECTION_FILTERS[id] ? (
                      <SectionFilterMenu section={id} />
                    ) : null}
                    <CompositeRailControls
                      section={id}
                      onCommand={(kind) => {
                        onCompositeCommand(id, kind)
                        onLeafNavigate?.()
                      }}
                    />
                  </div>
                }
              />
              {isExpanded && (
                <RailTreeBranch data-section-tree={id}>
                  {id === OWNER_SECTION && onOpenOwner && (
                    // The standing door — YOUR public face, first among the
                    // Commons' children because it is the one that is you.
                    <OwnerProfileChild
                      activeOwner={activeSection === id ? (activeSeed?.ownerName ?? null) : null}
                      onOpenOwner={onOpenOwner}
                    />
                  )}
                  {id === 'sessions' ? (
                    <SessionTreeChildren
                      groups={groups}
                      total={total}
                      renderSession={(session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          active={inSession && session.id === activeId}
                          onSelect={() => {
                            onSelect(session.id)
                            onLeafNavigate?.()
                          }}
                          onRename={(title) => onRenameSession(session.id, title)}
                          menuItems={sessionMenuItems(session)}
                        />
                      )}
                    />
                  ) : id === 'agents' ? (
                    <AgentTreeChildren
                      activeSubview={activeSection === id ? activeSubview : null}
                      activeSeed={activeSection === id ? activeSeed : null}
                      onOpenSubview={(subviewId) => onChildClick(id, subviewId)}
                      onOpenDetail={(section, seed) => {
                        onOpenDetail(section, seed)
                        onLeafNavigate?.()
                      }}
                      foldSignal={branchFoldSignals[id] ?? railFoldSignal}
                    />
                  ) : id === 'scheduled' ? (
                    <ScheduledTreeChildren
                      groups={routineGroups}
                      total={routineTotal}
                      renderRoutine={(t) => (
                        <RoutineRow
                          key={t.id}
                          task={t}
                          activeRunId={
                            inSession
                              ? (t.runs.find((r) => runSessionId(t.id, r.id) === activeId)?.id ?? null)
                              : null
                          }
                          pageActive={
                            activeSection === 'scheduled' &&
                            activeSeed?.scheduleId === t.id &&
                            !activeSeed.scheduleSectionId
                          }
                          activeSectionId={
                            activeSection === 'scheduled' && activeSeed?.scheduleId === t.id
                              ? (scheduleSection(activeSeed.scheduleSectionId)?.id ?? null)
                              : null
                          }
                          onOpenPage={() => {
                            onOpenSchedule(t.id)
                            onLeafNavigate?.()
                          }}
                          onOpenSection={(sectionId) => {
                            onOpenDetail('scheduled', { scheduleId: t.id, scheduleSectionId: sectionId })
                            onLeafNavigate?.()
                          }}
                          onOpenRun={(runId) => {
                            onSelect(runSessionId(t.id, runId))
                            onLeafNavigate?.()
                          }}
                          onOpenDiscussion={(discussionId) => {
                            onOpenDetail('discussions', { discussionId })
                            onLeafNavigate?.()
                          }}
                          menuItems={routineMenuItems(t)}
                          foldSignal={branchFoldSignals[id] ?? railFoldSignal}
                        />
                      )}
                    />
                  ) : surfaces ? (
                    surfaces.map((sv) => (
                      <SubNavRow
                        key={sv.id}
                        label={sv.label}
                        active={activeSection === id && activeSubview === sv.id}
                        onClick={() => onChildClick(id, sv.id)}
                      />
                    ))
                  ) : instanceKey ? (
                    <SectionInstanceChildren
                      section={id}
                      activeId={activeLeafId}
                      activeSeed={activeSeed}
                      activeSessionId={inSession ? activeId : null}
                      onOpenDetail={(section, seed) => {
                        onOpenDetail(section, seed)
                        onLeafNavigate?.()
                      }}
                      onOpenSession={(sessionId) => {
                        onSelect(sessionId)
                        onLeafNavigate?.()
                      }}
                      foldSignal={branchFoldSignals[id] ?? railFoldSignal}
                    />
                  ) : null}
                </RailTreeBranch>
              )}
            </Fragment>
          )
        })}
                </div>
              </div>
            </Fragment>
          ))}
        </nav>
      </div>

      <AccountChip onOpenOwner={onOpenOwner} />
    </aside>
  )
}

// The account/tenant chip + switcher/onboarding menu moved to ./AccountMenu.tsx
// (multi-account P7 — it grew the sign-in / create-account / workspace flows).

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
 *  host can never render a bell without the unread cue.
 *
 *  Since 2026-08-08 it is a DOOR to `/notifications` rather than the opener of
 *  an overlay — the same page the rail's Notifications row opens. Two controls
 *  to one place is deliberate (GitHub's bell + inbox): this one is always
 *  visible and carries the count. They therefore share an accessible name, so
 *  the bell carries a testid — the rail row is reachable through the Sections
 *  nav landmark, and this one is not in any nav. */
export function NotificationBell({ onClick }: { onClick: () => void }) {
  const unreadCount = (useNotifications().data ?? []).filter((r) => !r.read).length
  return (
    <button
      onClick={onClick}
      data-testid="notification-bell"
      title="Notifications"
      aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      className={`relative ${SIDEBAR_ICON_BUTTON}`}
    >
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 text-[10px] font-semibold leading-none text-on-solid">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

/** A pane divider: an in-flow gutter carrying the shared horizontal ResizeHandle, so it
 *  sits BETWEEN two panes — not overlaying either pane's scroll content or scrollbar —
 *  with a persistent, easy-to-spot hairline centered in it. It rides ABOVE the pane it
 *  resizes (side="top": dragging / arrowing up grows the lower pane while the
 *  upper pane absorbs the difference). */
function PaneDivider({
  label,
  value,
  max,
  onStart,
  onMove,
  onEnd,
}: {
  /** Distinct accessible name for the lower-pane divider — see ResizeHandle. */
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
        active ? SIDEBAR_ACTIVE : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
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
  sectionId,
  icon,
  label,
  beta,
  hasChildren,
  expanded,
  active,
  onToggle,
  onOpen,
  trailing,
}: {
  sectionId: SectionId
  icon: ReactNode
  label: string
  beta?: boolean
  hasChildren: boolean
  expanded: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
  /** The row's own control — the section's "Filter & sort" menu. Outside the
   *  opening button (like the Sessions rows' "⋮"), so choosing a facet doesn't
   *  also navigate. */
  trailing?: ReactNode
}) {
  return (
    <div
      data-section-root={sectionId}
      className={`group flex w-full items-center rounded-lg pr-2 text-[13px] transition ${SIDEBAR_FOCUS_WITHIN} ${
        active ? SIDEBAR_ACTIVE : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
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
      {trailing}
    </div>
  )
}

/** One Sessions row — a leading dot (or pin), the title, and a hover "⋮" menu.
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
      className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 transition ${SIDEBAR_FOCUS_WITHIN} ${
        active ? SIDEBAR_ACTIVE : SIDEBAR_HOVER
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
          className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-1 py-0.5 text-[13px] text-ink outline-none focus:border-co"
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

/** The Sessions section's live instance children. Group labels are view
 * partitions selected by its filter, not structural navigation nodes. */
function SessionTreeChildren({
  groups,
  total,
  renderSession,
}: {
  groups: SessionGroup[]
  total: number
  renderSession: (session: Session) => ReactNode
}) {
  const [showAll, setShowAll] = useState(false)
  if (total === 0) return <NoRowsRow>No sessions match these filters.</NoRowsRow>
  let remaining = showAll ? Number.POSITIVE_INFINITY : RAIL_INSTANCE_CAP
  const visibleGroups = groups
    .map((group) => {
      const sessions = group.sessions.slice(0, Math.max(0, remaining))
      remaining -= sessions.length
      return { ...group, sessions }
    })
    .filter((group) => group.sessions.length > 0)
  return (
    <>
      {visibleGroups.map((group) => (
        <Fragment key={group.key}>
          {group.label && <GroupHeader>{group.label}</GroupHeader>}
          {group.sessions.map(renderSession)}
        </Fragment>
      ))}
      {total > RAIL_INSTANCE_CAP && (
        <ShowAllRow
          hidden={total - RAIL_INSTANCE_CAP}
          open={showAll}
          onToggle={() => setShowAll((value) => !value)}
        />
      )}
    </>
  )
}

/** The Scheduled section's instance head. It keeps the shared eight-row cap
 * even when the chosen grouping divides the list into several visual bands. */
function ScheduledTreeChildren({
  groups,
  total,
  renderRoutine,
}: {
  groups: RoutineGroup[]
  total: number
  renderRoutine: (task: ScheduledTask) => ReactNode
}) {
  const [showAll, setShowAll] = useState(false)
  if (total === 0) return <NoRowsRow>No routines match these filters.</NoRowsRow>
  let remaining = showAll ? Number.POSITIVE_INFINITY : RAIL_INSTANCE_CAP
  const visibleGroups = groups
    .map((group) => {
      const tasks = group.tasks.slice(0, Math.max(0, remaining))
      remaining -= tasks.length
      return { ...group, tasks }
    })
    .filter((group) => group.tasks.length > 0)
  return (
    <>
      {visibleGroups.map((group) => (
        <Fragment key={group.key}>
          {group.label && <GroupHeader>{group.label}</GroupHeader>}
          {group.tasks.map(renderRoutine)}
        </Fragment>
      ))}
      {total > RAIL_INSTANCE_CAP && (
        <ShowAllRow
          hidden={total - RAIL_INSTANCE_CAP}
          open={showAll}
          onToggle={() => setShowAll((value) => !value)}
        />
      )}
    </>
  )
}

/** One Scheduled-routine branch — the parent opens the complete routine page;
 * its disclosure preserves the routine's section pages before run/discussion
 * resources. */
function RoutineRow({
  task,
  activeRunId,
  pageActive,
  activeSectionId,
  onOpenPage,
  onOpenSection,
  onOpenRun,
  onOpenDiscussion,
  menuItems,
  foldSignal,
}: {
  task: ScheduledTask
  activeRunId: string | null
  pageActive: boolean
  activeSectionId: ScheduleSectionId | null
  onOpenPage: () => void
  onOpenSection: (sectionId: ScheduleSectionId) => void
  onOpenRun: (runId: string) => void
  onOpenDiscussion: (discussionId: string) => void
  menuItems: RowMenuItem[]
  foldSignal?: RailFoldSignal | null
}) {
  // A routine is the composite; a run is one of its children. The old row
  // skipped the parent whenever a run existed and opened the latest child,
  // making the routine page unreachable from the very tree that listed it.
  // Expansion is local disclosure state; an active parent or run opens its
  // branch so the current place is always visible.
  const [expanded, setExpanded] = useState(pageActive || activeSectionId !== null || activeRunId !== null)
  useEffect(() => {
    if (pageActive || activeSectionId !== null || activeRunId !== null) setExpanded(true)
  }, [pageActive, activeSectionId, activeRunId])
  useEffect(() => {
    if (foldSignal) setExpanded(foldSignal.expanded)
  }, [foldSignal])
  return (
    <>
      <div
        className={`group flex w-full items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 text-[13px] font-medium transition ${SIDEBAR_FOCUS_WITHIN} ${
          pageActive ? SIDEBAR_ACTIVE : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${task.name}`}
          aria-expanded={expanded}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <RoutineDot enabled={task.enabled} lastStatus={task.lastStatus} />
        <button
          onClick={onOpenPage}
          title={`${task.cadence} · ${task.subtitle}`}
          aria-current={pageActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {task.name}
        </button>
        <RowMenu ariaLabel={`Actions for ${task.name}`} items={menuItems} />
      </div>
      {expanded && (
        <RailTreeBranch data-routine-tree={task.id}>
          <RoutineSectionRows
            task={task}
            activeSectionId={activeSectionId}
            activeRunId={activeRunId}
            onOpenSection={onOpenSection}
            onOpenRun={onOpenRun}
            onOpenDiscussion={onOpenDiscussion}
            foldSignal={foldSignal}
          />
        </RailTreeBranch>
      )}
    </>
  )
}

function RoutineSectionRows({
  task,
  activeSectionId,
  activeRunId,
  onOpenSection,
  onOpenRun,
  onOpenDiscussion,
  foldSignal,
}: {
  task: ScheduledTask
  activeSectionId: ScheduleSectionId | null
  activeRunId: string | null
  onOpenSection: (sectionId: ScheduleSectionId) => void
  onOpenRun: (runId: string) => void
  onOpenDiscussion: (discussionId: string) => void
  foldSignal?: RailFoldSignal | null
}) {
  const [runsExpanded, setRunsExpanded] = useState(activeSectionId === 'recent-runs' || activeRunId !== null)
  const [discussionExpanded, setDiscussionExpanded] = useState(false)
  const discussions = useDiscussions('schedule', task.id).data ?? []
  const rootDiscussion = discussions.find((discussion) => discussion.anchor.locus === undefined) ?? null
  useEffect(() => {
    if (activeSectionId === 'recent-runs' || activeRunId !== null) setRunsExpanded(true)
  }, [activeSectionId, activeRunId])
  useEffect(() => {
    if (!foldSignal) return
    setRunsExpanded(foldSignal.expanded)
    setDiscussionExpanded(foldSignal.expanded)
  }, [foldSignal])
  const sections = visibleCompositeSections(SCHEDULE_SECTIONS, task.own !== false)
  return (
    <div>
      {sections.map((section) => {
        const runs = section.id === 'recent-runs'
        const discussion = section.id === 'discussion'
        const hasResources = runs ? task.runs.length > 0 : discussion ? rootDiscussion !== null : false
        const sectionExpanded = runs ? runsExpanded : discussionExpanded
        return (
          <div key={section.id}>
            <div
              className={`group flex w-full items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 text-[12px] font-medium transition ${SIDEBAR_FOCUS_WITHIN} ${
                activeSectionId === section.id
                  ? SIDEBAR_ACTIVE
                  : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
              }`}
            >
              {hasResources ? (
                <button
                  type="button"
                  onClick={() => runs
                    ? setRunsExpanded((value) => !value)
                    : setDiscussionExpanded((value) => !value)}
                  aria-label={`${sectionExpanded ? 'Collapse' : 'Expand'} ${section.label}`}
                  aria-expanded={sectionExpanded}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition ${SIDEBAR_HOVER} hover:text-ink`}
                >
                  {sectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" aria-hidden />
              )}
              <button
                onClick={() => onOpenSection(section.id)}
                aria-current={activeSectionId === section.id ? 'page' : undefined}
                className="min-w-0 flex-1 truncate text-left"
              >
                {section.label}
              </button>
              {hasResources && (
                <span className="shrink-0 text-[10px] font-normal text-ink-faint">
                  {runs ? task.runs.length : 1}
                </span>
              )}
            </div>
            {runs && runsExpanded && (
              <RailTreeBranch data-routine-section-resources={section.id}>
                {task.runs.map((run) => (
                  <SubNavRow
                    key={run.id}
                    label={run.summary}
                    title={`${run.summary} · ${run.duration}`}
                    active={activeRunId === run.id}
                    onClick={() => onOpenRun(run.id)}
                  />
                ))}
              </RailTreeBranch>
            )}
            {discussion && discussionExpanded && rootDiscussion && (
              <RailTreeBranch data-routine-section-resources={section.id}>
                <SubNavRow
                  label={discussionTitle(rootDiscussion.posts[0]?.body, 60)}
                  title="Routine discussion"
                  active={false}
                  onClick={() => onOpenDiscussion(rootDiscussion.id)}
                />
              </RailTreeBranch>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A leading status dot — filled for the active item, a hollow ring otherwise. */
function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        active ? 'bg-ink-soft' : 'border border-line-strong bg-transparent'
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
  const color = !enabled ? 'bg-line-strong' : lastStatus === 'failed' ? 'bg-danger' : 'bg-ok'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={enabled ? lastStatus : 'paused'} />
}
