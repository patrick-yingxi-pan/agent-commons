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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Composer } from './Composer'
import { MessageRow, TypingRow } from './Message'
import { Spinner } from './Spinner'
import { TurnControls } from './TurnControls'
import { ContextMutationNotice } from './ContextMutationNotice'
import { DeferredEscalationPrompt } from './DeferredEscalationPrompt'
import { DEFAULT_PROVIDER_ID, estimateTokens } from '../../contract/index.ts'
import { useAgents, useMe, useProviders, useSessions } from '../api'
import { MESSAGE_PAGE_SIZE } from '../api/sessionPaging'
import { usePendingFocus } from '../lib/focusContext'
import { messageWindow } from '../lib/messageWindow'
import type { approvalView, Live } from '../data/liveSession'
import type { ModelPick } from '../lib/models'
import type { AddedContext, PanelFocus, UsageModelRef } from '../types'
import { isContextMutationHeld, type ContextMutationStatus, type StopRequestState } from '../controller/conversationCore'
import {
  isSessionCompactionHeld,
  useSessionCompactionStatus,
} from '../controller/sessionCompactionMutations'
import { composerExecutionState, type ComposerExecutionState } from '../lib/modelExecution'

const RELAY_WAIT = 'Waiting on your session…'
const CompactionAffordance = lazy(() => import('./CompactionAffordance').then((module) => ({ default: module.CompactionAffordance })))

