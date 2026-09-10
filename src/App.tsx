import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanelLeft, Search } from 'lucide-react'
import { NotificationBell, PaneActionButtons, Sidebar } from './components/Sidebar'
import { SIDEBAR_ICON_BUTTON } from './lib/sidebar'
import { useAuthScreen } from './controller/useAuthScreen'
import { setUiPrefScope } from './lib/uiPrefs'
import type { PaneContent } from './lib/splitFrame'
import { seedFor } from './lib/paneNav'
import { MainSplitGate, type MainPaneNav } from './components/MainSplit'
import { OverlayPanelDock } from './components/OverlayPanelDock'
import { useMainSplit } from './controller/useMainSplit'
import { useRailSplit } from './controller/useRailSplit'
import { useShellRoutes } from './controller/useShellRoutes'
import { hostsSession, paneLocationPath, setMainSplitScope, type MainPaneContent } from './lib/mainSplit'
import { setRailSplitScope, type RailViewRoot } from './lib/railSplit'
import { DeferredSearchPanel } from './components/DeferredSearchPanel'
import {
  keys,
  onSessionRemoved,
  peek,
  resolveAppBootstrap,
  retryAppBootstrap,
  useCapabilities,
  useMe,
  useSessions,
  useServerEvents,
} from './api'
import { conversations, useConversation } from './controller/conversationStore'
import { sameFocus } from './lib/focus'
import { rememberPanelPreference } from './controller/panelPreferences'
import { useSessionWorkspace } from './controller/useSessionWorkspace'
import { useLayout } from './controller/useLayout'
import { RelationsProvider } from './controller/useRelations'
import { canSplitRow, railWidthCss, useViewport } from './lib/viewport'
import { NO_PENDING_FOCUS } from './lib/focusContext'
import { SCRIM_CLASS } from './lib/scrim'
import { SyncHealthNotice } from './components/SyncHealthNotice'
import { AppBootstrapScreen } from './components/AppBootstrapScreen'
import { ModelPreferencesGate } from './components/ModelPreferencesGate'
import { SharedLinkGate } from './components/SharedLinkGate'
import { SkipToMain } from './components/SkipToMain'
import { sharedLinkAddress } from './lib/sharedLink.ts'
import { SECTION_META, sectionAvailable } from './lib/sections'
import { DRAFT_ID } from './data/liveSession'
import type { SectionId, Session } from './types'
import { requestCompositeCommand, requestCompositeFold } from './lib/compositeFeatures'
import { useFocusedCompositeFoldAvailability } from './lib/useCompositeFeatures'

const ShellMutationNotices = lazy(() =>
  import('./components/ShellMutationNotices').then((module) => ({ default: module.ShellMutationNotices })),
)
const AuthScreen = lazy(() =>
  import('./components/auth/AuthScreen').then((module) => ({ default: module.AuthScreen })),
)

/** Auth and workspace are mutually exclusive top-level worlds. A stale or
 * interrupted auth chunk must still leave a complete, operable front door. */
class AuthScreenLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <AppBootstrapScreen
        status="asset-error"
        onRetry={() => window.location.reload()}
      />
    )
  }
}

/** The shell: decides WHICH top-level surface renders — the full-screen auth
 *  flow (multi-account §12) or the workspace. The auth screen shows when the
 *  backend's AUTH GATE applies (`features.authGate` + an identity that isn't a
 *  verified session) or when the user opened it (sign in / create account /
 *  add account / after sign-out — useAuthScreen). It REPLACES the workspace
 *  frame — a dedicated onboarding surface, not a dialog over the product. */
