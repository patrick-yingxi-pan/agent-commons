import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { CalendarClock, Folder, PanelLeft } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { AuthScreen } from './components/auth/AuthScreen'
import { useAuthScreen } from './controller/useAuthScreen'
import type { Capabilities, Identity } from '../contract/index.ts'
import { Composer } from './components/Composer'
import { MessageRow, TypingRow } from './components/Message'
import { CompactionAffordance } from './components/CompactionAffordance'
import { TurnControls } from './components/TurnControls'
import { CaptionBar } from './components/CaptionBar'
import { WorkspacePanel } from './components/WorkspacePanel'
import { RunsPanel } from './components/RunsPanel'
import { SectionView } from './components/SectionView'
import { AttachmentPanel } from './components/AttachmentPanel'
import { ConnectorPanel } from './components/ConnectorPanel'
import { IntroOverlay } from './components/IntroOverlay'
import { TourPermissionPrompt } from './components/TourPermissionPrompt'
import { ProposalBar } from './components/ProposalBar'
import { SearchPanel } from './components/SearchPanel'
import { NotificationsPanel } from './components/NotificationsPanel'
import { AddContextButton } from './components/AddContextButton'
import { useAgents, useCapabilities, useMe, useProviders, useSessions, useServerEvents } from './api'
import { DEFAULT_PROVIDER_ID, estimateTokens } from '../contract/index.ts'
import { useSessionWorkspace } from './controller/useSessionWorkspace'
import { useLayout } from './controller/useLayout'
import { RelationsProvider, useRelations } from './controller/useRelations'
import { railWidthCss, useViewport } from './lib/viewport'
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
  // Lifted ABOVE the surface switch: the intro must not replay every time the
  // auth screen swaps the workspace out and back (e.g. "Add account…" mid-session).
  const [showIntro, setShowIntro] = useState(true)
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
    return <AuthScreen view={authView ?? { kind: 'picker' }} gated={gated} />
  }
  return <Workspace showIntro={showIntro} onShowIntro={setShowIntro} />
}

/** The View: composes the product chrome from two controllers — the session +
 *  its live workspace, and the rail layout — holding only local view chrome
 *  (the intro overlay and the search palette toggle). All business logic lives
 *  in the controllers (controller/) and the model (data/). */
