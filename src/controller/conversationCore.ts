/** ── The per-session conversation store (universal split, Phase 1) ───────────
 *  docs/design/universal-split-workspace.md §2.2: the singleton controller's
 *  SESSION half — the live workspace state, the generation flags, the streaming
 *  turn pipeline, the held escalation — decomposed into a module-scoped store
 *  KEYED BY SESSION ID, so any number of panes can host conversations (each
 *  fully interactive, Phase 3) and two panes on one session share one state.
 *
 *  Pure and dependency-injected on purpose (the railPanes/splitFrame pattern):
 *  the transport (send / reattach / cancel — the src/api commands in the real
 *  wiring, a fake in node tests) is passed into the factory, so
 *  tests/conversation-store.test.ts locks the keyed isolation, the epoch
 *  staleness, and the draft-adoption move without a DOM or a fetch.
 *
 *  ── Epochs replace the old global runId ─────────────────────────────────────
 *  The singleton guarded streams with ONE runId + "is this still the active
 *  session" — so switching sessions dropped another session's still-arriving
 *  deltas on the floor. Here every session carries its own epoch: a stream
 *  captures the epoch at dispatch and keeps LANDING in its keyed entry however
 *  the user navigates (the multi-pane requirement); only a RESET of that same
 *  session (select-time reload, account switch) bumps the epoch and stales the
 *  stream — exactly when the server re-read supersedes it. Reconciles
 *  (`reconcile`) deliberately do NOT bump: the old code let a same-runId
 *  reconcile coexist with a live stream, and that behavior is preserved.
 *
 *  Sends serialize PER SESSION (the backend enforces one live turn per
 *  session); different sessions run concurrently — the singleton's one global
 *  chain serialized those too, a restriction no pane model can keep. */
import type { EscalationProposal, Message } from '../../contract/index'
import type { Live } from '../data/liveSession'
import type { PanelFocus } from '../types'

/** A held mid-turn escalation proposal — applies only on user approval. */
export interface PendingEscalation {
  messageId: string
  escalation: EscalationProposal
}

/** One session's conversation state — everything a pane needs to render a
 *  thread and its composer affordances. */
export interface ConversationState {
  live: Live
  typing: boolean
  busy: boolean
  /** The server-owned turn currently streaming into this client (stop handle). */
  liveTurn: { sessionId: string; turnId: string } | null
  /** The server's refusal copy for the last failed send (the pre-persist gates). */
  sendFailure: string | null
  pendingEscalation: PendingEscalation | null
  /** Which attached context this session's right panel is showing (null = closed).
   *  Per-session so EVERY pane derives its OWN context panel (universal split
   *  Phase 6) — remembered across reopen by `panelPrefs` (FWD-2). */
  focus: PanelFocus | null
  /** Whether this entry has reflected a SERVER read (`reconcile`) — the
   *  authority latch (the projection-latch rule's store face): a mirror-seeded
   *  live missing a runtime attach is a transient unknown, but once the server
   *  answered, an absence is definitive (the live-prune consumers gate on it).
   *  Reset clears it; adopt carries it with the entry. */
  reconciled: boolean
}

/** The streaming callbacks a turn dispatches — structurally the api layer's
 *  SendHandlers, redeclared here so the core stays free of api imports. */
export interface TurnHandlers {
  onStart?: (messageId: string, message: Message, turnId?: string) => void
  onDelta?: (messageId: string, text: string) => void
  onRelations?: (messageId: string, relationActions: NonNullable<Message['relationActions']>) => void
  onEscalation?: (messageId: string, escalation: EscalationProposal) => void
  onToolActivity?: (messageId: string, toolActivities: NonNullable<Message['toolActivities']>) => void
  onEnd?: (message: Message) => void
}

/** What the store needs from the outside world — the api commands in the app,
 *  a fake in tests. */
export interface ConversationTransport {
  sendMessage: (sessionId: string, text: string, handlers: TurnHandlers) => Promise<void>
  reattachTurn: (sessionId: string, turnId: string, fromSeq: number, handlers: TurnHandlers) => Promise<void>
  cancelTurn: (sessionId: string, turnId: string) => Promise<void>
  /** A turn settled (message.end) — the wiring refreshes the usage gauge. */
  onTurnSettled?: (sessionId: string) => void
}

export type ConversationStore = ReturnType<typeof createConversationStore>