export default function App() {
  const capabilities = useCapabilities()
  const identity = useMe()
  const authView = useAuthScreen()

  // Boot is a two-read decision barrier: until the backend says who we are and
  // whether the auth gate applies, show an identity-neutral progress surface;
  // if either missing read fails, explain it and retry BOTH. Ordinary refetches
  // retain query data; deliberate cache resets must earn a fresh pair.
  const bootstrap = resolveAppBootstrap(
    capabilities.data,
    identity.data,
    capabilities.status,
    identity.status,
  )
  if (bootstrap.status !== 'ready') {
    return <AppBootstrapScreen status={bootstrap.status} onRetry={retryAppBootstrap} />
  }

  const resolvedCapabilities = bootstrap.capabilities
  const resolvedIdentity = bootstrap.identity

  const gated = resolvedCapabilities.features.authGate && resolvedIdentity.via !== 'session'
  if (gated || authView) {
    // Gated with no explicit view: land on the picker — it falls through to
    // the sign-in form when no account is remembered on this browser.
    setUiPrefScope(null)
    return (
      <AuthScreenLoadBoundary>
        <Suspense fallback={<AppBootstrapScreen status="loading" onRetry={retryAppBootstrap} />}>
          <AuthScreen view={authView ?? { kind: 'picker' }} gated={gated} />
        </Suspense>
      </AuthScreenLoadBoundary>
    )
  }
  // Per-account chrome + view memory (multi-account): the layout store reads as
  // THIS account. Both scope setters are pure module writes — idempotent per
  // render, and NOTIFYING NOTHING, which is what makes them legal here: a store
  // notify is a setState on every live reader, and one fired from this render
  // body is the "Cannot update a component while rendering a different
  // component" error (see setUiPrefScope). They must run during render even so,
  // because the children's useState initializers read the store on mount. The
  // signed-in branch is KEYED by the account, so a switch remounts Workspace:
  // every mount-time read (rail width, pane folds/heights, panel width, the
  // persisted split TREE — which IS the account's view memory since Phase 6)
  // re-runs against the account's own blobs. A switch reset clears the gate
  // reads, so bootstrap waits for the NEW /me; no ad-hoc last-identity cache can
  // label the new cookie with the previous account.
  setUiPrefScope(resolvedIdentity.user.id)
  setMainSplitScope(resolvedIdentity.user.id) // the main split tree is per account, like the layout blob
  setRailSplitScope(resolvedIdentity.user.id)
  return (
    <SharedLinkGate
      key={resolvedIdentity.user.id}
      address={sharedLinkAddress(window.location.pathname)}
      expectedSessionUserId={resolvedIdentity.via === 'session' ? resolvedIdentity.user.id : undefined}
    >
      <ModelPreferencesGate key={`${resolvedIdentity.user.id}:${resolvedIdentity.tenant.id}`}>
        <Workspace instanceAdmin={resolvedIdentity.instanceAdmin === true} />
      </ModelPreferencesGate>
    </SharedLinkGate>
  )
}

/** The View: composes the product chrome from three controllers — the main
 *  split (the tree of equal panes + the focused-pane cursor), the shell nav
 *  (boot / URL / popstate / account switch / doors), and the rail layout —
 *  holding only local view chrome (the search palette toggle). All business
 *  logic lives in the controllers (controller/) and the model (data/). */
