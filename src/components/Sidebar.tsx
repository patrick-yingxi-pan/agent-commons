import {
  lazy,
  Suspense,
  useEffect,
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
  ChevronRight,
  Columns2,
  ChevronsUpDown,
  Rows2,
  FolderInput,
  FolderMinus,
  PanelLeftClose,
  PanelsTopLeft,
  PauseCircle,
  Pencil,
  Pin,
  PinOff,
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
import { SECTION_CHILDREN, SECTION_META, SECTION_ORDER, sectionAvailable } from '../lib/sections'
import { SECTION_INSTANCE_KEY } from '../lib/subviews'
import { SECTION_FILTERS } from '../lib/sectionFilter'
import {
  AgentTreeChildren,
  OwnerProfileBranch,
  RailRootScope,
  RailEntryLead,
  RailCollectionTemplate,
  RailTreeBranch,
  SectionInstanceChildren,
  SubNavRow,
  railNodeKey,
  useRailRootAncestorKeys,
} from './SectionTreeChildren'
import { SectionFilterMenu } from './SectionFilterMenu'
import { OWNER_SECTION, type PaneSeed } from '../lib/paneNav'
import {
  SIDEBAR_ACTIVE,
  SIDEBAR_CREATE_BUTTON,
  SIDEBAR_HOVER,
  SIDEBAR_ICON_BUTTON,
  SIDEBAR_TOOLBAR_BUTTON,
  sidebarEntryClass,
} from '../lib/sidebar'
import {
  useMe,
  useDiscussions,
  useNotifications,
  useSchedules,
} from '../api'
import {
  isScheduleMutationHeld,
  toggleScheduleEnabled,
  useScheduleMutationStatus,
} from '../controller/scheduleMutations'
import {
  enqueueScheduleDeletion,
  isScheduleDeletionHeld,
  ROUTINE_DELETE_SCOPE,
  useScheduleDeletionStatus,
} from '../controller/scheduleDeletionMutations'
import { AccountChip } from './AccountChip'
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
import type { CompositeCommandKind } from '../lib/compositeFeatures'
import { RailSplit } from './RailSplit'
import {
  railFoldAffects,
  type RailFoldSignal,
  type RailSplitNode,
  type RailViewRoot,
} from '../lib/railSplit'
import type { RailSelection } from '../controller/useRailSplit'
import {
  collectionProjectionItems,
  partitionedCollectionProjection,
} from '../lib/collectionProjection'
import { collectionEmptyCopy } from '../lib/collectionEmpty'

const RoutineRowMenu = lazy(() =>
  import('./RoutineRowMenu').then((module) => ({ default: module.RoutineRowMenu })),
)

/** Does this section's row expand? Every child kind counts (UI-19) — fixed
 *  surfaces and canonical doors, section-detail rows, or Sessions' canonical
 *  `/s/:id` rows. Module-level so the state initializer can call it before the
 *  component body runs. */
function hasChildren(id: SectionId): boolean {
  return id === 'sessions' || !!SECTION_CHILDREN[id] || !!SECTION_INSTANCE_KEY[id]
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
  paneCloseTarget,
  paneActionTarget,
  railTree,
  focusedRailPane,
  selectedRailEntry,
  onFoldAll,
  onUnfoldAll,
  onFocusRailPane,
  onSelectRailEntry,
  onRailRatio,
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
  onDeleteSession: (id: string, expectedRevision: number) => void
  /** Collapse the rail (its own toggle, top-left). Re-opening is handled by a
   *  floating control in the parent, since this one hides with the rail. */
  onToggleCollapse: () => void
  /** Open the floating search palette (the rail keeps only an icon). */
  onOpenSearch: () => void
  /** Open the notification inbox (D24) — the bell beside the search icon. */
  onOpenNotifications: () => void
  /** Door to a namespace page (FWD-6 — the chip menu's Organizations rows). */
  onOpenOwner?: (name: string) => void
  /** Contextual shared split actions. Main focus may offer both directions;
   *  rail focus offers only Split down after a navigation entry is selected. */
  onSplitRow?: () => void
  onSplitCol?: () => void
  /** Close the focused main pane or a rooted secondary rail view. The rail's
   *  complete resource forest is a permanent recovery anchor. */
  onCloseView?: () => void
  /** Exact pane path captured by this render's Close action. */
  paneCloseTarget?: string
  /** Main-page disclosure acts reported by the focused composite projection. */
  onFoldAll?: () => void
  onUnfoldAll?: () => void
  /** Which focused area currently owns the shared split/close controls. */
  paneActionTarget: 'main' | 'rail'
  /** Vertical-only split tree for independently scrolling rooted projections
   *  of the one honest account-resource tree. */
  railTree: RailSplitNode
  focusedRailPane: string
  selectedRailEntry: RailSelection | null
  onFocusRailPane: (path: string) => void
  onSelectRailEntry: (path: string, root: RailViewRoot) => void
  onRailRatio: (path: string, ratio: number) => void
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
  const activeSectionRef = useRef(activeSection)
  const activeSeedRef = useRef(activeSeed)
  activeSectionRef.current = activeSection
  activeSeedRef.current = activeSeed
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
  const me = useMe().data
  const instanceAdmin = me?.instanceAdmin === true
  const tenantName = me?.tenant.name
  const visibleSections = useMemo(
    () => SECTION_ORDER.filter((id) => sectionAvailable(id, { instanceAdmin })),
    [instanceAdmin],
  )
  // Organize pane follows focus. Main focus uses the page registry; a selected
  // rail entry owns its complete subtree; rail focus with no selected entry
  // means the complete left panel. One command pair, three honest scopes.
  const railFoldRevision = useRef(0)
  const [railFoldSignal, setRailFoldSignal] = useState<(RailFoldSignal & { panePath: string | null }) | null>(null)
  const publishRailFold = (open: boolean, targetKey: string | null, panePath: string | null) => {
    const signal = {
      revision: ++railFoldRevision.current,
      expanded: open,
      targetKey,
      panePath,
    }
    const affectedSections = SECTION_ORDER.filter(
      (id) => hasChildren(id) && railFoldAffects(signal, railNodeKey('section', id)),
    )
    for (const id of affectedSections) setLayout(`treeOpen.${id}`, open)
    if (affectedSections.length > 0) {
      setExpanded((current) => {
        const next = new Set(current)
        for (const id of affectedSections) open ? next.add(id) : next.delete(id)
        return next
      })
    }
    setRailFoldSignal(signal)
  }
  const requestRailFold = (open: boolean) => {
    if (!selectedRailEntry || selectedRailEntry.path !== focusedRailPane) return
    publishRailFold(open, selectedRailEntry.root.key, selectedRailEntry.path)
  }
  const requestRailPanelFold = (open: boolean) => publishRailFold(open, null, null)
  const foldSignalForPane = (path: string): RailFoldSignal | null =>
    railFoldSignal && (railFoldSignal.panePath === null || railFoldSignal.panePath === path)
      ? railFoldSignal
      : null
  const railOwnsOrganize = paneActionTarget === 'rail'
  const railTargetsEntry = railOwnsOrganize && selectedRailEntry?.path === focusedRailPane
  const paneFoldAll = railTargetsEntry
    ? () => requestRailFold(false)
    : railOwnsOrganize
      ? () => requestRailPanelFold(false)
      : onFoldAll
  const paneUnfoldAll = railTargetsEntry
    ? () => requestRailFold(true)
    : railOwnsOrganize
      ? () => requestRailPanelFold(true)
      : onUnfoldAll

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
  useScheduleMutationStatus()
  useScheduleDeletionStatus()
  const routineMutationHeld = (id: string) =>
    isScheduleMutationHeld(id) || isScheduleDeletionHeld(id)
  const deleteRoutine = (task: ScheduledTask) => {
    if (routineMutationHeld(task.id)) return
    void enqueueScheduleDeletion(task.id, task.revision ?? 0).then((outcome) => {
      if (
        outcome === 'applied' &&
        activeSectionRef.current === 'scheduled' &&
        activeSeedRef.current?.scheduleId === task.id
      ) {
        onOpenSection('scheduled')
      }
    })
  }

  const { applyOp, projectIdForSession, scheduleProjectId, allProjects } = useRelations()
  // The same canonical registry + immediate creation acknowledgements that the
  // Projects page renders, joined by ID so a pending refetch cannot hide or
  // duplicate a just-created project in the rail or its action menus.
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
  const { groups } = useMemo(() => {
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
  const { groups: routineGroups } = useMemo(() => {
    return filterRoutines(routines, routineFilter, {
      projectIdOfTask: scheduleProjectId,
      projectName,
    })
  }, [routines, routineFilter, scheduleProjectId, projects])

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
      confirm: `Delete “${session.title}”? This permanently removes the conversation and its saved messages.`,
      onSelect: () => onDeleteSession(session.id, session.metadataRevision ?? 0),
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
      confirm: `Delete “${t.name}”? ${ROUTINE_DELETE_SCOPE}`,
      onSelect: () => deleteRoutine(t),
    },
  ]

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
      <div
        data-rail-toolbar
        className="flex items-center px-2 pt-2.5"
        onPointerDownCapture={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('button, [role="menu"], [role="separator"]')) return
          onFocusRailPane(focusedRailPane)
        }}
      >
        <div data-rail-toolbar-group="global" className="flex items-center gap-0.5">
          <button
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className={SIDEBAR_TOOLBAR_BUTTON}
          >
            <PanelLeftClose size={17} />
          </button>
          <button
            onClick={onOpenSearch}
            title="Search  (⌘K)"
            aria-label="Search"
            className={SIDEBAR_TOOLBAR_BUTTON}
          >
            <Search size={17} />
          </button>
          {/* The bell (D24) — the inbox of public acts on what you watch, own,
              or posted. The badge is live via notification.changed. */}
          <NotificationBell onClick={onOpenNotifications} compact />
        </div>
        {(paneFoldAll || paneUnfoldAll || onSplitRow || onSplitCol || onCloseView) && (
          <div
            data-rail-toolbar-group="view"
            data-pane-action-target={paneActionTarget}
            className="ml-auto flex items-center gap-0.5 border-l border-line pl-1.5"
          >
            <PaneActionButtons
              onFoldAll={paneFoldAll}
              onUnfoldAll={paneUnfoldAll}
              onSplitRow={onSplitRow}
              onSplitCol={onSplitCol}
              onCloseView={onCloseView}
              closeTarget={paneCloseTarget}
              compact
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
            What makes it findable is POSITION (first row, its own <nav>) and a
            familiar plus verb. The glyph and label share the same optical row;
            an ornamental ring once made the icon feel larger and lower than its
            text even though their boxes were mathematically centred. */}
        <button
          onClick={onNewSession}
          data-rail-create
          className={SIDEBAR_CREATE_BUTTON}
        >
          <Plus size={15} strokeWidth={1.75} className="shrink-0 text-ink-soft" aria-hidden />
          <span>New session</span>
        </button>
      </nav>

      {/* One honest account-resource tree, projected into one or more
          independently scrolling rail views. The default root is the complete
          forest; a split can scope a view to any selected canonical subtree. */}
      <nav aria-label="Sections" className="contents">
        <RailSplit
          tree={railTree}
          focusedPane={focusedRailPane}
          onFocusPane={onFocusRailPane}
          onSelectEntry={onSelectRailEntry}
          onRatio={onRailRatio}
          renderPane={(path, content) => (
            <RailRootScope ancestorKeys={content.root?.ancestors ?? []} rootKey={content.root?.key}>
            <div data-rail-forest>
              {visibleSections.map((id) => {
          const { label, Icon, beta } = SECTION_META[id]
          const children = SECTION_CHILDREN[id]
          const instanceKey = SECTION_INSTANCE_KEY[id]
          const sectionNodeKey = railNodeKey('section', id)
          const isExpanded = expanded.has(id) || !!content.root?.ancestors.includes(sectionNodeKey)
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
            <div key={id} data-rail-node-key={sectionNodeKey}>
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
                  {id === 'sessions' ? (
                    <SessionTreeChildren
                      groups={groups}
                      empty={collectionEmptyCopy('sessions', sessions.length)}
                      renderSession={(session) => (
                        <SessionRow
                          key={session.id}
                          nodeKey={railNodeKey('section', 'sessions', 'item', session.id)}
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
                      foldSignal={foldSignalForPane(path)}
                    />
                  ) : id === 'scheduled' ? (
                    <ScheduledTreeChildren
                      groups={routineGroups}
                      empty={collectionEmptyCopy('routines', routines.length)}
                      foldSignal={foldSignalForPane(path)}
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
                          mutationHeld={routineMutationHeld(t.id)}
                          foldSignal={foldSignalForPane(path)}
                        />
                      )}
                    />
                  ) : children ? (
                    children.map((child) => child.kind === 'owner-profile' ? (
                      tenantName && onOpenOwner ? (
                        <OwnerProfileBranch
                          key={child.id}
                          name={tenantName}
                          label={child.label}
                          profileActive={activeSection === id && activeSeed?.ownerName === tenantName}
                          activeSeed={activeSeed}
                          onOpenRoot={() => {
                            onOpenOwner(tenantName)
                            onLeafNavigate?.()
                          }}
                          onOpenDetail={(section, seed) => {
                            onOpenDetail(section, seed)
                            onLeafNavigate?.()
                          }}
                          foldSignal={foldSignalForPane(path)}
                        />
                      ) : null
                    ) : (
                      <SubNavRow
                        key={child.id}
                        nodeKey={railNodeKey('section', id, 'subview', child.id)}
                        label={child.label}
                        kind="view"
                        active={activeSection === id && activeSubview === child.id}
                        onClick={() => onChildClick(id, child.id)}
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
                      foldSignal={foldSignalForPane(path)}
                    />
                  ) : null}
                </RailTreeBranch>
              )}
            </div>
          )
              })}
            </div>
            </RailRootScope>
          )}
        />
      </nav>

      <AccountChip onOpenOwner={onOpenOwner} />
    </aside>
  )
}

