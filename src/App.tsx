import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { CalendarClock, Folder, PanelLeft } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { AuthScreen } from './components/auth/AuthScreen'
import { useAuthScreen } from './controller/useAuthScreen'
import { setUiPrefScope } from './lib/uiPrefs'
import type { Capabilities, Identity } from '../contract/index.ts'
import { Composer } from './components/Composer'
import { MessageRow, TypingRow } from './components/Message'
import { CompactionAffordance } from './components/CompactionAffordance'
import { TurnControls } from './components/TurnControls'
import { WorkspacePanel } from './components/WorkspacePanel'
import { RunsPanel } from './components/RunsPanel'
import { SectionView } from './components/SectionView'
import { AttachmentPanel } from './components/AttachmentPanel'
import { ConnectorPanel } from './components/ConnectorPanel'
import { EscalationPrompt } from './components/EscalationPrompt'
import { SearchPanel } from './components/SearchPanel'
import { NotificationsPanel } from './components/NotificationsPanel'
import { AddContextButton } from './components/AddContextButton'
import { useAgents, useCapabilities, useMe, useProviders, useSessions, useServerEvents } from './api'
import { estimateTokens } from '../contract/index.ts'
import { useSessionWorkspace } from './controller/useSessionWorkspace'
import { useLayout } from './controller/useLayout'
import { RelationsProvider, useRelations } from './controller/useRelations'
import { railWidthCss, useViewport } from './lib/viewport'
import { pickedModel, pickedProvider, type ModelPick } from './lib/models'
import { FocusContext } from './lib/focusContext'
import { SCRIM_CLASS } from './lib/scrim'
import { SECTION_META } from './lib/sections'
import type { Live } from './data/liveSession'
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
    pendingFocus,
    live,
    typing,
    focus,
    activeSession,
    isDraft,
    busy,
    liveTurn,
    interrupted,
    sendFailure,
    pendingApproval,
    bottomRef,
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

  // The delegated-cognition affordances (docs/delegated-cognition-provider.md):
  // resolve a session's driver → provider kind (the client mirror of the server's
  // resolution — an unset agentId means the seeded default Agent). Feeds the
  // "Waiting on your session…" state (§7.8 — a relayed reply arrives whole, so the
  // UI says who it's waiting on instead of faking a token stream).
  const agents = useAgents().data ?? []
  const providers = useProviders().data ?? []
  // A session's provider resolves the way the server routes the turn: the session's
  // own model pick (`providerId` — the composer selector) wins, else its Agent's.
  const sessionProviderKind = useCallback(
    (session?: { agentId?: string; providerId?: string }) => {
      const agent = agents.find((a) => a.id === (session?.agentId ?? 'agent-default'))
      const providerId = session?.providerId ?? agent?.providerId
      return providers.find((p) => p.id === providerId)?.kind
    },
    [agents, providers],
  )
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
  const onRelay = sessionProviderKind({ agentId: activeRow.agentId, providerId: activePick.providerId }) === 'session'

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

  // The live size of the open thread's Messages — so the composer's usage gauge
  // (and its context breakdown) fills in real time as the conversation grows.
  // The fixed config categories are added by the breakdown.
  const messageTokens = useMemo(
    () => live.messages.reduce((n, m) => n + estimateTokens(m.content), 0),
    [live.messages],
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
  // meaning depends on the section: a project to expand, a schedule to open, or —
  // under agents — a workspace display name whose public profile to show (D21).
  const navigateToSection = useCallback(
    (section: SectionId, id?: string, subId?: string) =>
      section === 'projects' && id && subId
        ? openWorkItemPage(id, subId) // a work item's page under its project (D19/D23)
        : section === 'projects' && id
          ? openProject(id)
          : section === 'scheduled' && id
            ? openSchedule(id)
            : section === 'agents' && id
              ? openOwner(id)
              : openSection(section),
    [openProject, openWorkItemPage, openSchedule, openOwner, openSection],
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
                onSelect={withRailClose(selectSession)}
                onNewSession={withRailClose(() => newSession())}
                // Section / sub-view handlers stay UNwrapped: the rail decides when to
                // close the narrow drawer (a leaf navigates → close; drilling into a
                // section's sub-menu keeps it open), via onLeafNavigate below.
                onOpenSection={openSection}
                onOpenSubview={openSubview}
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
                  onBack={goBack}
                  backTo={backTo}
                  railCollapsed={!leftOpen && !railOverlay}
                  focusProjectId={focusProjectId}
                  focusScheduleId={focusScheduleId}
                  focusOwnerName={focusOwnerName}
                  focusWorkItemId={focusWorkItemId}
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
                    <div className="flex-1 overflow-y-auto">
                      {live.messages.length === 0 && !typing ? (
                        <EmptyState
                          mode={isDraft ? 'draft' : 'empty'}
                          live={live}
                          onNewSessionWith={newSessionWith}
                        />
                      ) : (
                        <div className={!leftOpen && !railOverlay && isDraft ? 'pb-4 pt-14' : 'py-4'}>
                          {live.messages.map((m) => (
                            <MessageRow key={m.id} message={m} sessionId={activeId} />
                          ))}
                          <AnimatePresence>
                            {typing && <TypingRow waitingOn={onRelay ? 'Waiting on your session…' : undefined} />}
                          </AnimatePresence>
                          {/* Claude asks before it escalates: this consent prompt
                              gates attaching a workspace / repo (see the controller). */}
                          {pendingApproval && (
                            <EscalationPrompt
                              key={pendingApproval.kind}
                              kind={pendingApproval.kind}
                              rootChoices={
                                pendingApproval.kind === 'workspace'
                                  ? pendingApproval.rootChoices
                                  : undefined
                              }
                              connectorLabel={
                                pendingApproval.kind === 'repo'
                                  ? pendingApproval.connectorLabel
                                  : undefined
                              }
                              projectName={
                                pendingApproval.kind === 'project'
                                  ? pendingApproval.projectName
                                  : undefined
                              }
                              onApprove={approveEscalation}
                            />
                          )}
                          <div ref={bottomRef} />
                        </div>
                      )}
                    </div>

                    {/* Compaction (P5): offered once the open thread is long enough to be
                        worth compacting; hides itself after (the thread is short again). Only
                        a persisted, real session — a draft has nothing durable to archive —
                        and only BETWEEN turns: compacting mid-stream would swap out live.messages
                        and drop the still-streaming reply, so gate on !busy && !typing. */}
                    {!isDraft && !busy && !typing && live.messages.length > 6 && (
                      <CompactionAffordance onCompact={compact} />
                    )}

                    {/* Live-turn affordances (multi-account §6.5): the deliberate stop
                        while a turn streams; the fresh-send retry when a thread's last
                        word is the user's with nothing generating (an orphaned turn). */}
                    {busy && liveTurn && liveTurn.sessionId === activeId && (
                      <TurnControls mode="streaming" onStop={stopTurn} onRetry={retryInterrupted} />
                    )}
                    {interrupted && (
                      <TurnControls mode="interrupted" reason={sendFailure} onStop={stopTurn} onRetry={retryInterrupted} />
                    )}

                    <Composer
                      sessionId={activeId}
                      modelPick={activePick}
                      onSelectModel={modelPickWritable ? selectModel : undefined}
                      usageModel={draftModelRef}
                      messageTokens={messageTokens}
                      workspaces={live.workspaces}
                      repos={live.repos}
                      connectors={live.connectors}
                      attachments={live.attachments}
                      focus={focus}
                      disabled={busy}
                      disabledLabel={onRelay ? 'Waiting on your session…' : undefined}
                      onSend={handleSend}
                      onAddContext={handleAddContext}
                      onOpenContext={focusContext}
                      onRemoveContexts={removeContexts}
                      onRemoveFolder={removeFolder}
                    />
                  </section>

                  {/* Below a wide window the panel overlays the thread as a drawer (FWD-3):
                      a scrim dims + dismisses the conversation behind it, and the panel
                      group is positioned absolutely so it doesn't squeeze the thread. On
                      narrow the panel takes over the whole thread area (no scrim — nothing
                      shows beside it; its close button dismisses). On a wide window the
                      wrapper is a layout-neutral `flex shrink-0` group, keeping the panels
                      as in-flow flex siblings of the thread (the original side-by-side
                      layout) — each PanelShell is already `shrink-0` with its own width,
                      so the extra wrapper changes nothing visually. */}
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
                      !panelOverlay
                        ? 'flex shrink-0'
                        : railOverlay
                          ? // The takeover wrapper spans the whole thread even when no
                            // panel is open (it must stay mounted for exit animations),
                            // so it must not eat the thread's taps while empty.
                            `absolute inset-0 z-30 flex ${panelOpen ? '' : 'pointer-events-none'}`
                          : 'absolute inset-y-0 right-0 z-30 flex'
                    }
                  >
                  {/* One focused-context sidebar at a time, chosen by the active chip.
                      One keyed WorkspacePanel serves both workspace and repo so the
                      body morphs when you switch between the two. */}
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

                  {/* A scheduled-run session's run switcher — its default right
                      panel. Yields to a focused-context panel (so a chip click
                      still works) and can be dismissed per session. */}
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
                </div>
              </>
            )}
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

/** The session title bar's home-project breadcrumb — reads the *live* relation
 *  graph (so an AI "file this session" edit updates it immediately) rather than
 *  the static seed. Lives below the provider so it can call useRelations. */
function SessionTitleBar({
  session,
  leftOpen,
  leading,
  onOpenProject,
  onOpenSchedule,
}: {
  session: Session
  leftOpen: boolean
  /** Narrow tier: the in-flow rail toggle, rendered at the bar's left. */
  leading?: React.ReactNode
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
      className={`flex min-h-[52px] items-center gap-1.5 border-b border-line bg-canvas/80 py-2 pr-4 ${
        leading ? 'pl-2' : leftOpen ? 'pl-4' : 'pl-14'
      }`}
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