function Workspace({ instanceAdmin }: { instanceAdmin: boolean }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  // Subscribe to the backend's ambient event stream (scheduled runs, standing
  // approvals, connector status). The session list now comes from the server —
  // the sidebar and search read the same rows the API serves, not a local const.
  useServerEvents()
  const sessions = useSessions().data ?? []

  // A session's display title from the live rows (falling back to the
  // loadSession cache for run sessions outside the list) — the pane title
  // bars, the picker labels, AND the back-history push (ADAPT-18: an msession
  // back entry carries its title, resolved when you leave it).
  const sessionLabel = useCallback(
    (id: string) =>
      id === DRAFT_ID
        ? 'New session'
        : (sessions.find((s) => s.id === id)?.title ?? peek<Session>(keys.session(id))?.title ?? 'Conversation'),
    [sessions],
  )
  const restorePaneAvailable = useCallback(
    (content: MainPaneContent) =>
      content.kind !== 'msection' || sectionAvailable(content.id, { instanceAdmin }),
    [instanceAdmin],
  )

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
    reportPaneAt,
    pruneMainPanes,
    fillMainPane,
    closeMainPane,
    closePaneFromAction,
    setMainRatio,
  } = useMainSplit({ sessionTitle: sessionLabel, restoreKeep: restorePaneAvailable })

  // ── The RAIL split: the same focused-leaf interaction as main, deliberately
  // restricted to vertical views of the one account-resource forest.
  const {
    railTree,
    focusedRailPane,
    railCanSplit,
    railCanClose,
    selectedRailEntry,
    focusRailPane,
    selectRailEntry,
    splitFocusedRail,
    closeRailFromAction,
    setRailRatio,
  } = useRailSplit()
  const focusedFoldAvailability = useFocusedCompositeFoldAvailability()
  const [focusedArea, setFocusedArea] = useState<'main' | 'rail'>('main')
  const focusRailArea = useCallback(
    (path: string) => {
      setFocusedArea('rail')
      focusRailPane(path)
    },
    [focusRailPane],
  )
  const selectRailAreaEntry = useCallback(
    (path: string, root: RailViewRoot) => {
      setFocusedArea('rail')
      selectRailEntry(path, root)
    },
    [selectRailEntry],
  )

  // The focused pane's canonical path (the ONE content→address rule,
  // paneLocationPath): a conversation or section pane has its own; a CONTEXT
  // pane addresses as its OWNING conversation; a picker or the background
  // keeps the current address ('keep': no push at all).
  const focusedPath = useMemo(
    (): string | 'keep' => (focusedContent ? (paneLocationPath(focusedContent) ?? 'keep') : 'keep'),
    [focusedContent],
  )

  // The route bridges — how an ADDRESSED navigation (boot, popstate, a door)
  // becomes a focused-pane edit (controller/useShellRoutes.ts: the boot
  // dedup, the total routing, the notification landing-pane record).
  const { applyRouteToFocused, applyPopRoute, applyBootRoute, routeDoor, routeSession, routeSection, mintIfEmpty, notifPaneRef } =
    useShellRoutes({ mainTree, focusedPane, routeToFocused, focusMainPane, fillMainPane })

  const {
    pendingFocus,
    consumeFocus,
    openSession,
    focusHere,
    newSession,
    openSection,
    openProject,
    openSchedule,
    openOwner,
    openAgentPage,
    openDiscussionPage,
    openDetail,
    openProposal,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
  } = useSessionWorkspace({ focusedPath, applyRouteToFocused, applyPopRoute, applyBootRoute, routeDoor, routeSession, routeSection, mintIfEmpty })

  // LIVE PRUNE, the delete half: deleting a session evicts EVERY pane it
  // hosts — its conversation panes and its context panes alike (hostsSession),
  // not just the focused one. Deleting the last pane leaves the background,
  // exactly like closing it (the one close rule).
  const deleteSessionAndEvict = useCallback(
    (id: string, expectedRevision: number) => {
      void deleteSession(id, expectedRevision).then((outcome) => {
        if (outcome === 'applied') pruneMainPanes((c) => !hostsSession(c, id))
      })
    },
    [deleteSession, pruneMainPanes],
  )
  // …and the CROSS-CLIENT half: another client's delete arrives as the
  // definitive `session.removed` gone-signal — prune here too (this client's
  // own delete echoes through the same seam; the prune is idempotent).
  useEffect(
    () => onSessionRemoved((id) => pruneMainPanes((c) => !hostsSession(c, id))),
    [pruneMainPanes],
  )

  // ── The rail's active highlight derives from the FOCUSED pane (the live
  // source — the pre-split singleton's activeId/activeSection froze at their
  // boot defaults once every door routed into panes). A context pane
  // highlights its OWNING conversation; a section pane highlights its
  // section + the sub-view it REPORTS (`at` — its live location, falling
  // back to the door's seed for the pre-report frame).
  const railActiveSessionId =
    focusedContent?.kind === 'msession'
      ? focusedContent.id
      : focusedContent?.kind === 'context-panel'
        ? focusedContent.sessionId
        : ''
  const railActiveSection = focusedContent?.kind === 'msection' ? focusedContent.id : null
  const railActiveSubview =
    focusedContent?.kind === 'msection'
      ? focusedContent.at
        ? focusedContent.at.sub
        : (focusedContent.sub ?? null)
      : null
  // …and the DETAIL that pane has open (its live seed, same fallback), so the
  // rail's instance children can highlight the row you're actually on (UI-19).
  const railActiveSeed =
    focusedContent?.kind === 'msection' ? (focusedContent.at ?? focusedContent.seed ?? null) : null

  // The narrow tier's slim header (NarrowBar) covers every focused surface
  // that has no title bar of its own — null = a conversation is focused (its
  // SessionTitleBar houses the rail toggle instead).
  const narrowBarTitle: string | null =
    focusedContent?.kind === 'msection'
      ? SECTION_META[focusedContent.id].label
      : focusedContent?.kind === 'context-panel'
        ? (sessions.find((s) => s.id === focusedContent.sessionId)?.title ?? 'Context')
        : !focusedContent
          ? '' // the BACKGROUND — the bar is the rail toggle's only home here
          : null

  // Responsive layout ladder (FWD-3 / PD35): below a wide window the right panel
  // would crush the conversation column, so it overlays as a drawer (with a scrim)
  // instead of sitting side-by-side; on narrow (a phone) the left rail becomes an
  // off-canvas drawer too and the right panel takes over the whole viewport.
  const { tier, stackable, railStackable } = useViewport()
  const panelOverlay = tier !== 'wide'
  const railOverlay = tier === 'narrow'

  const { leftOpen, leftW, leftDragging, toggleLeft, openLeft, closeLeft, startResize, resize, endResize } =
    useLayout(tier)

  // The resource rail can contain more than a hundred keyboard targets before
  // the focused page. One first-in-order bypass moves directly to the main
  // landmark. On narrow, dismiss the drawer first so `main[inert]` has cleared
  // before focus transfers (UI-57).
  const skipToMain = useCallback(() => {
    const focusMain = () => mainRef.current?.focus({ preventScroll: true })
    if (railOverlay && leftOpen) {
      closeLeft()
      window.requestAnimationFrame(focusMain)
      return
    }
    focusMain()
  }, [railOverlay, leftOpen, closeLeft])

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

  // (Boot lives in the shell controller's effect — the consume-once boot
  // address applies through applyRouteToFocused; with no address the
  // per-account persisted TREE stands as the view memory, and mintIfEmpty
  // provides the fresh-draft default when nothing fills the background.)

  // ── The FOCUSED conversation's context panel as a tree pane (Phase 6) ───────
  // The focused pane's session + its STORE-held `focus` drive the projection:
  // a real context PANE beside the conversation on the wide tier; the overlay
  // tiers dock it (OverlayPanelDock). A focused CONTEXT pane keeps projecting
  // for its OWNING session, so closing/re-opening panels doesn't flap. (A
  // scheduled-run session's run history is NOT a panel — it floats as the
  // title bar's click-down, UI-15.)
  const focusedSessionId =
    focusedContent?.kind === 'msession'
      ? focusedContent.id
      : focusedContent?.kind === 'context-panel'
        ? focusedContent.sessionId
        : null

  const focusedConv = useConversation(focusedSessionId ?? DRAFT_ID)
  const focusedFocus = focusedSessionId ? focusedConv.focus : null
  const activePanel = useMemo<PaneContent | null>(
    () => (focusedSessionId && focusedFocus ? { kind: focusedFocus.kind, id: focusedFocus.id } : null),
    [focusedSessionId, focusedFocus],
  )
  useEffect(() => {
    // No conversation focused (a section pane, the background) — leave the
    // tree as-is: an absent subject is not a "close the panel" instruction.
    if (!focusedSessionId) return
    setFocusDrivenContext(focusedSessionId, tier === 'wide' ? activePanel : null)
  }, [setFocusDrivenContext, focusedSessionId, tier, activePanel])
  // Split duplicates the FOCUSED pane's own content (every page equally —
  // the controller reads the leaf; no caller-supplied "what the primary
  // shows" since there is no primary).
  const splitView = splitFocused
  // A notification door's transient focus target, handed to the SectionView
  // subtree by context (docs/notification-routing.md) — PER PANE: only the
  // pane the door LANDED in (notifPaneRef, recorded by routeDoor) sees the
  // pending target, so a duplicate pane showing the same page can't steal
  // (or double-fire) the highlight. Memoized so the value identity only
  // changes when the target actually changes — not every App render.
  const focusCtx = useMemo(() => ({ pending: pendingFocus, consume: consumeFocus }), [pendingFocus, consumeFocus])
  const focusCtxFor = useCallback(
    (path: string) => (pendingFocus && path === notifPaneRef.current ? focusCtx : NO_PENDING_FOCUS),
    [pendingFocus, focusCtx],
  )

  const mainPaneNav = useMemo<MainPaneNav>(
    () => ({
      // A session door from inside a pane (a section page's session list, the
      // title bar's run-history click-down): the FOCUSED pane hosts the
      // session, like every navigation. NOTE: PaneBody OVERRIDES this door —
      // and the two breadcrumb doors below — with a self-fill that pushes the
      // origin onto the target's back stack (ADAPT-18); these shell versions
      // are the fallback for hosts without a tree path.
      onOpenSession: (id) => routeToFocused({ kind: 'msession', id }),
      // The second half of a locus door: the caller already navigated by its
      // subject's own door, so this only aims the transient highlight — at THAT
      // pane when pane-originated (the normal case), else the focused one.
      onFocusHere: (target, panePath) => {
        if (panePath !== undefined) notifPaneRef.current = panePath
        focusHere(target)
      },
      onNewSession: newSession,
      // A proposal row inside a page: pane-originated, so the origin rides the
      // target's back stack (a chrome door omits the push).
      onOpenProposal: (agentId, proposalId, ownerName) => openProposal(agentId, proposalId, ownerName, true),
      onOpenProject: openProject,
      onOpenSchedule: openSchedule,
      // A pane composer's chip click toggles ITS session's STORE focus — the
      // wide tier tiles the panel beside that conversation (the projection),
      // the overlay tiers dock it; remembered per session (FWD-2).
      onOpenSessionContext: (sessionId, f) => {
        const next = sameFocus(conversations.get(sessionId).focus, f) ? null : f
        conversations.setFocus(sessionId, next)
        if (sessionId !== DRAFT_ID) rememberPanelPreference(sessionId, next)
      },
      sessionLabel,
      // A pane-hosted draft materialized: every draft pane follows the entry
      // to the real id (content match — a duplicated draft pane follows too).
      onDraftAdopted: (realId) => adoptDraftPanes(DRAFT_ID, realId),
      // The per-pane notification-focus provider (see focusCtxFor above).
      focusCtxFor,
      // LIVE PRUNE: a context pane reported its subject definitively
      // detached. A PINNED pane closes via the tree; the focus-driven pane
      // clears its DRIVER (closing the projection would just be
      // re-projected) — and forgets the choice (FWD-2), so reopening the
      // session can't resurrect a panel whose subject is gone.
      onPaneSubjectGone: (path, content) => {
        if (content.kind === 'context-panel' && content.focusDriven) {
          conversations.setFocus(content.sessionId, null)
          if (content.sessionId !== DRAFT_ID) rememberPanelPreference(content.sessionId, null)
        } else {
          closeMainPane(path)
        }
      },
      // The narrow tier's in-flow rail toggle rides the conversation title bar.
      railToggle: railOverlay ? <RailOpenButton onClick={openLeft} /> : undefined,
    }),
    [routeToFocused, focusHere, notifPaneRef, newSession, openProposal, openProject, openSchedule, sessionLabel, adoptDraftPanes, focusCtxFor, closeMainPane, railOverlay, openLeft],
  )


  // The one bridge the relations store needs from the shell: the "View in …"
  // deep-link nav (an attach-context op attaches inside its own card —
  // useSessionContextCommands — since the equal-panes model has no "active
  // session" for a root bridge to target). Memoized so the RelationsProvider
  // value doesn't rebuild every render — otherwise every useRelations consumer
  // re-renders on each App render.
  // The relations "View in …" deep-link. The second arg is an entity id whose
  // meaning depends on the section: a project to expand, a schedule to open, a
  // saved context's detail, or — under agents — an owner display name whose
  // public profile to show (D21).
  // The mapping itself is `seedFor` — the SAME function the pane-local bridge
  // resolves with (src/lib/paneNav.ts), rather than a hand-copied ternary chain
  // beside it. The two bridges were meant to mirror each other shape for shape
  // and had already drifted: a `navigate('discussions', id)` reaching the root
  // fell through to the section ROOT, dropping the thread it named.
  const navigateToSection = useCallback(
    (section: SectionId, id?: string, subId?: string) => {
      const seed = seedFor(section, id, subId)
      if (seed) openDetail(section, seed)
      else openSection(section)
    },
    [openDetail, openSection],
  )

  // The original main-pane acts, gated once by their respective viewport axes.
  // The expanded rail switches this shared cluster by focus below; the
  // collapsed MiniRail can only address main panes because no rail view is
  // available to focus while the rail is closed.
  const mainSplitRowAct = canSplitRow(tier) ? () => splitView('row') : undefined
  const mainSplitColAct = stackable ? () => splitView('col') : undefined
  const mainCloseAct =
    (mainSplitRowAct || mainSplitColAct) && focusedClosable
      ? () =>
          closePaneFromAction(focusedPane, (sessionId) => {
            // The focus-driven context panel: clear its OWNING session's STORE
            // focus so the projection removes the pane (panelPref remembers it
            // closed, FWD-2).
            conversations.setFocus(sessionId, null)
            if (sessionId !== DRAFT_ID) rememberPanelPreference(sessionId, null)
          })
      : undefined
  const mainCloseTarget = mainCloseAct ? `main:${focusedPane}` : undefined
  const focusedMainFold =
    focusedContent?.kind === 'msection' && focusedFoldAvailability?.section === focusedContent.id
      ? focusedFoldAvailability
      : null
  const mainFoldAllAct = focusedMainFold?.canFold
    ? () => requestCompositeFold(focusedMainFold.section, false)
    : undefined
  const mainUnfoldAllAct = focusedMainFold?.canUnfold
    ? () => requestCompositeFold(focusedMainFold.section, true)
    : undefined
  // One command cluster, two focused surfaces. Main keeps both original split
  // directions; the rail exposes only Split down, and only after an arbitrary
  // navigation entry in its focused view has been selected. Main panes all
  // close; in the rail only rooted secondary views close, so the complete
  // resource forest remains the permanent recovery anchor.
  const paneSplitRowAct = focusedArea === 'main' ? mainSplitRowAct : undefined
  const paneSplitColAct =
    focusedArea === 'rail'
      ? railStackable && railCanSplit
        ? splitFocusedRail
        : undefined
      : mainSplitColAct
  const paneCloseAct =
    focusedArea === 'rail'
      ? railCanClose
        ? () => closeRailFromAction(focusedRailPane)
        : undefined
      : mainCloseAct
  const paneCloseTarget =
    focusedArea === 'rail'
      ? railCanClose ? `rail:${focusedRailPane}` : undefined
      : mainCloseTarget

  return (
    <RelationsProvider navigate={navigateToSection}>
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <SkipToMain onSkip={skipToMain} />
      <SyncHealthNotice />
      <Suspense fallback={null}>
        <ShellMutationNotices />
      </Suspense>
      {/* ===== The product — no top bar; the rail owns its toggle ===== */}
      <div data-popover-viewport className="relative flex min-h-0 flex-1 flex-col">
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
                activeId={railActiveSessionId}
                activeSection={railActiveSection}
                activeSubview={railActiveSubview}
                activeSeed={railActiveSeed}
                onSelect={withRailClose(openSession)}
                onNewSession={withRailClose(newSession)}
                // Section / sub-view handlers stay UNwrapped by withRailClose: the rail
                // decides when to close the narrow drawer (a leaf navigates → close;
                // drilling into a section's sub-menu keeps it open), via onLeafNavigate
                // below. Every door retargets the FOCUSED pane (the focused-pane
                // routing) — on the background it mints the first pane.
                onOpenSection={(id) => openSection(id)}
                onOpenSubview={(section, sub) => openSection(section, sub)}
                // An instance child (UI-19): the section, with that row open —
                // the same door a notification or a link uses.
                onOpenDetail={openDetail}
                onCompositeCommand={(section, kind) => {
                  // Route the FOCUSED pane to the composite root first. The
                  // command remains pending across that remount and only the
                  // focused matching page may consume it.
                  openSection(section)
                  requestCompositeCommand(section, kind)
                }}
                onLeafNavigate={railOverlay ? closeLeft : undefined}
                onOpenSchedule={withRailClose(openSchedule)}
                onPinSession={pinSession}
                onRenameSession={renameSession}
                onArchiveSession={archiveSession}
                onDeleteSession={deleteSessionAndEvict}
                onToggleCollapse={toggleLeft}
                onOpenSearch={withRailClose(() => setSearchOpen(true))}
                onOpenNotifications={withRailClose(() => openSection('notifications'))}
                onOpenOwner={withRailClose(openOwner)}
                onSplitRow={paneSplitRowAct}
                onSplitCol={paneSplitColAct}
                onCloseView={paneCloseAct}
                paneCloseTarget={paneCloseTarget}
                onFoldAll={focusedArea === 'main' ? mainFoldAllAct : undefined}
                onUnfoldAll={focusedArea === 'main' ? mainUnfoldAllAct : undefined}
                paneActionTarget={focusedArea}
                railTree={railTree}
                focusedRailPane={focusedRailPane}
                selectedRailEntry={selectedRailEntry}
                onFocusRailPane={focusRailArea}
                onSelectRailEntry={selectRailAreaEntry}
                onRailRatio={setRailRatio}
                resizable={!railOverlay}
                railW={leftW}
                onResizeStart={startResize}
                onResize={resize}
                onResizeEnd={endResize}
              />
            </div>
          </div>

          {/* When the rail is collapsed it doesn't vanish — it MINIMIZES to a
              slim in-flow column wearing the rail's own chrome (bg + border-r)
              and its header trio rotated vertical: expand / search /
              notifications. Two rules meet here. UI-3: in-flow on EVERY tier,
              so content can never slide under chrome (the old floating
              spelling relied on a `pl-14` title indent that silently died
              when the equal-panes model made every surface a homogeneous
              pane — layout reservation must be structural, not a convention).
              And balance: a bare gutter read as lopsided margin; the rail's
              own surface makes the column read as intentional chrome, and
              keeps the rail's daily doors one click away while collapsed.
              (On narrow the toggle lives inline in the title bar / NarrowBar
              instead — the drawer overlays rather than tiles.) */}
          {!leftOpen && !railOverlay && (
            <MiniRail
              onExpand={openLeft}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenNotifications={() => openSection('notifications')}
              onSplitRow={mainSplitRowAct}
              onSplitCol={mainSplitColAct}
              onCloseView={mainCloseAct}
              closeTarget={mainCloseTarget}
              onFoldAll={mainFoldAllAct}
              onUnfoldAll={mainUnfoldAllAct}
            />
          )}

          <main
            // While the narrow drawer floats over the app, everything it covers
            // leaves the tab order / accessibility tree (UI-8) — the drawer and
            // its scrim are siblings, so one attribute covers thread + panel.
            inert={railOverlay && leftOpen}
            ref={mainRef}
            id="main-workspace"
            tabIndex={-1}
            onPointerDownCapture={() => setFocusedArea('main')}
            onFocusCapture={() => setFocusedArea('main')}
            className="flex min-w-0 flex-1 flex-col"
          >
            {/* Narrow tier: every focused surface WITHOUT its own title bar
                gets the slim header row HOUSING the rail toggle (in-flow, so
                content scrolls under nothing) — a section page, a pinned
                context pane (titled after its owning conversation), a legacy
                picker, and the BACKGROUND (without it, "open from the
                sidebar" was advice the narrow tier gave with no way to open
                the sidebar). Conversations — the DRAFT included — embed the
                toggle in their SessionTitleBar instead. */}
            {railOverlay && narrowBarTitle !== null && (
              <NarrowBar title={narrowBarTitle} onOpenRail={openLeft} />
            )}
            {/* The universal main split — panes are the ONLY render path
                (Phase 6, the owner's equal-pages model): wide tiles the tree;
                overlay tiers keep those pane instances mounted but expose only
                the FOCUSED path (ADAPT-11); no tree = the background. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {/* While the docked panel overlays the focused pane (medium
                  drawer / narrow takeover), the covered content is inert
                  (UI-8) — it leaves the tab order / accessibility tree. */}
              <section
                inert={tier !== 'wide' && !!focusedFocus}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {/* The notification-door focus target is provided PER PANE
                    (PaneBody, via nav.focusCtxFor) — the highlight reaches
                    exactly the pane the door landed in (consumed once,
                    docs/notification-routing.md). */}
                <MainSplitGate
                  tree={mainTree}
                  overlay={tier !== 'wide'}
                  focusedPane={focusedPane}
                  nav={mainPaneNav}
                  onFocusPane={focusMainPane}
                  onFillPane={fillMainPane}
                  onReportAt={reportPaneAt}
                  onRatio={setMainRatio}
                />
              </section>
              {/* The focused conversation's context panel on the OVERLAY tiers
                  (medium drawer / narrow takeover, ADAPT-11) — keyed on the
                  FOCUSED pane's session and its STORE-held focus (no singleton;
                  the wide tier tiles it as a context pane instead). */}
              {tier !== 'wide' && (
                <OverlayPanelDock
                  sessionId={focusedContent?.kind === 'msession' ? focusedContent.id : null}
                  tier={tier}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      {searchOpen && (
        <DeferredSearchPanel
          sessions={sessions}
          onSelectSession={openSession}
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

/** The collapsed rail on wide/medium (UI-3): the rail minimized to a slim
 *  in-flow column wearing the rail's own surface, its header cluster rotated
 *  vertical — expand, search, notifications (the live-badged shared bell),
 *  and the focused-pane acts (the shared split/close cluster, offered under
 *  the SAME gates the expanded rail applies — the parent passes the hoisted
 *  handlers to both hosts). */
function MiniRail({
  onExpand,
  onOpenSearch,
  onOpenNotifications,
  onSplitRow,
  onSplitCol,
  onCloseView,
  closeTarget,
  onFoldAll,
  onUnfoldAll,
}: {
  onExpand: () => void
  onOpenSearch: () => void
  onOpenNotifications: () => void
  onSplitRow?: () => void
  onSplitCol?: () => void
  onCloseView?: () => void
  closeTarget?: string
  onFoldAll?: () => void
  onUnfoldAll?: () => void
}) {
  return (
    <div
      data-mini-rail
      className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-sidebar pt-2.5"
    >
      <button onClick={onExpand} title="Expand sidebar" aria-label="Expand sidebar" className={SIDEBAR_ICON_BUTTON}>
        <PanelLeft size={18} />
      </button>
      <button onClick={onOpenSearch} title="Search  (⌘K)" aria-label="Search" className={SIDEBAR_ICON_BUTTON}>
        <Search size={18} />
      </button>
      <NotificationBell onClick={onOpenNotifications} />
      <PaneActionButtons
        onFoldAll={onFoldAll}
        onUnfoldAll={onUnfoldAll}
        onSplitRow={onSplitRow}
        onSplitCol={onSplitCol}
        onCloseView={onCloseView}
        closeTarget={closeTarget}
      />
    </div>
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
