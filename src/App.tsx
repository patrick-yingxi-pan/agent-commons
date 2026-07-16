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
import { EmptyState } from './components/EmptyState'
import { OverlayPanelDock } from './components/OverlayPanelDock'
import { ConversationView } from './components/ConversationView'
import { useMainSplit } from './controller/useMainSplit'
import { setMainSplitScope } from './lib/mainSplit'
import { SectionView } from './components/SectionView'
import { AttachmentPanel } from './components/AttachmentPanel'
import { ConnectorPanel } from './components/ConnectorPanel'
import { SearchPanel } from './components/SearchPanel'
import { NotificationsPanel } from './components/NotificationsPanel'
import { AddContextButton } from './components/AddContextButton'
import { keys, peek, useCapabilities, useMe, useProviders, useSessions, useServerEvents } from './api'
import { conversations, useConversation } from './controller/conversationStore'
import { sameFocus } from './lib/focus'
import { setPanelPref } from './lib/panelPrefs'
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
import { pathForView, viewForPath, type RoutedView } from './lib/urlRoutes'
import type { PaneSeed } from './lib/paneNav'
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

  // ── The MAIN workspace split (universal split, focused-pane model) ──────────
  // Called BEFORE the workspace hook: the address bar projects the FOCUSED
  // pane (Phase 6), so the workspace's URL-sync effect takes the focused
  // pane's canonical path — and popstate its retarget — as inputs.
  const {
    mainTree,
    focusedPane,
    focusedClosable,
    focusedContent,
    focusMainPane,
    splitFocused,
    routeToFocused,
    setFocusDrivenContext,
    adoptDraftPanes,
    fillMainPane,
    closeFocused,
    setMainRatio,
  } = useMainSplit()

  // Mirror for stable callbacks (mainPaneNav must not rebuild per focus hop).
  const focusedContentRef = useRef(focusedContent)
  focusedContentRef.current = focusedContent

  // The focused pane's canonical path: a conversation or section pane has its
  // own; a CONTEXT pane addresses as its OWNING conversation (a panel is not
  // a page — the address names the page it belongs to); a picker or the
  // background keeps the current address ('keep': no push at all — the old
  // 'defer to the singleton' fallback derived from state nothing updates now).
  const focusedPath = useMemo((): string | 'keep' => {
    const c = focusedContent
    if (!c) return 'keep'
    if (c.kind === 'msession') return pathForView({ kind: 'session', sessionId: c.id, title: '' }, null)
    if (c.kind === 'context-panel') return pathForView({ kind: 'session', sessionId: c.sessionId, title: '' }, null)
    if (c.kind === 'msection')
      return pathForView(
        { kind: 'section', section: c.id, projectId: null, scheduleId: null, ownerName: null, workItemId: null, agentId: null, contextId: null },
        c.sub ?? null,
      )
    return 'keep'
  }, [focusedContent])

  // Browser Back/Forward retarget the FOCUSED pane (like every navigation);
  // returns false with the primary focused — the singleton applies it then.
  // Section deep-detail URLs land at section+facet granularity in a pane
  // (the detail lift is the Phase 6 fidelity fast-follow).
  const applyRouteToFocused = useCallback(
    (routed: RoutedView | null): boolean => {
      if (!routed) {
        // The root = a FRESH draft (like every other draft door): reset first,
        // or the coalesce handle would append the next send to the PREVIOUS
        // materialized session.
        draft.reset()
        return routeToFocused({ kind: 'msession', id: DRAFT_ID })
      }
      if (routed.loc.kind === 'session') return routeToFocused({ kind: 'msession', id: routed.loc.sessionId })
      return routeToFocused({ kind: 'msection', id: routed.loc.section, sub: routed.subview ?? null })
    },
    [routeToFocused],
  )

  // An entity door (a notification bell, a palette hit, a relation card's
  // "View in …") lands in the FOCUSED pane, its detail page open (the pane
  // seed) — like every navigation; false with the primary focused (the
  // singleton opens it as before).
  const routeDoor = useCallback(
    (section: SectionId, seed: PaneSeed): boolean => routeToFocused({ kind: 'msection', id: section, seed }),
    [routeToFocused],
  )
  // A session door (palette hit, notifications row, boot address, restore
  // memory) and a bare-section door land in the focused pane the same way.
  const routeSession = useCallback((id: string): boolean => routeToFocused({ kind: 'msession', id }), [routeToFocused])
  const routeSection = useCallback(
    (section: SectionId, sub?: string | null): boolean => routeToFocused({ kind: 'msection', id: section, sub: sub ?? null }),
    [routeToFocused],
  )

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
  } = useSessionWorkspace({ focusedPath, applyRouteToFocused, routeDoor, routeSession, routeSection })

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

  // (Boot lives in the workspace hook's restore effect — the consume-once boot
  // address, the per-account memory, and the fresh-draft default all apply
  // through the routeSession/routeSection/routeDoor bridges, which MINT the
  // first pane when only the background shows.)

  // ── The FOCUSED conversation's context panel as a tree pane (Phase 6) ───────
  // The focused pane's session + its STORE-held `focus` (or the run switcher
  // for a run session — the row read live, falling back to the loadSession
  // cache for rows the list doesn't carry) drive the projection: a real
  // context PANE beside the conversation on the wide tier; the overlay tiers
  // dock it (OverlayPanelDock). A focused CONTEXT pane keeps projecting for
  // its OWNING session, so closing/re-opening panels doesn't flap.
  const focusedSessionId =
    focusedContent?.kind === 'msession'
      ? focusedContent.id
      : focusedContent?.kind === 'context-panel'
        ? focusedContent.sessionId
        : null

  // Re-open the run switcher when the focused CONVERSATION changes — keyed on
  // the session (stable across a conversation and its own context pane), so a
  // focus hop between the two can't resurrect a just-closed switcher.
  useEffect(() => {
    setRunsPanelOpen(true)
  }, [focusedSessionId])
  const focusedConv = useConversation(focusedSessionId ?? DRAFT_ID)
  const focusedRow = focusedSessionId
    ? (sessions.find((s) => s.id === focusedSessionId) ?? peek<Session>(keys.session(focusedSessionId)))
    : undefined
  const focusedRunOf = focusedRow?.scheduledRunOf
  const focusedFocus = focusedSessionId ? focusedConv.focus : null
  const activePanel = useMemo<PaneContent | null>(
    () =>
      !focusedSessionId
        ? null
        : focusedFocus
          ? { kind: focusedFocus.kind, id: focusedFocus.id }
          : focusedRunOf && runsPanelOpen
            ? { kind: 'runs', id: focusedRunOf.taskId }
            : null,
    [focusedSessionId, focusedFocus, focusedRunOf, runsPanelOpen],
  )
  // LATCHED while the focused session's row resolves (a run opened from the
  // runs panel, a session not in the list yet): an unresolved row reads as
  // "no panel" and would DISSOLVE + re-form the tree, remounting everything
  // (the projection-latch rule — a transient unknown is not a definitive
  // absence). The reconcile notify re-renders App, so the latch releases.
  const focusedResolving = !!focusedSessionId && focusedSessionId !== DRAFT_ID && !focusedRow
  useEffect(() => {
    // No conversation focused (a section pane, the background) — leave the
    // tree as-is: an absent subject is not a "close the panel" instruction.
    if (!focusedSessionId || focusedResolving) return
    setFocusDrivenContext(focusedSessionId, tier === 'wide' ? activePanel : null)
  }, [setFocusDrivenContext, focusedSessionId, tier, activePanel, focusedResolving])
  // Split duplicates the FOCUSED pane's own content (every page equally —
  // the controller reads the leaf; no caller-supplied "what the primary
  // shows" since there is no primary).
  const splitView = splitFocused
  const mainPaneNav = useMemo<MainPaneNav>(
    () => ({
      // A session door: with a CONTEXT pane focused (the run switcher's row
      // click), the OWNING conversation's pane retargets in place — its
      // context pane self-heals via the projection; otherwise the focused
      // pane hosts the session (like every navigation).
      onOpenSession: (id) => {
        const c = focusedContentRef.current
        if (c?.kind === 'context-panel') {
          // A run-switcher row: the OWNING conversation retargets in place —
          // and the panel itself swaps to the NEW session immediately (the
          // projection can't heal it while the panel keeps focus).
          adoptDraftPanes(c.sessionId, id)
          setFocusDrivenContext(id, c.panel)
        } else routeToFocused({ kind: 'msession', id })
      },
      onNewSession: () => {
        draft.reset()
        routeToFocused({ kind: 'msession', id: DRAFT_ID })
      },
      onOpenProposal: openProposal,
      onOpenProject: openProject,
      onOpenSchedule: openSchedule,
      // A pane composer's chip click toggles ITS session's STORE focus — the
      // wide tier tiles the panel beside that conversation (the projection),
      // the overlay tiers dock it; remembered per session (FWD-2).
      onOpenSessionContext: (sessionId, f) => {
        const next = sameFocus(conversations.get(sessionId).focus, f) ? null : f
        conversations.setFocus(sessionId, next)
        if (sessionId !== DRAFT_ID) setPanelPref(sessionId, next)
      },
      sessionLabel: (id) => sessions.find((s) => s.id === id)?.title ?? 'Conversation',
      // A pane-hosted draft materialized: every draft pane follows the entry
      // to the real id (content match — a duplicated draft pane follows too).
      onDraftAdopted: (realId) => adoptDraftPanes(DRAFT_ID, realId),
      // The narrow tier's in-flow rail toggle rides the conversation title bar.
      railToggle: railOverlay ? <RailOpenButton onClick={openLeft} /> : undefined,
    }),
    [routeToFocused, openProposal, openProject, openSchedule, sessions, adoptDraftPanes, railOverlay, openLeft],
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
                  // routing every door follows): reset the shared draft entry
                  // and retarget the pane — on the background this mints the
                  // first pane.
                  draft.reset()
                  routeToFocused({ kind: 'msession', id: DRAFT_ID })
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
                        closeFocused((panel) => {
                          // The focus-driven context panel: clear its OWNING
                          // session's STORE focus so the projection removes the
                          // pane (panelPref remembers it closed, FWD-2). Closing
                          // the RUN SWITCHER hides it; closing an attached-context
                          // panel on a run session clears `focus` but LEAVES
                          // runsPanelOpen, so the run switcher falls back in.
                          const c = focusedContentRef.current
                          const sid = c?.kind === 'context-panel' ? c.sessionId : null
                          if (panel.kind === 'runs') setRunsPanelOpen(false)
                          else if (sid) {
                            conversations.setFocus(sid, null)
                            if (sid !== DRAFT_ID) setPanelPref(sid, null)
                          }
                        })
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
            {/* Narrow tier: a focused SECTION pane has no title bar of its own
                — a slim header row HOUSES the rail toggle (in-flow, so content
                scrolls under nothing). Conversations — the DRAFT included —
                embed the toggle in their SessionTitleBar instead. */}
            {railOverlay && focusedContent?.kind === 'msection' && (
              <NarrowBar title={SECTION_META[focusedContent.id].label} onOpenRail={openLeft} />
            )}
            {/* The universal main split — panes are the ONLY render path
                (Phase 6, the owner's equal-pages model): the wide tier tiles
                the tree; the overlay tiers render the FOCUSED pane alone
                (ADAPT-11); no tree = the background. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {/* While the docked panel overlays the focused pane (medium
                  drawer / narrow takeover), the covered content is inert
                  (UI-8) — it leaves the tab order / accessibility tree. */}
              <section
                inert={tier !== 'wide' && !!(focusedFocus || (focusedRunOf && runsPanelOpen))}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {/* ONE transient notification-door focus for every pane — a
                    bell's highlight target reaches whichever pane the door
                    landed in (consumed once, docs/notification-routing.md). */}
                <FocusContext.Provider value={focusCtx}>
                  <MainSplitGate
                    tree={mainTree}
                    overlay={tier !== 'wide'}
                    focusedPane={focusedPane}
                    nav={mainPaneNav}
                    onFocusPane={focusMainPane}
                    onFillPane={fillMainPane}
                    onRatio={setMainRatio}
                  />
                </FocusContext.Provider>
              </section>
              {/* The focused conversation's context panel on the OVERLAY tiers
                  (medium drawer / narrow takeover, ADAPT-11) — keyed on the
                  FOCUSED pane's session and its STORE-held focus (no singleton;
                  the wide tier tiles it as a context pane instead). */}
              {tier !== 'wide' && (
                <OverlayPanelDock
                  sessionId={focusedContent?.kind === 'msession' ? focusedContent.id : null}
                  tier={tier}
                  runsPanelOpen={runsPanelOpen}
                  onCloseRuns={() => setRunsPanelOpen(false)}
                  onSelectRun={(id) => routeToFocused({ kind: 'msession', id })}
                  onOpenRoutine={openSchedule}
                />
              )}
            </div>
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

// EmptyState moved to src/components/EmptyState.tsx — ONE empty conversation
// surface for every host (the singleton AND a pane-hosted draft), so a draft
// looks identical wherever it renders.