export function createConversationStore(transport: ConversationTransport, empty: () => Live) {
  const states = new Map<string, ConversationState>()
  const listeners = new Map<string, Set<() => void>>()
  const epochs = new Map<string, number>()
  /** Per-session send chains — a rapid second send queues behind the first
   *  (the server's one-live-turn-per-session slot), never behind ANOTHER
   *  session's turn. */
  const chains = new Map<string, Promise<void>>()

  const blank = (): ConversationState => ({
    live: empty(),
    typing: false,
    busy: false,
    liveTurn: null,
    sendFailure: null,
    pendingEscalation: null,
    focus: null,
    reconciled: false,
  })

  /** The entry for a session, created blank on demand. The returned object is
   *  immutable — every mutation replaces it (useSyncExternalStore-friendly). */
  const get = (id: string): ConversationState => {
    let s = states.get(id)
    if (!s) {
      s = blank()
      states.set(id, s)
    }
    return s
  }

  const notify = (id: string) => {
    listeners.get(id)?.forEach((cb) => cb())
  }

  const subscribe = (id: string, cb: () => void): (() => void) => {
    let set = listeners.get(id)
    if (!set) {
      set = new Set()
      listeners.set(id, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) listeners.delete(id)
    }
  }

  const update = (id: string, fn: (s: ConversationState) => ConversationState): void => {
    const prev = get(id)
    const next = fn(prev)
    if (next === prev) return
    states.set(id, next)
    notify(id)
  }

  const patch = (id: string, p: Partial<ConversationState>): void => update(id, (s) => ({ ...s, ...p }))

  /** Set which context panel this session shows (null = closed) — per-session
   *  focus, read by every pane to derive its own context pane (Phase 6). */
  const setFocus = (id: string, focus: PanelFocus | null): void => patch(id, { focus })

  const setLive = (id: string, next: Live | ((l: Live) => Live)): void =>
    update(id, (s) => ({ ...s, live: typeof next === 'function' ? next(s.live) : next }))

  const epoch = (id: string): number => epochs.get(id) ?? 0
  const bump = (id: string): void => {
    epochs.set(id, epoch(id) + 1)
  }

  /** Select-time reset: a fresh entry seeded with `live`; every in-flight
   *  stream for this session goes stale (the server re-read supersedes it). */
  const reset = (id: string, live: Live): void => {
    bump(id)
    states.set(id, { ...blank(), live })
    notify(id)
  }

  /** A server reconcile: replace the live state WITHOUT staling in-flight
   *  streams — refused (false) when the entry was reset since `since`, so a
   *  slow read can't clobber a newer selection. */
  const reconcile = (id: string, since: number, live: Live): boolean => {
    if (epoch(id) !== since) return false
    update(id, (s) => ({ ...s, live, reconciled: true }))
    return true
  }

  /** Draft materialization: the draft entry (its optimistic user turn, its
   *  generation flags) MOVES under the real id; the draft slot goes blank and
   *  anything still aimed at it goes stale. The target's epoch is untouched —
   *  nothing has streamed under the new id yet. */
  const adopt = (from: string, to: string): void => {
    const s = states.get(from)
    // Nothing to move — including the BLANK entry a subscriber's lazy get()
    // recreates after a first adopt already moved the state (the coalesced
    // second send of one materialization must not clobber the real entry).
    // An open panel (`focus`) counts as state worth moving: a recreated blank
    // entry always has focus null, so the coalesce-skip is unaffected.
    if (!s || (s.live.messages.length === 0 && !s.busy && !s.typing && !s.pendingEscalation && !s.focus)) return
    bump(from)
    states.set(to, s)
    states.delete(from)
    notify(from)
    notify(to)
  }

  /** Hold an escalation proposal unless one is already held (the C28 resurface
   *  rule: a reconcile must not replace a prompt the user is looking at). */
  const holdEscalation = (id: string, held: PendingEscalation): void =>
    update(id, (s) => (s.pendingEscalation ? s : { ...s, pendingEscalation: held }))

  /** Account switch: drop every conversation — they're another tenant's. */
  const clearAll = (): void => {
    const ids = [...states.keys()]
    states.clear()
    epochs.clear()
    chains.clear()
    for (const id of ids) notify(id)
  }

  /** The shared streaming handlers — every write lands in the keyed entry,
   *  guarded only by the session's own epoch. */
  const streamHandlers = (id: string, since: number): TurnHandlers => {
    const stale = () => epoch(id) !== since
    const mapMessage = (mid: string, fn: (m: Message) => Message) =>
      setLive(id, (l) => ({ ...l, messages: l.messages.map((m) => (m.id === mid ? fn(m) : m)) }))
    return {
      onStart: (_mid, message, turnId) => {
        if (stale()) return
        update(id, (s) => ({
          ...s,
          typing: false,
          ...(turnId ? { liveTurn: { sessionId: id, turnId } } : {}),
          // Id-guarded append: a reattach replays from seq 0, so the shell may
          // already be present (never duplicate it).
          live: s.live.messages.some((m) => m.id === message.id)
            ? s.live
            : { ...s.live, messages: [...s.live.messages, message] },
        }))
      },
      onDelta: (mid, chunk) => {
        if (stale()) return
        mapMessage(mid, (m) => ({ ...m, content: m.content + chunk }))
      },
      onRelations: (mid, relationActions) => {
        if (stale()) return
        mapMessage(mid, (m) => ({ ...m, relationActions }))
      },
      onToolActivity: (mid, toolActivities) => {
        if (stale()) return
        mapMessage(mid, (m) => ({ ...m, toolActivities }))
      },
      onEscalation: (mid, escalation) => {
        if (stale()) return
        patch(id, { pendingEscalation: { messageId: mid, escalation } })
      },
      onEnd: (message) => {
        if (stale()) return
        mapMessage(message.id, () => message)
        transport.onTurnSettled?.(id)
      },
    }
  }

  /** Stand the generation affordances down (however the stream ended — end,
   *  error, or drop; the record is the authority). */
  const settle = (id: string, since: number, failure?: string | null): void => {
    if (epoch(id) !== since) return
    update(id, (s) =>
      s.typing || s.busy || s.liveTurn || failure !== undefined
        ? { ...s, typing: false, busy: false, liveTurn: null, ...(failure !== undefined ? { sendFailure: failure } : {}) }
        : s,
    )
  }

  /** The whole send in one call — the PANE path (a real session, no draft
   *  materialization): the optimistic user turn + the generation flags land on
   *  the entry, then the turn streams. The singleton hook keeps its own
   *  dispatch (its optimistic writes may target the draft entry that `adopt`
   *  later moves). */
  let userSeq = 0
  const dispatchTurn = (id: string, text: string): Promise<void> => {
    const userMsg: Message = { id: `u-${Date.now().toString(36)}-${(userSeq += 1)}`, role: 'user', content: text }
    update(id, (s) => ({
      ...s,
      typing: true,
      busy: true,
      sendFailure: null,
      live: { ...s.live, messages: [...s.live.messages, userMsg] },
    }))
    return sendTurn(id, text)
  }

  /** Stream one sent turn into the keyed entry. Serialized per session; the
   *  caller set the optimistic flags (typing/busy + the user message) at
   *  dispatch, possibly on a different (draft) id that `adopt` moved here. */
  const sendTurn = (id: string, text: string): Promise<void> => {
    const since = epoch(id)
    const run = async () => {
      if (epoch(id) !== since) return // reset while queued — the send is moot
      await transport.sendMessage(id, text, streamHandlers(id, since)).then(
        () => settle(id, since),
        (err: unknown) => settle(id, since, err instanceof Error && err.message ? err.message : null),
      )
    }
    const chain = (chains.get(id) ?? Promise.resolve()).then(run).catch(() => {})
    chains.set(id, chain)
    return chain
  }

  /** Resume rendering a turn still generating server-side (invariant I1's UI
   *  face) — replays from seq 0 through the same handlers. */
  const reattach = (id: string, turnId: string): void => {
    const since = epoch(id)
    patch(id, { typing: true, busy: true, liveTurn: { sessionId: id, turnId } })
    void transport
      .reattachTurn(id, turnId, 0, streamHandlers(id, since))
      .catch(() => {})
      .finally(() => settle(id, since))
  }

  /** The deliberate stop: cancel the SERVER-owned turn — the stream's own end
   *  (not this call) clears the flags; the button doesn't fake the stop. */
  const stop = (id: string): void => {
    const t = get(id).liveTurn
    if (t) void transport.cancelTurn(t.sessionId, t.turnId).catch(() => {})
  }

  return {
    get,
    subscribe,
    patch,
    setFocus,
    setLive,
    update,
    epoch,
    reset,
    reconcile,
    adopt,
    holdEscalation,
    clearAll,
    sendTurn,
    dispatchTurn,
    reattach,
    stop,
  }
}
