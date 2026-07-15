/** ── The ONE conversation surface (universal split — homogeneous panes) ──────
 *  The fully-fledged view of a conversation: the thread (messages, typing,
 *  consent prompt), the between-turn affordances (compaction, stop/retry), and
 *  the FULL composer — context chips, add-context pickers, model picker, usage
 *  gauge. Extracted from App so the primary surface and every split pane mount
 *  the SAME component (two panes on one session are two views in sync with the
 *  same keyed model — src/controller/conversationStore.ts); only the COMMANDS
 *  differ per host (the primary's send materializes drafts, a pane's routes
 *  straight to the store), so they arrive as props while everything derivable
 *  from the session itself (the relay wait state, the live token count) is
 *  computed here, once.
 *
 *  MVC per pane: model = the keyed conversation entry + the shared api hooks;
 *  view = this component; controller = the thin adapter supplying the command
 *  props (App for the primary, ConversationPane for a split pane). */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Composer } from './Composer'
import { MessageRow, TypingRow } from './Message'
import { CompactionAffordance } from './CompactionAffordance'
import { TurnControls } from './TurnControls'
import { EscalationPrompt } from './EscalationPrompt'
import { estimateTokens } from '../../contract/index.ts'
import { useAgents, useProviders, useSessions } from '../api'
import type { approvalView, Live } from '../data/liveSession'
import type { ModelPick } from '../lib/models'
import type { AddedContext, PanelFocus, UsageModelRef } from '../types'

const RELAY_WAIT = 'Waiting on your session…'

export function ConversationView({
  sessionId,
  draft = false,
  live,
  typing,
  busy,
  streaming,
  sendFailure,
  pendingApproval,
  onApprove,
  onSend,
  onStop,
  onRetry,
  onCompact,
  modelPick,
  onSelectModel,
  usageModel,
  focus = null,
  onAddContext,
  onOpenContext,
  onRemoveContexts,
  onRemoveFolder,
  empty,
  threadPadClass = 'py-4',
}: {
  sessionId: string
  /** An unsent draft — no compaction, no interrupted-retry (nothing persisted). */
  draft?: boolean
  live: Live
  typing: boolean
  busy: boolean
  /** A turn is streaming into THIS view right now (the stop affordance). */
  streaming: boolean
  sendFailure: string | null
  /** The held escalation, already projected for display (the one consent
   *  funnel — data/liveSession's approvalView). */
  pendingApproval: ReturnType<typeof approvalView> | null
  onApprove: (workspaceRoot?: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onRetry: () => void
  /** Absent = not compactable (a draft, or a host that can't persist). */
  onCompact?: () => Promise<void>
  modelPick?: ModelPick
  onSelectModel?: (pick: ModelPick) => void
  /** The DRAFT's client-resolved cognition for the usage gauge (no server row). */
  usageModel?: UsageModelRef & { windowTokens?: number }
  /** The open right-panel focus (primary only — highlights the active chip). */
  focus?: PanelFocus | null
  onAddContext: (ctx: AddedContext) => void
  onOpenContext: (focus: PanelFocus) => void
  onRemoveContexts: (focuses: PanelFocus[]) => void
  onRemoveFolder?: (sourceId: string) => void
  /** What to show when the thread has no messages (the primary's EmptyState;
   *  panes default to nothing special — the composer invites the first turn). */
  empty?: ReactNode
  /** The thread's vertical padding (the primary's draft indent quirk). */
  threadPadClass?: string
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [live.messages, typing, pendingApproval])

  // The relay wait state, derived once for every host: the session's turn routes
  // session pick → Agent's provider → default; a `kind:'session'` provider means
  // the reply comes from the user's own delegated session (§7.8 — say who we're
  // waiting on instead of faking a token stream).
  const row = (useSessions().data ?? []).find((s) => s.id === sessionId)
  const agents = useAgents().data ?? []
  const providers = useProviders().data ?? []
  const agent = agents.find((a) => a.id === (row?.agentId ?? 'agent-default'))
  const providerId = modelPick?.providerId ?? row?.providerId ?? agent?.providerId
  const onRelay = providers.find((p) => p.id === providerId)?.kind === 'session'

  // Live token count of the thread, so the usage gauge fills as it grows.
  const messageTokens = useMemo(
    () => live.messages.reduce((n, m) => n + estimateTokens(m.content), 0),
    [live.messages],
  )

  // An orphaned turn: the thread's last word is the user's with nothing
  // generating — offer the fresh-send retry (multi-account §6.5).
  const interrupted =
    !busy && !typing && !draft && live.messages.length > 0 && live.messages[live.messages.length - 1].role === 'user'

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {live.messages.length === 0 && !typing && empty !== undefined ? (
          empty
        ) : (
          <div className={threadPadClass}>
            {live.messages.map((m) => (
              <MessageRow key={m.id} message={m} sessionId={sessionId} />
            ))}
            <AnimatePresence>
              {typing && <TypingRow waitingOn={onRelay ? RELAY_WAIT : undefined} />}
            </AnimatePresence>
            {/* Claude asks before it escalates: this consent prompt gates
                attaching a workspace / repo / project (the one apply funnel). */}
            {pendingApproval && (
              <EscalationPrompt
                key={pendingApproval.kind}
                kind={pendingApproval.kind}
                rootChoices={pendingApproval.kind === 'workspace' ? pendingApproval.rootChoices : undefined}
                connectorLabel={pendingApproval.kind === 'repo' ? pendingApproval.connectorLabel : undefined}
                projectName={pendingApproval.kind === 'project' ? pendingApproval.projectName : undefined}
                onApprove={onApprove}
              />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Compaction (P5): offered once the thread is long enough to be worth
          compacting, and only BETWEEN turns (compacting mid-stream would swap
          out live.messages and drop the still-streaming reply). */}
      {onCompact && !draft && !busy && !typing && live.messages.length > 6 && (
        <CompactionAffordance onCompact={onCompact} />
      )}

      {/* Live-turn affordances (multi-account §6.5): the deliberate stop while a
          turn streams; the fresh-send retry on an orphaned turn. */}
      {streaming && <TurnControls mode="streaming" onStop={onStop} onRetry={onRetry} />}
      {interrupted && <TurnControls mode="interrupted" reason={sendFailure} onStop={onStop} onRetry={onRetry} />}

      <Composer
        sessionId={sessionId}
        modelPick={modelPick}
        onSelectModel={onSelectModel}
        usageModel={usageModel}
        messageTokens={messageTokens}
        workspaces={live.workspaces}
        repos={live.repos}
        connectors={live.connectors}
        attachments={live.attachments}
        focus={focus}
        disabled={busy}
        disabledLabel={onRelay ? RELAY_WAIT : undefined}
        onSend={onSend}
        onAddContext={onAddContext}
        onOpenContext={onOpenContext}
        onRemoveContexts={onRemoveContexts}
        onRemoveFolder={onRemoveFolder}
      />
    </>
  )
}