export function ConversationView({
  sessionId,
  onOpenSession,
  draft = false,
  live,
  composerText,
  onComposerTextChange,
  typing,
  busy,
  streaming,
  sendFailure,
  stopRequest,
  canControlTurn,
  turnControlPending = false,
  canRetry = false,
  contextMutation,
  pendingApproval,
  history,
  onLoadEarlier,
  onApprove,
  onSend,
  onStop,
  onRetry,
  onRetryContext,
  canCompact = false,
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
  /** Open a session in this pane — a forked continuation lands here. */
  onOpenSession?: (id: string) => void
  /** An unsent draft — no compaction; a failed first send may still retry the
   *  materialization funnel without duplicating its optimistic user row. */
  draft?: boolean
  live: Live
  composerText: string
  onComposerTextChange: (value: string) => void
  typing: boolean
  busy: boolean
  /** A turn is streaming into THIS view right now (the stop affordance). */
  streaming: boolean
  sendFailure: string | null
  stopRequest?: StopRequestState | null
  canControlTurn: boolean
  turnControlPending?: boolean
  /** This client retained the failed logical send (including its key). A
   *  server-owned orphan after reload is derived from the final user row. */
  canRetry?: boolean
  /** The serialized binding+workspace transaction state. */
  contextMutation: ContextMutationStatus
  /** The held escalation, already projected for display (the one consent
   *  funnel — data/liveSession's approvalView). */
  pendingApproval: ReturnType<typeof approvalView> | null
  /** Cursor state for the still-unloaded prefix. Undefined cursor means a draft
   *  or a legacy full read; null means the beginning has been reached. */
  history?: { olderCursor?: string | null; olderTokens: number; loading: boolean; error: string | null }
  onLoadEarlier?: () => Promise<string | null>
  onApprove: (workspaceRoot?: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onRetry: () => void
  onRetryContext: () => void
  /** Owner-backed persisted conversation; shared readers and drafts cannot compact. */
  canCompact?: boolean
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
  const tenantId = useMe().data?.tenant.id
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didMount = useRef(false)
  const forceBottom = useRef(false)
  const [windowAnchor, setWindowAnchor] = useState<string | null>(null)
  useEffect(() => setWindowAnchor(null), [sessionId])
  // A door that landed on a TURN (SOCIAL-6b) beats open-at-the-bottom: you were
  // brought here to see one message, so the thread must not yank past it. The
  // target row's own `useFocusFlash` does the scrolling; this only stands the
  // default landing down. Read at RENDER — `useFocusFlash` consumes the target
  // in a child effect, which runs before this parent one.
  const focusedTurn = usePendingFocus().pending?.messageId
  const window = useMemo(
    () => messageWindow(live.messages, windowAnchor, MESSAGE_PAGE_SIZE),
    [live.messages, windowAnchor],
  )
  const anchorExists = windowAnchor !== null && live.messages.some((message) => message.id === windowAnchor)
  const atLatest = windowAnchor === null || !anchorExists

  // A turn door may target history older than the initial tail. Walk opaque
  // pages until its row exists, then hold the bounded window around that row so
  // the row's existing focus-flash effect can perform the final scroll.
  useEffect(() => {
    if (!focusedTurn) return
    const index = live.messages.findIndex((message) => message.id === focusedTurn)
    if (index >= 0) {
      const visible = index >= window.start && index < window.start + window.items.length
      if (!visible) {
        const start = Math.min(index, Math.max(0, live.messages.length - MESSAGE_PAGE_SIZE))
        setWindowAnchor(live.messages[start]?.id ?? null)
      }
      return
    }
    if (history?.olderCursor && !history.loading && !history.error && onLoadEarlier) void onLoadEarlier()
  }, [focusedTurn, history?.olderCursor, history?.loading, history?.error, live.messages, onLoadEarlier, window])

  const showEarlier = useCallback(async () => {
    if (window.hiddenEarlier > 0) {
      const start = Math.max(0, window.start - MESSAGE_PAGE_SIZE)
      setWindowAnchor(live.messages[start]?.id ?? null)
      return
    }
    if (history?.olderCursor && onLoadEarlier) {
      const firstId = await onLoadEarlier()
      if (firstId) setWindowAnchor(firstId)
    }
  }, [history?.olderCursor, live.messages, onLoadEarlier, window.hiddenEarlier, window.start])

  const showNewer = useCallback(() => {
    const latestStart = Math.max(0, live.messages.length - MESSAGE_PAGE_SIZE)
    const start = Math.min(latestStart, window.start + MESSAGE_PAGE_SIZE)
    if (start >= latestStart) forceBottom.current = true
    setWindowAnchor(start >= latestStart ? null : (live.messages[start]?.id ?? null))
  }, [live.messages, window.start])

  const jumpLatest = useCallback(() => {
    forceBottom.current = true
    setWindowAnchor(null)
  }, [])

  const sendAtLatest = useCallback((text: string) => {
    forceBottom.current = true
    setWindowAnchor(null)
    onSend(text)
  }, [onSend])
  useEffect(() => {
    // On FIRST render, always jump to the newest content (open the thread at the
    // bottom, as before). After that, auto-scroll only when the viewport is already
    // near the bottom — so a user who scrolled UP to re-read earlier messages isn't
    // yanked back down on every streamed chunk; when they're following along, keep
    // pinning to the bottom.
    // …unless a door landed on a TURN. Scoped to the FIRST paint deliberately:
    // if the target row never mounts (its turn was compacted away, say) nothing
    // consumes the target, and an unscoped skip would leave this pane's
    // auto-scroll dead for as long as the stale target lived.
    if (focusedTurn && !didMount.current) {
      didMount.current = true
      return
    }
    if (!atLatest) return
    if (forceBottom.current) {
      forceBottom.current = false
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      didMount.current = true
      return
    }
    const el = scrollRef.current
    if (didMount.current && el) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      if (!nearBottom) return
    }
    // Instant on first paint (open AT the bottom, no animation to chase); smooth
    // for subsequent streamed updates.
    bottomRef.current?.scrollIntoView({ behavior: didMount.current ? 'smooth' : 'auto', block: 'end' })
    didMount.current = true
  }, [window.items, typing, pendingApproval, focusedTurn, atLatest])

  // The relay wait state, derived once for every host: the session's turn routes
  // session pick → Agent's provider → default; a `kind:'session'` provider means
  // the reply comes from the user's own delegated session (§7.8 — say who we're
  // waiting on instead of faking a token stream).
  const row = (useSessions().data ?? []).find((s) => s.id === sessionId)
  const agents = useAgents().data ?? []
  const providersQ = useProviders()
  const providers = providersQ.data ?? []
  const agent = agents.find((a) => a.id === (row?.agentId ?? 'agent-default'))
  const providerId = modelPick?.providerId ?? row?.providerId ?? agent?.providerId ?? DEFAULT_PROVIDER_ID
  const provider = providers.find((p) => p.id === providerId)
  const onRelay = provider?.kind === 'session'
  const execution: ComposerExecutionState = composerExecutionState(
    provider?.execution,
    onRelay ? provider?.online === true : undefined,
    providersQ.data !== undefined && provider === undefined,
  )
  useSessionCompactionStatus()
  const compactionHeld = isSessionCompactionHeld(sessionId)

  // Live token count of the thread, so the usage gauge fills as it grows.
  const messageTokens = useMemo(
    () => (history?.olderTokens ?? 0) + live.messages.reduce((n, m) => n + estimateTokens(m.content), 0),
    [history?.olderTokens, live.messages],
  )

  // An orphaned turn: the thread's last word is the user's with nothing
  // generating — offer the one-logical-turn retry (multi-account §6.5).
  const interrupted =
    canControlTurn &&
    !busy &&
    !typing &&
    (canRetry || (!draft && live.messages.length > 0 && live.messages[live.messages.length - 1].role === 'user'))

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {live.messages.length === 0 && !typing && empty !== undefined ? (
          empty
        ) : (
          <div className={threadPadClass}>
            {(window.hiddenEarlier > 0 || !!history?.olderCursor || history?.error) && (
              <div className="mx-auto flex w-full max-w-3xl items-center justify-center px-4 pb-2">
                <button
                  type="button"
                  onClick={() => void showEarlier()}
                  disabled={history?.loading}
                  aria-label={window.hiddenEarlier > 0 ? 'Show earlier messages' : 'Load earlier messages'}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-60"
                >
                  {history?.loading ? <Spinner size={13} /> : <ChevronUp size={14} />}
                  {history?.loading
                    ? 'Loading earlier messages…'
                    : history?.error
                      ? window.hiddenEarlier === 0
                        ? 'Couldn’t load earlier messages · Retry'
                        : `${window.hiddenEarlier} earlier messages`
                      : window.hiddenEarlier > 0
                        ? `${window.hiddenEarlier} earlier messages`
                        : 'Load earlier messages'}
                </button>
              </div>
            )}
            {window.items.map((m) => (
              <MessageRow
                key={`${sessionId}:${m.id}`}
                message={m}
                sessionId={sessionId}
                tenantId={tenantId}
                onOpenSession={onOpenSession}
              />
            ))}
            <AnimatePresence>
              {typing && atLatest && <TypingRow waitingOn={onRelay ? RELAY_WAIT : undefined} />}
            </AnimatePresence>
            {/* Claude asks before it escalates: this consent prompt gates
                attaching a workspace / repo / project (the one apply funnel). */}
            {pendingApproval && atLatest && (
              <DeferredEscalationPrompt
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

      {/* When reading an older window, the return path stays in persistent
          conversation chrome — never after forty rows the user would have to
          scroll through just to get back to the live edge. */}
      {window.hiddenNewer > 0 && (
        <div data-history-edge className="flex shrink-0 items-center justify-center gap-1 bg-canvas px-2 py-1">
          <button
            type="button"
            onClick={showNewer}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2 hover:text-ink"
          >
            <ChevronDown size={14} />
            {window.hiddenNewer} newer messages
          </button>
          <button
            type="button"
            onClick={jumpLatest}
            className="min-h-8 rounded-lg px-3 text-[12px] font-medium text-accent-strong transition hover:bg-accent-tint"
          >
            Jump to latest
          </button>
        </div>
      )}

      {/* Compaction (P5): offered once the thread is long enough to be worth
          compacting, and only BETWEEN turns (compacting mid-stream would swap
          out live.messages and drop the still-streaming reply). */}
      {(compactionHeld || (canCompact && atLatest && !draft && !busy && !typing && live.messages.length > 6)) && (
        <Suspense fallback={null}>
          <CompactionAffordance sessionId={sessionId} tenantId={tenantId} />
        </Suspense>
      )}

      {/* Live-turn affordances (multi-account §6.5): the deliberate stop while a
          turn streams; the in-place retry on an orphaned turn. */}
      {streaming && <TurnControls mode="streaming" stopRequest={stopRequest} canStop={canControlTurn} onStop={onStop} onRetry={onRetry} />}
      {interrupted && <TurnControls mode="interrupted" reason={sendFailure} onStop={onStop} onRetry={onRetry} />}
      <ContextMutationNotice state={contextMutation} onRetry={onRetryContext} />

      <Composer
        value={composerText}
        onValueChange={onComposerTextChange}
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
        disabled={!canControlTurn || busy || compactionHeld || execution.blocked || isContextMutationHeld(contextMutation)}
        disabledLabel={
          !canControlTurn
            ? turnControlPending ? 'Loading conversation…' : 'Only the conversation owner can send messages.'
            : contextMutation.busy
            ? 'Updating context…'
            : contextMutation.error
              ? 'Retry the context update before sending.'
              : execution.blocked
                ? execution.placeholder
                : onRelay
                  ? RELAY_WAIT
                  : undefined
        }
        executionState={execution}
        onSend={sendAtLatest}
        onAddContext={onAddContext}
        onOpenContext={onOpenContext}
        onRemoveContexts={onRemoveContexts}
        onRemoveFolder={onRemoveFolder}
      />
    </>
  )
}
