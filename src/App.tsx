import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { PanelLeft } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { AuthScreen } from './components/auth/AuthScreen'
import { useAuthScreen } from './controller/useAuthScreen'
import { setUiPrefScope } from './lib/uiPrefs'
import type { Capabilities, Identity } from '../contract/index.ts'
import { WorkspacePanel } from './components/WorkspacePanel'
import { RunsPanel } from './components/RunsPanel'
import type { PaneContent } from './lib/splitFrame'
import { MainSplitGate, type MainPaneNav } from './components/MainSplit'
import { SessionTitleBar } from './components/SessionTitleBar'
import { ConversationView } from './components/ConversationView'
import { useMainSplit } from './controller/useMainSplit'
import { setMainSplitScope } from './lib/mainSplit'
import { SectionView } from './components/SectionView'
import { AttachmentPanel } from './components/AttachmentPanel'
import { ConnectorPanel } from './components/ConnectorPanel'
import { SearchPanel } from './components/SearchPanel'
import { NotificationsPanel } from './components/NotificationsPanel'
import { AddContextButton } from './components/AddContextButton'
import { useCapabilities, useMe, useProviders, useSessions, useServerEvents } from './api'
import { useSessionWorkspace } from './controller/useSessionWorkspace'
import { useLayout } from './controller/useLayout'
import { RelationsProvider } from './controller/useRelations'
import { railWidthCss, useViewport } from './lib/viewport'
import { pickedModel, pickedProvider, type ModelPick } from './lib/models'
import { FocusContext } from './lib/focusContext'
import { SCRIM_CLASS } from './lib/scrim'
import { SECTION_META } from './lib/sections'
import { DRAFT_ID, type Live } from './data/liveSession'
import { draft } from './controller/draftController'
import type { AddedContext, Connector, SectionId, Session } from './types'

/** The shell: decides WHICH top-level surface renders — the full-screen auth
 *  flow (multi-account §12) or the workspace. The auth screen shows when the
 *  backend's AUTH GATE applies (`features.authGate` + an identity that isn't a
 *  verified session) or when the user opened it (sign in / create account /
 *  add account / after sign-out — useAuthScreen). It REPLACES the workspace
 *  frame — a dedicated onboarding surface, not a dialog over the product. */
export default function App() {
  const caps = useCapabilities().data
  const me = useMe().data
  const authView = useAuthScreen()
  // An account switch resets the whole cache (useMe momentarily undefined) —
  // hold the last known answers so the workspace doesn't unmount mid-switch.
  const lastCaps = useRef<Capabilities | undefined>(undefined)
  const lastMe = useRef<Identity | undefined>(undefined)
  if (caps) lastCaps.current = caps
  if (me) lastMe.current = me
  const cap = caps ?? lastCaps.current
  const ident = me ?? lastMe.current

  // Boot: until the backend says who we are and whether the gate applies,
  // render nothing rather than flash the wrong surface (one local round-trip).
  if (!cap || !ident) return null

  const gated = cap.features.authGate && ident.via !== 'session'
  if (gated || authView) {
    // Gated with no explicit view: land on the picker — it falls through to
    // the sign-in form when no account is remembered on this browser.
    setUiPrefScope(null)
    return <AuthScreen view={authView ?? { kind: 'picker' }} gated={gated} />
  }
  // Per-account chrome + view memory (multi-account): the layout store reads as
  // THIS account (a plain module set — idempotent per render — done before the
  // children whose useState initializers read it can mount), and the Workspace
  // is KEYED by the account, so a switch remounts it: every mount-time read
  // (rail width, pane folds/heights, panel width, the saved view location in
  // useSessionWorkspace) re-runs against the account's own blobs. `ident` holds
  // the last-known identity mid-switch, so the remount fires exactly when the
  // NEW /me resolves — the old account's instance never renders as the new one.
  setUiPrefScope(ident.user.id)
  setMainSplitScope(ident.user.id) // the main split tree is per account, like the layout blob
  return <Workspace key={ident.user.id} />
}

/** The View: composes the product chrome from two controllers — the session +
 *  its live workspace, and the rail layout — holding only local view chrome
 *  (the search palette toggle). All business logic lives in the controllers
 *  (controller/) and the model (data/). */