// The always-visible account chip lives in ./AccountChip.tsx; menu content loads on demand.
// (multi-account P7 — it grew the sign-in / create-account / workspace flows).

/** One focus-aware organize/split/close cluster for both navigation and
 * content. Its two disclosure commands receive their scope from the shell. */
export function PaneActionButtons({
  onFoldAll,
  onUnfoldAll,
  onSplitRow,
  onSplitCol,
  onCloseView,
  closeTarget,
  compact = false,
}: {
  onFoldAll?: () => void
  onUnfoldAll?: () => void
  onSplitRow?: () => void
  onSplitCol?: () => void
  onCloseView?: () => void
  /** Exact target carried by Close so a stale control cannot hit its successor. */
  closeTarget?: string
  compact?: boolean
}) {
  const organizeItems: RowMenuItem[] = []
  if (onFoldAll) {
    organizeItems.push({
      kind: 'action',
      key: 'fold-all',
      label: 'Fold all',
      icon: <ChevronsUp size={15} />,
      onSelect: onFoldAll,
    })
  }
  if (onUnfoldAll) {
    organizeItems.push({
      kind: 'action',
      key: 'unfold-all',
      label: 'Unfold all',
      icon: <ChevronsDown size={15} />,
      onSelect: onUnfoldAll,
    })
  }
  const organizeControl = organizeItems.length > 0 ? (
    <RowMenu
      ariaLabel="Organize pane"
      triggerIcon={<ChevronsUpDown size={17} />}
      triggerClassName={compact ? SIDEBAR_TOOLBAR_BUTTON : SIDEBAR_ICON_BUTTON}
      items={organizeItems}
    />
  ) : null

  if (compact) {
    const splitItems: RowMenuItem[] = []
    if (onSplitRow) {
      splitItems.push({
        kind: 'action',
        key: 'split-right',
        label: 'Split right',
        icon: <Columns2 size={15} />,
        onSelect: onSplitRow,
      })
    }
    if (onSplitCol) {
      splitItems.push({
        kind: 'action',
        key: 'split-down',
        label: 'Split down',
        icon: <Rows2 size={15} />,
        onSelect: onSplitCol,
      })
    }

    return (
      <>
        {organizeControl}
        {splitItems.length > 0 && (
          <RowMenu
            ariaLabel="Split pane"
            triggerIcon={<PanelsTopLeft size={17} />}
            triggerClassName={SIDEBAR_TOOLBAR_BUTTON}
            items={splitItems}
          />
        )}
        {onCloseView && (
          <button
            onClick={onCloseView}
            title="Close pane"
            aria-label="Close pane"
            data-close-view
            data-close-target={closeTarget}
            className={SIDEBAR_TOOLBAR_BUTTON}
          >
            <X size={17} />
          </button>
        )}
      </>
    )
  }

  return (
    <>
      {organizeControl}
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
          data-close-target={closeTarget}
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
export function NotificationBell({
  onClick,
  compact = false,
}: {
  onClick: () => void
  compact?: boolean
}) {
  const unreadCount = (useNotifications().data ?? []).filter((r) => !r.read).length
  return (
    <button
      onClick={onClick}
      data-testid="notification-bell"
      title="Notifications"
      aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      className={`relative ${compact ? SIDEBAR_TOOLBAR_BUTTON : SIDEBAR_ICON_BUTTON}`}
    >
      <Bell size={compact ? 17 : 18} />
      {unreadCount > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 text-[10px] font-semibold leading-none text-on-solid">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
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
      data-rail-node-row
      data-section-root={sectionId}
      data-rail-entry-kind="root"
      className={sidebarEntryClass('root', active)}
    >
      {hasChildren ? (
        <button
          onClick={onToggle}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          className="flex h-8 w-6 shrink-0 items-center justify-center text-ink-faint transition hover:text-ink"
        >
          <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}
      <button
        data-rail-entry
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

/** One Sessions row — the title, meaningful pin state, and a hover "⋮" menu.
 *  "Rename" flips the title into an inline editor; the rest go through the menu's
 *  own handlers. The main region selects the session; the menu sits outside that
 *  button so its clicks don't also open the thread. */
function SessionRow({
  nodeKey,
  session,
  active,
  onSelect,
  onRename,
  menuItems,
}: {
  nodeKey: string
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
      data-rail-node-key={nodeKey}
      data-rail-node-row
      data-rail-entry-kind="item"
      className={sidebarEntryClass('item', active)}
    >
      <RailEntryLead />
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
          data-rail-entry
          onClick={onSelect}
          title={session.preview}
          aria-current={active ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {session.title}
        </button>
      )}
      {!editing && session.pinned && (
        <Pin size={12} className="shrink-0 text-ink-faint" aria-label="Pinned" />
      )}
      {!editing && <RowMenu ariaLabel={`Actions for ${session.title}`} items={items} />}
    </div>
  )
}

/** The Sessions section's live instance children. Group labels are view
 * partitions selected by its filter, not structural navigation nodes. */
function SessionTreeChildren({
  groups,
  empty,
  renderSession,
}: {
  groups: SessionGroup[]
  empty: string
  renderSession: (session: Session) => ReactNode
}) {
  const projection = partitionedCollectionProjection({
    section: 'sessions',
    fallbackLabel: 'Sessions',
    empty,
    itemNoun: 'session',
    presentation: 'static',
    groups: groups.map((group) => ({
      key: group.key,
      label: group.label,
      items: collectionProjectionItems(
        group.sessions,
        (session) => session.id,
        (session) => session.title,
      ),
    })),
  })
  return (
    <RailCollectionTemplate
      projection={projection}
      renderItem={(item) => renderSession(item.value)}
    />
  )
}

/** The Scheduled section's instance head. It keeps the shared eight-row cap
 * even when the chosen grouping divides the list into several visual bands. */
function ScheduledTreeChildren({
  groups,
  empty,
  renderRoutine,
  foldSignal,
}: {
  groups: RoutineGroup[]
  empty: string
  renderRoutine: (task: ScheduledTask) => ReactNode
  foldSignal?: RailFoldSignal | null
}) {
  const projection = partitionedCollectionProjection({
    section: 'scheduled',
    fallbackLabel: 'Routines',
    empty,
    itemNoun: 'routine',
    presentation: 'foldable',
    groups: groups.map((group) => ({
      key: group.key,
      label: group.label || 'Routines',
      tone: group.key === 'paused' ? 'muted' : undefined,
      items: collectionProjectionItems(
        group.tasks,
        (task) => task.id,
        (task) => task.name,
      ),
    })),
  })
  return (
    <RailCollectionTemplate
      projection={projection}
      foldSignal={foldSignal}
      renderItem={(item) => renderRoutine(item.value)}
    />
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
  mutationHeld,
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
  mutationHeld: boolean
  foldSignal?: RailFoldSignal | null
}) {
  // A routine is the composite; a run is one of its children. The old row
  // skipped the parent whenever a run existed and opened the latest child,
  // making the routine page unreachable from the very tree that listed it.
  // Expansion is local disclosure state; an active parent or run opens its
  // branch so the current place is always visible.
  const [expanded, setExpanded] = useState(pageActive || activeSectionId !== null || activeRunId !== null)
  const nodeKey = railNodeKey('section', 'scheduled', 'item', task.id)
  const rootAncestorKeys = useRailRootAncestorKeys()
  const disclosed = expanded || rootAncestorKeys.has(nodeKey)
  useEffect(() => {
    if (pageActive || activeSectionId !== null || activeRunId !== null) setExpanded(true)
  }, [pageActive, activeSectionId, activeRunId])
  useEffect(() => {
    if (foldSignal && railFoldAffects(foldSignal, nodeKey)) setExpanded(foldSignal.expanded)
  }, [foldSignal])
  return (
    <div data-rail-node-key={nodeKey}>
      <div
        data-rail-node-row
        data-routine-row
        data-rail-entry-kind="item"
        className={sidebarEntryClass('item', pageActive)}
      >
        <RailEntryLead
          label={task.name}
          expanded={disclosed}
          onToggle={() => setExpanded((value) => !value)}
        />
        <button
          data-rail-entry
          onClick={onOpenPage}
          title={`${task.cadence} · ${task.subtitle}`}
          aria-current={pageActive ? 'page' : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {task.name}
        </button>
        <Suspense fallback={<span className="h-6 w-6 shrink-0" aria-hidden="true" />}>
          <RoutineRowMenu task={task} items={menuItems} mutationHeld={mutationHeld} />
        </Suspense>
      </div>
      {disclosed && (
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
    </div>
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
  const forcedAncestors = useRailRootAncestorKeys()
  const rootDiscussion = discussions.find((discussion) => discussion.anchor.locus === undefined) ?? null
  useEffect(() => {
    if (activeSectionId === 'recent-runs' || activeRunId !== null) setRunsExpanded(true)
  }, [activeSectionId, activeRunId])
  useEffect(() => {
    if (!foldSignal) return
    const runsKey = railNodeKey('section', 'scheduled', 'item', task.id, 'section', 'recent-runs')
    const discussionKey = railNodeKey('section', 'scheduled', 'item', task.id, 'section', 'discussion')
    if (railFoldAffects(foldSignal, runsKey)) setRunsExpanded(foldSignal.expanded)
    if (railFoldAffects(foldSignal, discussionKey)) setDiscussionExpanded(foldSignal.expanded)
  }, [foldSignal])
  const sections = visibleCompositeSections(SCHEDULE_SECTIONS, task.own !== false)
  return (
    <>
      {sections.map((section) => {
        const runs = section.id === 'recent-runs'
        const discussion = section.id === 'discussion'
        const hasResources = runs ? task.runs.length > 0 : discussion ? rootDiscussion !== null : false
        const sectionExpanded = runs ? runsExpanded : discussionExpanded
        const nodeKey = railNodeKey('section', 'scheduled', 'item', task.id, 'section', section.id)
        const disclosed = sectionExpanded || forcedAncestors.has(nodeKey)
        return (
          <div
            key={section.id}
            data-rail-node-key={nodeKey}
          >
            <div
              data-rail-node-row
              data-rail-entry-kind="group"
              className={sidebarEntryClass('group', activeSectionId === section.id)}
            >
              {hasResources
                ? <RailEntryLead
                    label={section.label}
                    expanded={disclosed}
                    onToggle={() => runs
                      ? setRunsExpanded((value) => !value)
                      : setDiscussionExpanded((value) => !value)}
                  />
                : <RailEntryLead />}
              <button
                data-rail-entry
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
            {runs && disclosed && (
              <RailTreeBranch data-routine-section-resources={section.id}>
                {task.runs.map((run) => (
                  <SubNavRow
                    key={run.id}
                    nodeKey={railNodeKey('section', 'scheduled', 'item', task.id, 'section', section.id, 'run', run.id)}
                    label={run.summary}
                    title={`${run.summary} · ${run.duration}`}
                    active={activeRunId === run.id}
                    onClick={() => onOpenRun(run.id)}
                  />
                ))}
              </RailTreeBranch>
            )}
            {discussion && disclosed && rootDiscussion && (
              <RailTreeBranch data-routine-section-resources={section.id}>
                <SubNavRow
                  nodeKey={railNodeKey('section', 'scheduled', 'item', task.id, 'section', section.id, 'discussion', rootDiscussion.id)}
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
    </>
  )
}
