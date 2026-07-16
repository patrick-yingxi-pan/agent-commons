/** ── The overlay tiers' docked context panel (ADAPT-11, universal split P6) ──
 *  On medium/narrow the tree can't tile, so the FOCUSED conversation's context
 *  panel docks OVER the thread (medium: a right drawer behind a scrim; narrow:
 *  a full takeover with its own close). Keyed on the focused pane's session
 *  and its STORE-held focus — no singleton state: the same per-session `focus`
 *  the wide tier projects as a context pane, read through the same funnels a
 *  ConversationPane uses (one mapping, no fork). */
import { AnimatePresence } from 'framer-motion'
import { conversations, useConversation } from '../controller/conversationStore'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { useSessions } from '../api'
import { setPanelPref } from '../lib/panelPrefs'
import { SCRIM_CLASS } from '../lib/scrim'
import { DRAFT_ID } from '../data/liveSession'
import { WorkspacePanel } from './WorkspacePanel'
import { RunsPanel } from './RunsPanel'
import { ConnectorPanel } from './ConnectorPanel'
import { AttachmentPanel } from './AttachmentPanel'

export function OverlayPanelDock({
  sessionId,
  tier,
  runsPanelOpen,
  onCloseRuns,
  onSelectRun,
  onOpenRoutine,
}: {
  /** The focused pane's session (null = a section/panel pane is focused — no dock). */
  sessionId: string | null
  tier: 'medium' | 'narrow'
  runsPanelOpen: boolean
  onCloseRuns: () => void
  onSelectRun: (sessionId: string) => void
  onOpenRoutine: (taskId: string) => void
}) {
  if (!sessionId) return null
  return (
    <Dock
      sessionId={sessionId}
      tier={tier}
      runsPanelOpen={runsPanelOpen}
      onCloseRuns={onCloseRuns}
      onSelectRun={onSelectRun}
      onOpenRoutine={onOpenRoutine}
    />
  )
}

function Dock({
  sessionId,
  tier,
  runsPanelOpen,
  onCloseRuns,
  onSelectRun,
  onOpenRoutine,
}: {
  sessionId: string
  tier: 'medium' | 'narrow'
  runsPanelOpen: boolean
  onCloseRuns: () => void
  onSelectRun: (sessionId: string) => void
  onOpenRoutine: (taskId: string) => void
}) {
  const { live, focus } = useConversation(sessionId)
  const row = (useSessions().data ?? []).find((s) => s.id === sessionId)
  const { removeContexts, removeFolder } = useSessionContextCommands(sessionId)

  const closePanel = () => {
    // Clear the driver; remember the closed state (FWD-2) on real sessions.
    conversations.setFocus(sessionId, null)
    if (sessionId !== DRAFT_ID) setPanelPref(sessionId, null)
  }

  const focusedWorkspace = focus?.kind === 'workspace' ? live.workspaces.find((w) => w.id === focus.id) : undefined
  const focusedRepo = focus?.kind === 'repo' ? live.repos.find((r) => r.id === focus.id) : undefined
  const focusedConnector = focus?.kind === 'connector' ? live.connectors.find((c) => c.id === focus.id) : undefined
  const isRunSession = !!row?.scheduledRunOf
  const panelOpen = !!focus || (isRunSession && runsPanelOpen)

  return (
    <>
      {tier === 'medium' && panelOpen && (
        <div
          className={`${SCRIM_CLASS} z-20`}
          aria-hidden
          onClick={() => {
            closePanel()
            onCloseRuns()
          }}
        />
      )}
      <div
        className={
          tier === 'narrow'
            ? // Spans the whole thread even when no panel is open (kept
              // mounted for exit animations) — must not eat taps while empty.
              `absolute inset-0 z-30 flex ${panelOpen ? '' : 'pointer-events-none'}`
            : 'absolute inset-y-0 right-0 z-30 flex'
        }
      >
        {/* One focused-context sidebar at a time, chosen by the active chip.
            One keyed WorkspacePanel serves both workspace and repo so the body
            morphs when you switch between the two. */}
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
          {isRunSession && !focus && runsPanelOpen && row?.scheduledRunOf && (
            <RunsPanel
              key="runs"
              taskId={row.scheduledRunOf.taskId}
              activeRunSessionId={sessionId}
              onSelectRun={onSelectRun}
              onOpenRoutine={onOpenRoutine}
              onClose={onCloseRuns}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {focusedConnector && (
            <ConnectorPanel
              key="conn"
              connector={focusedConnector}
              onClose={closePanel}
              onDisconnect={() => removeContexts([{ kind: 'connector', id: focusedConnector.id }])}
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
              onRemove={(id) => removeContexts([{ kind: focus.kind, id }])}
            />
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