function Workspace() {
  const [searchOpen, setSearchOpen] = useState(false)
  // The notification inbox overlay (D24) — the rail bell's panel.
  const [notifOpen, setNotifOpen] = useState(false)
  // A scheduled-run session's right panel (the run switcher) is open by default;
  // closing it is per-session, so switching threads re-opens it.
  const [runsPanelOpen, setRunsPanelOpen] = useState(true)

  // Subscribe to the backend's ambient event stream (scheduled runs, standing
  // approvals, connector status). The session list now comes from the server —
  // the sidebar and search read the same rows the API serves, not a local const.
  useServerEvents()
  const sessions = useSessions().data ?? []

  const {
    activeId,
    activeSection,
    activeSubview,
    focusProjectId,
    focusScheduleId,
    focusOwnerName,
    focusWorkItemId,
    focusAgentId,
    focusContextId,
    pendingFocus,
    live,
    typing,
    focus,
    activeSession,
    isDraft,
    busy,
    liveTurn,
    sendFailure,
    pendingApproval,
    focusedWorkspace,
    focusedRepo,
    focusedConnector,
    selectSession,
    newSession,
    newSessionWith,
    openSection,
    openSubview,
    openProject,
    openSchedule,
    openOwner,
    openAgentPage,
    openContextPage,
    openWorkItemPage,
    openWorkItem,
    openProposal,
    openAgent,
    consumeFocus,
    goBack,
    backTo,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
    selectModel,
    draftPick,
    handleSend,
    stopTurn,
    retryInterrupted,
    compact,
    handleAddContext,
    focusContext,
    removeContexts,
    removeAttachment,
    removeFolder,
    closePanel,
    approveEscalation,
  } = useSessionWorkspace()

  // (The relay wait state — "Waiting on your session…" — is derived inside
  // ConversationView now, once for every host.)
  const providers = useProviders().data ?? []
  // Resolve the active session's driver + model pick from the SERVER row when one
  // exists (the useSessions cache refreshes on session.updated — a hand-off or model
  // switch lands there). A run session isn't in that list (it surfaces through the
  // Scheduled rail), but the controller's activeSession IS its reconciled server
  // row, so the same fields resolve; a draft falls back to the local shell and the
  // not-yet-persisted pick held by the controller.
  const activeRow = sessions.find((s) => s.id === activeId) ?? activeSession
  // The active two-level model pick (provider + catalog model) — the draft's local
  // hold, or the server row's persisted fields.
  const activePick: ModelPick = useMemo(
    () => (isDraft ? draftPick : { providerId: activeRow.providerId, modelId: activeRow.modelId }),
    [isDraft, draftPick, activeRow.providerId, activeRow.modelId],
  )
  // A model pick needs somewhere to live: a draft (held locally) or a real server
  // row (PATCHed). Every non-draft session is a server row through the one mint
  // funnel — run sessions included — so the pick is writable everywhere; only an
  // id whose reconcile read hasn't resolved yet (no row to PATCH) omits the
  // registered-models section instead of silently no-oping.
  const modelPickWritable =
    isDraft || sessions.some((s) => s.id === activeId) || !!activeSession.scheduledRunOf

  // The DRAFT's usage overlay: no server row exists to resolve its pick, so the
  // strip resolves the picked provider+model against the live registry here —
  // identity for the popover's model line, window for the context gauge (absent =
  // unknown-capacity, e.g. a Session provider). A real session reads the server
  // snapshot instead (same resolution, done authoritatively server-side).
  const draftModelRef = useMemo(() => {
    if (!isDraft) return undefined
    const provider = pickedProvider(providers, draftPick)
    if (!provider) return undefined
    const model = pickedModel(provider, draftPick)
    return {
      providerId: provider.id,
      providerLabel: provider.label,
      ...(model ? { modelId: model.id, modelLabel: model.label, windowTokens: model.contextWindow } : {}),
    }
  }, [isDraft, providers, draftPick])

  // Responsive layout ladder (FWD-3 / PD35): below a wide window the right panel
  // would crush the conversation column, so it overlays as a drawer (with a scrim)
  // instead of sitting side-by-side; on narrow (a phone) the left rail becomes an
  // off-canvas drawer too and the right panel takes over the whole viewport.
  const { tier } = useViewport()
  const panelOverlay = tier !== 'wide'
  const railOverlay = tier === 'narrow'

  const { leftOpen, leftW, leftDragging, toggleLeft, openLeft, closeLeft, startResize, resize, endResize } =
    useLayout(tier)

  // On narrow, picking anything from the rail drawer also dismisses it — the
  // drawer covers the surface the pick navigates to.
  const withRailClose = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        fn(...args)
        if (railOverlay) closeLeft()
      },
    [railOverlay, closeLeft],
  )

  // ⌘K / Ctrl+K opens the search palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Re-open the run switcher whenever the open session changes.
  useEffect(() => {
    setRunsPanelOpen(true)
  }, [activeId])

  // A scheduled routine's run *is* a session — the backend tags it with the
  // routine it belongs to, which is what the run-switcher panel keys off.
  const isRunSession = !!activeSession.scheduledRunOf
  // Whether a right panel is currently showing (a focused context, or the run switcher)
  // — drives the overlay scrim on small viewports (FWD-3).
  const panelOpen = !!focus || (isRunSession && runsPanelOpen && !!activeSession.scheduledRunOf)

  // ── The active session's context panel as a tree pane (universal split P4) ──
  // Its open `focus` (or the run switcher for a run session — the default panel)
  // becomes a real context PANE beside the primary on the wide tier, closed and
  // split by the rail cluster like every pane. The overlay tiers dock it instead.
  const activePanel = useMemo<PaneContent | null>(
    () =>
      focus
        ? { kind: focus.kind, id: focus.id }
        : isRunSession && runsPanelOpen && activeSession.scheduledRunOf
          ? { kind: 'runs', id: activeSession.scheduledRunOf.taskId }
          : null,
    [focus, isRunSession, runsPanelOpen, activeSession.scheduledRunOf],
  )

  // ── The MAIN workspace split (universal split, focused-pane model) ──────────
  // The primary pane is the surface below (thread or section — the singleton
  // controller's); independent panes tile beside it on the wide tier. The rail's
  // two split buttons act on the FOCUSED pane, duplicating its content; rail
  // navigation retargets the focused pane when it isn't the primary.
  const {
    mainTree,
    focusedPane,
    focusedClosable,
    focusMainPane,
    focusPrimary,
    splitFocused,
    routeToFocused,
    setFocusDrivenContext,
    adoptDraftPanes,
    fillMainPane,
    closeFocused,
    setMainRatio,
  } = useMainSplit()

  // Project the active session's panel into the universal tree on the WIDE tier
  // (a real context pane beside the primary); the overlay tiers dock it, so the
  // tree carries no focus-driven context pane there. One source of truth (`focus`).
  //
  // LATCHED while the active row resolves: a session door can land before its
  // server row loads (a run opened from the runs panel, a recents row for an
  // unlisted session) — `activeSession` falls back to the draft shell for a
  // frame, which read as "no panel" and DISSOLVED the tree, remounting the
  // whole main area (thread scroll, the runs list, every pane) before the
  // resolved row re-formed it. A not-yet-resolved row is "unknown", not
  // "closed": hold the previous projection; resolution re-projects IN PLACE
  // (replacePane — same position, no remount).
  const activeResolving = !isDraft && activeSession.id !== activeId
  useEffect(() => {
    if (activeResolving) return
    setFocusDrivenContext(activeId, tier === 'wide' ? activePanel : null)
  }, [setFocusDrivenContext, activeId, tier, activePanel, activeResolving])
  // What "duplicate the primary" means right now: the active section page, or
  // the active conversation. A fresh draft has no duplicable identity yet — the
  // split is a no-op until the thread materializes (or a section opens).
  const splitView = useCallback(
    (dir: 'row' | 'col') =>
      splitFocused(
        dir,
        activeSection
          ? { kind: 'msection', id: activeSection, sub: activeSubview }
          : !isDraft
            ? { kind: 'msession', id: activeId }
            : null,
      ),
    [splitFocused, activeSection, activeSubview, isDraft, activeId],
  )
  const mainPaneNav = useMemo<MainPaneNav>(
    () => ({
      onOpenSession: selectSession,
      onNewSession: () => newSession(),
      onOpenProposal: openProposal,
      onOpenProject: openProject,
      onOpenSchedule: openSchedule,
      // A pane composer's chip click: the active session's context panel is the
      // one tied to `focus` (the tree's focus-driven context pane) — same session
      // toggles it there; a different one comes to the primary first (its
      // remembered panel restores with it, then tiles).
      onOpenSessionContext: (sessionId, f) => {
        if (sessionId === activeId) focusContext(f)
        else selectSession(sessionId)
      },
      sessionLabel: (id) => sessions.find((s) => s.id === id)?.title ?? 'Conversation',
      // A pane-hosted draft materialized: every draft pane follows the entry
      // to the real id (content match — a duplicated draft pane follows too).
      onDraftAdopted: (realId) => adoptDraftPanes(DRAFT_ID, realId),
    }),
    [selectSession, newSession, openProposal, openProject, openSchedule, sessions, activeId, focusContext, adoptDraftPanes],
  )


  // A notification door's transient focus target, handed to the SectionView subtree
  // by context (docs/notification-routing.md). Memoized so the value identity only
  // changes when the target actually changes — not every App render.
  const focusCtx = useMemo(() => ({ pending: pendingFocus, consume: consumeFocus }), [pendingFocus, consumeFocus])

  // Bridges the relations store needs: attaching a context to the live session
  // (for the AI's `attach-context` op) and the "View in …" deep-link nav.
  // Memoized so the RelationsProvider value (which deps on these) doesn't rebuild
  // every render — otherwise every useRelations consumer re-renders on each App
  // render. handleAddContext / openProject / openSection are stable callbacks.
  const attachConnector = useCallback(
    (c: Connector) => handleAddContext({ kind: c.kind === 'mcp' ? 'mcp' : 'connector', connector: c }),
    [handleAddContext],
  )
  // The relations "View in …" deep-link. The second arg is an entity id whose
  // meaning depends on the section: a project to expand, a schedule to open, a
  // saved context's detail, or — under agents — a workspace display name whose
  // public profile to show (D21).
  const navigateToSection = useCallback(
    (section: SectionId, id?: string, subId?: string) =>
      section === 'projects' && id && subId
        ? openWorkItemPage(id, subId) // a work item's page under its project (D19/D23)
        : section === 'projects' && id
          ? openProject(id)
          : section === 'scheduled' && id
            ? openSchedule(id)
            : section === 'contexts' && id
              ? openContextPage(id)
              : section === 'agents' && id
                ? openOwner(id)
                : openSection(section),
    [openProject, openWorkItemPage, openSchedule, openContextPage, openOwner, openSection],
  )

  return (
    <RelationsProvider attachConnector={attachConnector} navigate={navigateToSection}>
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      {/* ===== The product — no top bar; the rail owns its toggle ===== */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* When the rail is collapsed its own toggle hides with it, so a floating
            control re-opens it — in the same top-left spot the rail's toggle sits.
            Wide/medium only: those layouts reserve its spot (the pl-14 title
            indents). On narrow the toggle lives IN the layout instead — inline in
            the session title bar or the NarrowBar — so scrolling content can
            never slide underneath it. */}
        {!leftOpen && !railOverlay && (
          <button
            onClick={openLeft}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="absolute left-2.5 top-2.5 z-30 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft shadow-sm transition hover:bg-panel-2 hover:text-ink"
          >
            <PanelLeft size={18} />
          </button>
        )}

        {/* Narrow tier: the rail is an off-canvas drawer over the app — a scrim
            behind it dims and dismisses (FWD-3). */}
        {railOverlay && leftOpen && (
          <div className={`${SCRIM_CLASS} z-30`} aria-hidden onClick={closeLeft} />
        )}

        <div className="flex min-h-0 flex-1">
          {/* Left rail: collapsible (width → 0) and drag-resizable. The inner div
              holds a fixed width so the content doesn't reflow while collapsing.
              On narrow it leaves the flex flow and floats over the app; its width
              clamp (railWidthCss) keeps a sliver of scrim tappable. */}
          <div
            // Collapsed, the rail is clipped to width 0 but its content would
            // otherwise stay in the tab order / accessibility tree (UI-8,
            // docs/ui-invariants.md) — `inert` removes the buried controls.
            inert={!leftOpen}
            className={`${
              railOverlay ? 'absolute inset-y-0 left-0 z-40' : 'relative shrink-0'
            } h-full overflow-hidden ${
              leftDragging ? '' : 'transition-[width] duration-200 ease-out'
            } ${leftOpen ? '' : 'pointer-events-none'}`}
            style={{ width: leftOpen ? railWidthCss(tier, leftW) : 0 }}
          >
            <div style={{ width: railWidthCss(tier, leftW) }} className="h-full">
              <Sidebar
                sessions={sessions}
                activeId={activeId}
                activeSection={activeSection}
                activeSubview={activeSubview}
                onSelect={withRailClose((id: string) => {
                  if (!routeToFocused({ kind: 'msession', id })) selectSession(id)
                })}
                onNewSession={withRailClose(() => {
                  // New session lands in the FOCUSED pane (the focused-pane
                  // routing every rail door follows): a focused SECONDARY pane
                  // hosts the fresh draft itself — reset the shared draft
                  // entry, retarget the pane; the primary keeps its content.
                  // With the primary focused (or no tree), the singleton path
                  // runs as always.
                  draft.reset()
                  if (!routeToFocused({ kind: 'msession', id: DRAFT_ID })) {
                    focusPrimary() // a fresh draft lives on the singleton surface
                    newSession()
                  }
                })}
                // Section / sub-view handlers stay UNwrapped by withRailClose: the rail
                // decides when to close the narrow drawer (a leaf navigates → close;
                // drilling into a section's sub-menu keeps it open), via onLeafNavigate
                // below. With a SECONDARY pane focused, both retarget that pane instead
                // (the focused-pane routing); the primary navigates as always.
                onOpenSection={(id) => {
                  if (!routeToFocused({ kind: 'msection', id })) openSection(id)
                }}
                onOpenSubview={(section, sub) => {
                  if (!routeToFocused({ kind: 'msection', id: section, sub })) openSubview(sub)
                }}
                onLeafNavigate={railOverlay ? closeLeft : undefined}
                onOpenSchedule={withRailClose(openSchedule)}
                onPinSession={pinSession}
                onRenameSession={renameSession}
                onArchiveSession={archiveSession}
                onDeleteSession={deleteSession}
                onToggleCollapse={toggleLeft}
                onOpenSearch={withRailClose(() => setSearchOpen(true))}
                onOpenNotifications={withRailClose(() => setNotifOpen(true))}
                onOpenOwner={withRailClose(openOwner)}
                onSplitView={tier === 'wide' ? splitView : undefined}
                onCloseView={
                  tier === 'wide' && focusedClosable
                    ? () =>
                        closeFocused(
                          (promoted) => {
                            // Closing the PRIMARY tile: the singleton controller
                            // navigates onto the surviving pane's content, so the
                            // address bar honestly names what remains on screen.
                            if (promoted.kind === 'msession') selectSession(promoted.id)
                            else if (promoted.kind === 'msection') {
                              openSection(promoted.id)
                              openSubview(promoted.sub ?? null)
                            }
                            // an mpicker / pinned context pane promotes silently
                          },
                          (panel) => {
                            // The active session's context panel: clear its driver so
                            // the setFocusDrivenContext effect removes its pane (panelPref
                            // remembers it closed, FWD-2). Closing the RUN SWITCHER
                            // hides it; closing an attached-context panel on a run
                            // session clears `focus` but LEAVES runsPanelOpen, so the
                            // run switcher falls back in (matching the overlay tiers).
                            if (panel.kind === 'runs') setRunsPanelOpen(false)
                            else closePanel()
                          },
                        )
                    : undefined
                }
                resizable={!railOverlay}
                railW={leftW}
                onResizeStart={startResize}
                onResize={resize}
                onResizeEnd={endResize}
              />
            </div>
          </div>

          <main
            // While the narrow drawer floats over the app, everything it covers
            // leaves the tab order / accessibility tree (UI-8) — the drawer and
            // its scrim are siblings, so one attribute covers thread + panel.
            inert={railOverlay && leftOpen}
            className="flex min-w-0 flex-1 flex-col"
          >
            {/* Narrow tier: surfaces without their own title bar (sections, a
                draft) get a slim header row that HOUSES the rail toggle —
                in-flow, so content scrolls under nothing. Regular sessions embed
                the same toggle in their existing title bar instead. */}
            {railOverlay && (activeSection || isDraft) && (
              <NarrowBar
                title={
                  activeSection
                    ? SECTION_META[activeSection].label
                    : isDraft
                      ? 'New session'
                      : activeSession.title
                }
                onOpenRail={openLeft}
              />
            )}
            {/* The universal main split (Phase 2): a tree tiles the surface
                below as the PRIMARY pane beside independent section panes;
                no tree (or an overlay tier — no room, ADAPT-11) passes it
                through untouched. */}
            <MainSplitGate
              tree={tier === 'wide' ? mainTree : null}
              focusedPane={focusedPane}
              nav={mainPaneNav}
              onFocusPane={focusMainPane}
              onFillPane={fillMainPane}
              onRatio={setMainRatio}
            >
            {activeSection ? (
              <FocusContext.Provider value={focusCtx}>
                <SectionView
                  section={activeSection}
                  subview={activeSubview}
                  onOpenSubview={openSubview}
                  onOpenSession={selectSession}
                  onNewSession={() => newSession()}
                  onOpenProject={openProject}
                  onOpenSchedule={openSchedule}
                  onOpenProposal={openProposal}
                  onBack={goBack}
                  backTo={backTo}
                  railCollapsed={!leftOpen && !railOverlay}
                  focusProjectId={focusProjectId}
                  focusScheduleId={focusScheduleId}
                  focusOwnerName={focusOwnerName}
                  focusWorkItemId={focusWorkItemId}
                  focusAgentId={focusAgentId}
                  focusContextId={focusContextId}
                  onOpenAgentPage={openAgentPage}
                />
              </FocusContext.Provider>
            ) : (
              <>
                {!isDraft && (
                  <SessionTitleBar
                    // The LIVE row (the useSessions cache, refreshed on session.updated),
                    // not the controller's creation-time snapshot — a rename must appear
                    // here the moment it appears on the sidebar row.
                    session={activeRow}
                    leftOpen={leftOpen}
                    leading={railOverlay ? <RailOpenButton onClick={openLeft} /> : undefined}
                    onOpenProject={openProject}
                    onOpenSchedule={openSchedule}
                  />
                )}

                <div className="relative flex min-h-0 flex-1">
                  <section
                    // While the panel overlays the thread (medium drawer or
                    // narrow takeover), the covered thread is inert (UI-8).
                    inert={panelOverlay && panelOpen}
                    className="flex min-w-0 flex-1 flex-col"
                  >
                    {/* The ONE conversation surface — the same fully-fledged
                        view every split pane mounts; only the command wiring
                        is the primary's (draft-materializing send, the right
                        panel's chip focus). */}
                    <ConversationView
                      sessionId={activeId}
                      draft={isDraft}
                      live={live}
                      typing={typing}
                      busy={busy}
                      streaming={!!(busy && liveTurn && liveTurn.sessionId === activeId)}
                      sendFailure={sendFailure}
                      pendingApproval={pendingApproval}
                      onApprove={approveEscalation}
                      onSend={handleSend}
                      onStop={stopTurn}
                      onRetry={retryInterrupted}
                      onCompact={compact}
                      modelPick={activePick}
                      onSelectModel={modelPickWritable ? selectModel : undefined}
                      usageModel={draftModelRef}
                      focus={focus}
                      onAddContext={handleAddContext}
                      onOpenContext={focusContext}
                      onRemoveContexts={removeContexts}
                      onRemoveFolder={removeFolder}
                      empty={
                        <EmptyState
                          mode={isDraft ? 'draft' : 'empty'}
                          live={live}
                          onNewSessionWith={newSessionWith}
                        />
                      }
                      threadPadClass={!leftOpen && !railOverlay && isDraft ? 'pb-4 pt-14' : 'py-4'}
                    />
                  </section>

                  {/* The active session's context panel. On the WIDE tier it is a
                      context PANE in the universal tree (setFocusDrivenContext) — nothing
                      renders here. On the overlay tiers (medium drawer / narrow
                      takeover) it docks over the thread as before (ADAPT-11): a medium
                      scrim dims + dismisses; narrow takes over the whole thread area
                      (its own close button dismisses). The wrapper stays mounted while
                      the tier holds so AnimatePresence exit animations run. */}
                  {panelOverlay && (
                    <>
                      {tier === 'medium' && panelOpen && (
                        <div
                          className={`${SCRIM_CLASS} z-20`}
                          aria-hidden
                          onClick={() => {
                            closePanel()
                            setRunsPanelOpen(false)
                          }}
                        />
                      )}
                      <div
                        className={
                          railOverlay
                            ? // Spans the whole thread even when no panel is open (kept
                              // mounted for exit animations) — must not eat taps while empty.
                              `absolute inset-0 z-30 flex ${panelOpen ? '' : 'pointer-events-none'}`
                            : 'absolute inset-y-0 right-0 z-30 flex'
                        }
                      >
                        {/* One focused-context sidebar at a time, chosen by the active
                            chip. One keyed WorkspacePanel serves both workspace and repo
                            so the body morphs when you switch between the two. */}
                        <AnimatePresence>
                          {(focusedWorkspace || focusedRepo) && (
                            <WorkspacePanel
                              key="ws"
                              mode={focusedRepo ? 'repo' : 'workspace'}
                              workspace={focusedWorkspace}
                              repo={focusedRepo}
                              onClose={closePanel}
                              onRemoveFolder={removeFolder}
                            />
                          )}
                        </AnimatePresence>

                        {/* A scheduled-run session's run switcher — its default panel.
                            Yields to a focused-context panel (a chip click still works). */}
                        <AnimatePresence>
                          {isRunSession && !focus && runsPanelOpen && activeSession.scheduledRunOf && (
                            <RunsPanel
                              key="runs"
                              taskId={activeSession.scheduledRunOf.taskId}
                              activeRunSessionId={activeId}
                              onSelectRun={selectSession}
                              onOpenRoutine={openSchedule}
                              onClose={() => setRunsPanelOpen(false)}
                            />
                          )}
                        </AnimatePresence>

                        <AnimatePresence>
                          {focusedConnector && (
                            <ConnectorPanel
                              key="conn"
                              connector={focusedConnector}
                              onClose={closePanel}
                              onDisconnect={() =>
                                removeContexts([{ kind: 'connector', id: focusedConnector.id }])
                              }
                            />
                          )}
                        </AnimatePresence>

                        <AnimatePresence>
                          {(focus?.kind === 'file' || focus?.kind === 'photo') && (
                            <AttachmentPanel
                              key="att"
                              kind={focus.kind}
                              items={live.attachments.filter((a) => a.kind === focus.kind)}
                              initialId={focus.id}
                              onClose={closePanel}
                              onRemove={removeAttachment}
                            />
                          )}
                        </AnimatePresence>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            </MainSplitGate>
          </main>
        </div>
      </div>

      {notifOpen && (
        <NotificationsPanel
          onOpenProject={openProject}
          onOpenSection={openSection}
          onOpenWorkItem={openWorkItem}
          onOpenProposal={openProposal}
          onOpenAgent={openAgent}
          onOpenOwner={openOwner}
          onClose={() => setNotifOpen(false)}
        />
      )}

      {searchOpen && (
        <SearchPanel
          sessions={sessions}
          onSelectSession={selectSession}
          onOpenSection={openSection}
          onOpenProject={openProject}
          onOpenSchedule={openSchedule}
          onOpenOwner={openOwner}
          onOpenAgentPage={openAgentPage}
          onClose={() => setSearchOpen(false)}
        />
      )}

    </div>
    </RelationsProvider>
  )
}

/** The narrow tier's in-flow rail toggle (ADAPT-11): the same affordance as the
 *  floating reopen control, but it OCCUPIES layout — inline in a title bar or the
 *  NarrowBar — so scrolling content can never slide underneath it. */
function RailOpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Expand sidebar"
      aria-label="Expand sidebar"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-panel-2 hover:text-ink"
    >
      <PanelLeft size={18} />
    </button>
  )
}

/** The slim header row narrow surfaces WITHOUT their own title bar wear (a
 *  section page, a draft): rail toggle + where-am-I title. */
function NarrowBar({ title, onOpenRail }: { title: string; onOpenRail: () => void }) {
  return (
    <div className="flex min-h-12 shrink-0 items-center gap-1.5 border-b border-line bg-canvas/80 py-1 pl-2 pr-4">
      <RailOpenButton onClick={onOpenRail} />
      <span className="min-w-0 truncate font-serif text-[15px] font-semibold text-ink">
        {title}
      </span>
    </div>
  )
}

function EmptyState({
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
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
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
        <div className="font-serif text-lg font-semibold text-ink">No messages yet</div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Start typing below to pick this session back up.
        </p>
      </div>
    </div>
  )
}