function Workspace({ showIntro, onShowIntro }: { showIntro: boolean; onShowIntro: (v: boolean) => void }) {
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
    focusProjectId,
    focusScheduleId,
    focusOwnerName,
    live,
    typing,
    focus,
    activeSession,
    isDemo,
    isDraft,
    phase,
    stepIndex,
    caption,
    busy,
    liveTurn,
    interrupted,
    sendFailure,
    totalSteps,
    pendingApproval,
    bottomRef,
    focusedWorkspace,
    focusedRepo,
    focusedConnector,
    selectSession,
    newSession,
    newSessionWith,
    openSection,
    openProject,
    openSchedule,
    openOwner,
    openWorkItem,
    openProposal,
    openAgent,
    goBack,
    backTo,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
    selectModelProvider,
    draftProviderId,
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
    startTour,
    nextStep,
    startDemoTour,
    approveEscalation,
  } = useSessionWorkspace()

  // The delegated-cognition affordances (docs/delegated-cognition-provider.md):
  // resolve a session's driver → provider kind (the client mirror of the server's
  // resolution — an unset agentId means the seeded default Agent). Feeds the
  // "Waiting on your session…" state (§7.8 — a relayed reply arrives whole, so the
  // UI says who it's waiting on instead of faking a token stream) and the tour
  // gate (§7.7 — the scripted tour depends on tool calls; forbid the playback,
  // not the binding).
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
  // switch lands there), falling back to the controller's local shell (drafts, run
  // sessions) — and, on a draft, the not-yet-persisted pick held by the controller.
  const activeRow = sessions.find((s) => s.id === activeId) ?? activeSession
  const activeProviderId = isDraft ? draftProviderId : activeRow.providerId
  // A model pick needs somewhere to live: a draft (held locally) or a real server
  // row (PATCHed). A synthesized run session has neither — the selector's
  // registered-models section is omitted there instead of silently no-oping.
  const modelPickWritable = isDraft || sessions.some((s) => s.id === activeId)
  const onRelay = sessionProviderKind({ agentId: activeRow.agentId, providerId: activeProviderId }) === 'session'
  const demoSession = sessions.find((s) => s.isDemo)
  // The scripted tour depends on the DEFAULT provider (its beats are the mock
  // model's fixed strings): any other resolved provider — a prose-only relay OR a
  // registered endpoint whose replies won't match the script — blocks playback
  // (§7.7: forbid the playback, not the binding).
  const demoAgent = agents.find((a) => a.id === (demoSession?.agentId ?? 'agent-default'))
  const demoProviderId = demoSession?.providerId ?? demoAgent?.providerId ?? DEFAULT_PROVIDER_ID
  const tourBlocked =
    demoProviderId !== DEFAULT_PROVIDER_ID
      ? sessionProviderKind(demoSession) === 'session'
        ? 'The tour can’t play: it depends on tool calls, and the demo runs on a prose-only Session provider. Pick the built-in model for it (the composer’s model selector) to play it.'
        : 'The tour can’t play: its scripted beats need the built-in model, and the demo is picked onto a registered provider. Pick the built-in model for it (the composer’s model selector) to play it.'
      : null
  const guardedStartTour = useCallback(() => {
    if (!tourBlocked) startTour()
  }, [tourBlocked, startTour])

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
  // (and its context breakdown) fills in real time as the conversation grows (the
  // tour's turns included). The fixed config categories are added by the breakdown.
  const messageTokens = useMemo(
    () => live.messages.reduce((n, m) => n + estimateTokens(m.content), 0),
    [live.messages],
  )

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
    (section: SectionId, id?: string) =>
      section === 'projects' && id
        ? openProject(id)
        : section === 'scheduled' && id
          ? openSchedule(id)
          : section === 'agents' && id
            ? openOwner(id)
            : openSection(section),
    [openProject, openSchedule, openOwner, openSection],
  )

  return (
    <RelationsProvider attachConnector={attachConnector} navigate={navigateToSection}>
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      {/* ===== Proposal framing — the description, kept outside the product mock.
              A dark band holding the concept label, "About this proposal", and
              the guided tour, so the product below can read like a real app. ===== */}
      <div className="shrink-0 bg-ink text-canvas">
        <ProposalBar onAbout={() => onShowIntro(true)} />
        {/* The caption bar normally hides when a section is open — but during the
            running tour the create-project beat sends the user to the project page,
            so keep it visible there so "Next" can bring them back. */}
        {isDemo && (!activeSection || phase === 'running') && (
          <CaptionBar
            phase={phase}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            caption={caption}
            busy={busy}
            blocked={tourBlocked}
            onStart={guardedStartTour}
            onNext={nextStep}
            onRestart={guardedStartTour}
          />
        )}
      </div>

      {/* ===== The proposed product — no top bar; the rail owns its toggle ===== */}
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
                onSelect={withRailClose(selectSession)}
                onNewSession={withRailClose(() => newSession())}
                onOpenSection={withRailClose(openSection)}
                onOpenSchedule={withRailClose(openSchedule)}
                onPinSession={pinSession}
                onRenameSession={renameSession}
                onArchiveSession={archiveSession}
                onDeleteSession={deleteSession}
                onToggleCollapse={toggleLeft}
                onOpenSearch={withRailClose(() => setSearchOpen(true))}
                onOpenNotifications={withRailClose(() => setNotifOpen(true))}
                resizable={!railOverlay}
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
            {/* Narrow tier: surfaces without their own title bar (sections, the
                demo, a draft) get a slim header row that HOUSES the rail toggle —
                in-flow, so content scrolls under nothing. Regular sessions embed
                the same toggle in their existing title bar instead. */}
            {railOverlay && (activeSection || isDemo || isDraft) && (
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
              <SectionView
                section={activeSection}
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
              />
            ) : (
              <>
                {!isDemo && !isDraft && (
                  <SessionTitleBar
                    session={activeSession}
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
                          mode={isDemo ? 'demo' : isDraft ? 'draft' : 'empty'}
                          live={live}
                          onNewSessionWith={newSessionWith}
                        />
                      ) : (
                        <div className={!leftOpen && !railOverlay && (isDemo || isDraft) ? 'pb-4 pt-14' : 'py-4'}>
                          {live.messages.map((m) => (
                            <MessageRow key={m.id} message={m} sessionId={activeId} />
                          ))}
                          <AnimatePresence>
                            {typing && <TypingRow waitingOn={onRelay ? 'Waiting on your session…' : undefined} />}
                          </AnimatePresence>
                          {/* The tour asks before it escalates: this consent prompt
                              gates attaching a workspace / repo (see the controller). */}
                          {pendingApproval && (
                            <TourPermissionPrompt
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
                        a persisted, real session — a draft/demo has nothing durable to archive —
                        and only BETWEEN turns: compacting mid-stream would swap out live.messages
                        and drop the still-streaming reply, so gate on !busy && !typing. */}
                    {!isDemo && !isDraft && !busy && !typing && live.messages.length > 6 && (
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
                      providerId={activeProviderId}
                      onSelectModelProvider={modelPickWritable ? selectModelProvider : undefined}
                      messageTokens={messageTokens}
                      workspaces={live.workspaces}
                      repos={live.repos}
                      connectors={live.connectors}
                      attachments={live.attachments}
                      focus={focus}
                      disabled={busy || (isDemo && phase === 'running')}
                      disabledLabel={
                        isDemo && phase === 'running'
                          ? 'Playing the tour…'
                          : onRelay
                            ? 'Waiting on your session…'
                            : undefined
                      }
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

      {/* Rendered without AnimatePresence: framer-motion 11 + React 19 can leave
          an exited overlay in the DOM (an invisible, click-blocking backdrop).
          A plain conditional unmounts instantly; the entrance still animates. */}
      {showIntro && (
        <IntroOverlay
          onClose={() => onShowIntro(false)}
          onStartTour={() => {
            onShowIntro(false)
            // Blocked playback (§7.7): still land on the demo session, where the
            // caption bar explains why the tour won't start and names the remedy.
            if (tourBlocked) selectSession(demoSession?.id ?? '')
            else startDemoTour()
          }}
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
 *  section page, the demo, a draft): rail toggle + where-am-I title. */
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
  mode: 'demo' | 'draft' | 'empty'
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
  if (mode === 'empty') {
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
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <div className="font-serif text-lg font-semibold text-ink">One place for everything</div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Start typing, or press <span className="font-semibold text-accent-strong">Play the tour</span>{' '}
          to watch a single session grow a workspace and a repo — no tabs, no lost context.
        </p>
      </div>
    </div>
  )
}
