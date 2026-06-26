import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { CalendarClock, Folder, PanelLeft } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Composer } from './components/Composer'
import { MessageRow, TypingRow } from './components/Message'
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
import { useSessions, useServerEvents } from './api'
import { useSessionWorkspace } from './controller/useSessionWorkspace'
import { useLayout } from './controller/useLayout'
import { RelationsProvider, useRelations } from './controller/useRelations'
import type { Connector, SectionId, Session } from './types'

/** The View: composes the product chrome from two controllers — the session +
 *  its live workspace, and the rail layout — holding only local view chrome
 *  (the intro overlay and the search palette toggle). All business logic lives
 *  in the controllers (controller/) and the model (data/). */
export default function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [showIntro, setShowIntro] = useState(true)
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
    totalSteps,
    pendingApproval,
    bottomRef,
    focusedWorkspace,
    focusedRepo,
    focusedConnector,
    selectSession,
    newSession,
    openSection,
    openProject,
    openSchedule,
    pinSession,
    renameSession,
    archiveSession,
    deleteSession,
    handleSend,
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

  const { leftOpen, leftW, leftDragging, toggleLeft, openLeft, startResize, resize, endResize } =
    useLayout()

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
  // meaning depends on the section: a project to expand, or a schedule to open.
  const navigateToSection = useCallback(
    (section: SectionId, id?: string) =>
      section === 'projects' && id
        ? openProject(id)
        : section === 'scheduled' && id
          ? openSchedule(id)
          : openSection(section),
    [openProject, openSchedule, openSection],
  )

  return (
    <RelationsProvider attachConnector={attachConnector} navigate={navigateToSection}>
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      {/* ===== Proposal framing — the description, kept outside the product mock.
              A dark band holding the concept label, "About this proposal", and
              the guided tour, so the product below can read like a real app. ===== */}
      <div className="shrink-0 bg-ink text-canvas">
        <ProposalBar onAbout={() => setShowIntro(true)} />
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
            onStart={startTour}
            onNext={nextStep}
            onRestart={startTour}
          />
        )}
      </div>

      {/* ===== The proposed product — no top bar; the rail owns its toggle ===== */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* When the rail is collapsed its own toggle hides with it, so a floating
            control re-opens it — in the same top-left spot the rail's toggle sits. */}
        {!leftOpen && (
          <button
            onClick={openLeft}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="absolute left-2.5 top-2.5 z-30 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft shadow-sm transition hover:bg-panel-2 hover:text-ink"
          >
            <PanelLeft size={18} />
          </button>
        )}

        <div className="flex min-h-0 flex-1">
          {/* Left rail: collapsible (width → 0) and drag-resizable. The inner div
              holds a fixed width so the content doesn't reflow while collapsing. */}
          <div
            className={`relative h-full shrink-0 overflow-hidden ${
              leftDragging ? '' : 'transition-[width] duration-200 ease-out'
            } ${leftOpen ? '' : 'pointer-events-none'}`}
            style={{ width: leftOpen ? leftW : 0 }}
          >
            <div style={{ width: leftW }} className="h-full">
              <Sidebar
                sessions={sessions}
                activeId={activeId}
                activeSection={activeSection}
                onSelect={selectSession}
                onNewSession={newSession}
                onOpenSection={openSection}
                onOpenSchedule={openSchedule}
                onPinSession={pinSession}
                onRenameSession={renameSession}
                onArchiveSession={archiveSession}
                onDeleteSession={deleteSession}
                onToggleCollapse={toggleLeft}
                onOpenSearch={() => setSearchOpen(true)}
                onResizeStart={startResize}
                onResize={resize}
                onResizeEnd={endResize}
              />
            </div>
          </div>

          <main className="flex min-w-0 flex-1 flex-col">
            {activeSection ? (
              <SectionView
                section={activeSection}
                onOpenSession={selectSession}
                onNewSession={newSession}
                railCollapsed={!leftOpen}
                initialProjectId={focusProjectId}
                initialScheduleId={focusScheduleId}
              />
            ) : (
              <>
                {!isDemo && !isDraft && (
                  <SessionTitleBar
                    session={activeSession}
                    leftOpen={leftOpen}
                    onOpenProject={openProject}
                    onOpenSchedule={openSchedule}
                  />
                )}

                <div className="flex min-h-0 flex-1">
                  <section className="flex min-w-0 flex-1 flex-col">
                    <div className="flex-1 overflow-y-auto">
                      {live.messages.length === 0 && !typing ? (
                        <EmptyState mode={isDemo ? 'demo' : isDraft ? 'draft' : 'empty'} />
                      ) : (
                        <div className={!leftOpen && (isDemo || isDraft) ? 'pb-4 pt-14' : 'py-4'}>
                          {live.messages.map((m) => (
                            <MessageRow key={m.id} message={m} />
                          ))}
                          <AnimatePresence>{typing && <TypingRow />}</AnimatePresence>
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

                    <Composer
                      workspaces={live.workspaces}
                      repos={live.repos}
                      connectors={live.connectors}
                      attachments={live.attachments}
                      focus={focus}
                      disabled={busy || (isDemo && phase === 'running')}
                      onSend={handleSend}
                      onAddContext={handleAddContext}
                      onOpenContext={focusContext}
                      onRemoveContexts={removeContexts}
                      onRemoveFolder={removeFolder}
                    />
                  </section>

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
              </>
            )}
          </main>
        </div>
      </div>

      {searchOpen && (
        <SearchPanel
          sessions={sessions}
          onSelectSession={selectSession}
          onOpenSection={openSection}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Rendered without AnimatePresence: framer-motion 11 + React 19 can leave
          an exited overlay in the DOM (an invisible, click-blocking backdrop).
          A plain conditional unmounts instantly; the entrance still animates. */}
      {showIntro && (
        <IntroOverlay
          onClose={() => setShowIntro(false)}
          onStartTour={() => {
            setShowIntro(false)
            startDemoTour()
          }}
        />
      )}
    </div>
    </RelationsProvider>
  )
}

/** The session title bar's home-project breadcrumb — reads the *live* relation
 *  graph (so an AI "file this session" edit updates it immediately) rather than
 *  the static seed. Lives below the provider so it can call useRelations. */
function SessionTitleBar({
  session,
  leftOpen,
  onOpenProject,
  onOpenSchedule,
}: {
  session: Session
  leftOpen: boolean
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
      className={`flex min-h-[52px] flex-col justify-center gap-0.5 border-b border-line bg-canvas/80 py-2 pr-4 ${
        leftOpen ? 'pl-4' : 'pl-14'
      }`}
    >
      <span className="font-serif text-[15px] font-semibold leading-tight text-ink">
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
  )
}

function EmptyState({ mode }: { mode: 'demo' | 'draft' | 'empty' }) {
  if (mode === 'draft') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <div className="font-serif text-xl font-semibold text-ink">What should we work on?</div>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Start typing below. Attach a folder, a repo, or a connector and this one session grows a
            workspace or a code panel as the work needs it — no tabs, no lost context.
          </p>
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
