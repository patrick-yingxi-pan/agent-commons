/** ── The overlay tiers' docked context panel (ADAPT-11, universal split P6) ──
 *  On medium/narrow the tree can't tile, so the FOCUSED conversation's context
 *  panel docks OVER the thread (medium: a right drawer behind a scrim; narrow:
 *  a full takeover with its own close). Keyed on the focused pane's session
 *  and its STORE-held focus — no singleton state: the same per-session `focus`
 *  the wide tier projects as a context pane, read through the same funnels a
 *  ConversationPane uses (one mapping, no fork). */
import { AnimatePresence } from 'framer-motion'
import { workspaceInputAttachments } from '../../contract/attachmentInput.ts'
import { conversations, useConversation } from '../controller/conversationStore'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { useContextWritable } from '../controller/useContextWritable'
import { dismissContextMutation, retryContextMutation } from '../controller/contextMutations'
import { isContextMutationHeld } from '../controller/conversationCore'
import { rememberPanelPreference } from '../controller/panelPreferences'
import { SCRIM_CLASS } from '../lib/scrim'
import { DRAFT_ID } from '../data/liveSession'
import { WorkspacePanel } from './WorkspacePanel'
import { ConnectorPanel } from './ConnectorPanel'
import { DeferredAttachmentPanel } from './DeferredAttachmentPanel'
import { ContextMutationNotice } from './ContextMutationNotice'

export function OverlayPanelDock({
  sessionId,
  tier,
}: {
  /** The focused pane's session (null = a section/panel pane is focused — no dock). */
  sessionId: string | null
  tier: 'medium' | 'narrow'
}) {
  if (!sessionId) return null
  return <Dock sessionId={sessionId} tier={tier} />
}

function Dock({ sessionId, tier }: { sessionId: string; tier: 'medium' | 'narrow' }) {
  const { live, focus, contextMutation } = useConversation(sessionId)
  const inputAttachments = workspaceInputAttachments(live)
  const writable = useContextWritable(sessionId)
  const { removeContexts, removeFolder } = useSessionContextCommands(sessionId)

  const closePanel = () => {
    // Clear the driver; remember the closed state (FWD-2) on real sessions.
    conversations.setFocus(sessionId, null)
    if (sessionId !== DRAFT_ID) rememberPanelPreference(sessionId, null)
  }

  const focusedWorkspace = focus?.kind === 'workspace' ? live.workspaces.find((w) => w.id === focus.id) : undefined
  const focusedRepo = focus?.kind === 'repo' ? live.repos.find((r) => r.id === focus.id) : undefined
  const focusedConnector = focus?.kind === 'connector' ? live.connectors.find((c) => c.id === focus.id) : undefined
  const panelOpen = !!focus

  return (
    <>
      {tier === 'medium' && panelOpen && (
        <div className={`${SCRIM_CLASS} z-20`} aria-hidden onClick={closePanel} />
      )}
      <div
        // The enumeration handle for the docked layer (docs/ui-invariants.md's
        // data-* stamp convention): on narrow this spans the whole thread, so a
        // review sweep needs to know whether it is currently EATING pointer
        // events before it reaches for anything underneath — including the rail
        // toggle. Presence isn't the question (it stays mounted while empty);
        // the stamp plus computed pointer-events is.
        data-overlay-dock={tier}
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
              inputAttachments={inputAttachments}
              repo={focusedRepo}
              onClose={closePanel}
              onRemoveFolder={writable ? removeFolder : undefined}
              refreshSessionId={writable ? sessionId : undefined}
              refreshDisabled={isContextMutationHeld(contextMutation)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {focusedConnector && (
            <ConnectorPanel
              key="conn"
              connector={focusedConnector}
              onClose={closePanel}
              onDisconnect={writable ? () => removeContexts([{ kind: 'connector', id: focusedConnector.id }]) : undefined}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(focus?.kind === 'file' || focus?.kind === 'photo') && (
            <DeferredAttachmentPanel
              key="att"
              kind={focus.kind}
              items={live.attachments.filter((a) => a.kind === focus.kind)}
              allAttachments={inputAttachments}
              initialId={focus.id}
              onClose={closePanel}
              onRemove={writable ? (id) => removeContexts([{ kind: focus.kind, id }]) : undefined}
              refreshSessionId={writable ? sessionId : undefined}
              refreshDisabled={isContextMutationHeld(contextMutation)}
            />
          )}
        </AnimatePresence>
        {panelOpen && (
          <ContextMutationNotice
            state={contextMutation}
            onRetry={() => retryContextMutation(sessionId)}
            onDismiss={() => dismissContextMutation(sessionId)}
            floating
          />
        )}
      </div>
    </>
  )
}
