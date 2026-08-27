/** ── The per-session conversation store (universal split, Phase 1) ───────────
 *  docs/design/universal-split-workspace.md §2.2: the singleton controller's
 *  SESSION half — the live workspace state, the generation flags, the streaming
 *  turn pipeline, the held escalation — decomposed into a module-scoped store
 *  KEYED BY SESSION ID, so any number of panes can host conversations (each
 *  fully interactive, Phase 3) and two panes on one session share one state.
 *
 *  Pure and dependency-injected on purpose (the railSplit/splitFrame pattern):
 *  the transport (send / reattach / cancel — the src/api commands in the real
 *  wiring, a fake in node tests) is passed into the factory, so
 *  src/controller/conversation-store.test.ts locks the keyed isolation, the epoch
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

/** The browser's loaded slice of a session's chronological message stream.
 *  `olderCursor === undefined` means this entry was not loaded through the
 *  bounded-history contract (a draft or local seed); `null` means the loaded
 *  prefix reaches the beginning. Tokens cover only the still-unloaded prefix. */
export interface ConversationHistory {
  olderCursor?: string | null
  olderTokens: number
  loading: boolean
  error: string | null
}

export type HistoryPage = Pick<ConversationHistory, 'olderCursor' | 'olderTokens'>

/** The one logical send a failed transport may retransmit. Kept only in the
 * browser entry: the server owns the message record, while this handle owns the
 * exact idempotency key and optimistic row needed to reconstruct its view. */
export interface RetryableSend {
  text: string
  idempotencyKey: string
  userMessageId?: string
  /** The authoritative transcript tail before this operation. `null` means
   * the turn began an empty thread; undefined is a legacy/unknown baseline.
   * It lets a later server reconcile distinguish a completed lost response
   * from a request that never persisted its optimistic user row. */
  priorMessageId?: string | null
  /** A failed VIEW of a known server turn retries that view first. Starting a
   * new generation here could race an unseen completion and duplicate work. */
  turnId?: string
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
  /** Present only when this client saw a send fail and can retransmit the same
   * logical operation. A reload can still retry the server-owned final user row
   * through `retryLastUser`, but naturally has no prior transport key. */
  retryableSend: RetryableSend | null
  pendingEscalation: PendingEscalation | null
  history: ConversationHistory
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
  sendMessage: (
    sessionId: string,
    text: string,
    handlers: TurnHandlers,
    options: { idempotencyKey: string; retryLastUser: boolean },
  ) => Promise<void>
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
    retryableSend: null,
    pendingEscalation: null,
    history: { olderTokens: 0, loading: false, error: null },
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
  const reset = (id: string, live: Live, history?: HistoryPage): void => {
    bump(id)
    states.set(id, {
      ...blank(),
      live,
      ...(history ? { history: { ...history, loading: false, error: null } } : {}),
    })
    notify(id)
  }

  const mergeMessages = (loaded: Message[], fresh: Message[]): Message[] => {
    const freshById = new Map(fresh.map((message) => [message.id, message]))
    const merged = loaded.map((message) => freshById.get(message.id) ?? message)
    const seen = new Set(loaded.map((message) => message.id))
    for (const message of fresh) if (!seen.has(message.id)) merged.push(message)
    return merged
  }

  /** A server reconcile: replace the live state WITHOUT staling in-flight
   *  streams — refused (false) when the entry was reset since `since`, so a
   *  slow read can't clobber a newer selection. */
  const reconcile = (id: string, since: number, live: Live, history?: HistoryPage): boolean => {
    if (epoch(id) !== since) return false
    update(id, (s) => {
      // A later newest-tail refresh must not discard pages this client already
      // loaded. A response with no older cursor is authoritative and complete,
      // however (notably after remote compaction), so it replaces stale history.
      const loadedIds = new Set(s.live.messages.map((message) => message.id))
      const preserveLoadedPrefix =
        !!history &&
        s.reconciled &&
        s.history.olderCursor !== undefined &&
        history.olderCursor !== null &&
        live.messages.some((fresh) => loadedIds.has(fresh.id))
      let nextLive = preserveLoadedPrefix
        ? { ...live, messages: mergeMessages(s.live.messages, live.messages) }
        : live
      let retryableSend = s.retryableSend
      let sendFailure = s.sendFailure

      // A session.updated may beat the failed stream back to this view. Rebase
      // the failed optimistic suffix onto the authoritative transcript: a
      // matching user + assistant after the captured prior tail proves the
      // logical turn completed and clears Retry; no matching user proves the
      // request failed before persistence, so its one optimistic row survives.
      const logical = s.retryableSend
      if (logical && logical.priorMessageId !== undefined) {
        const optimisticUser = logical.userMessageId
          ? s.live.messages.find((message) => message.id === logical.userMessageId && message.role === 'user')
          : undefined
        const serverPriorIndex = logical.priorMessageId === null
          ? -1
          : live.messages.findIndex((message) => message.id === logical.priorMessageId)
        const landedPriorIndex = logical.priorMessageId === null
          ? -1
          : nextLive.messages.findIndex((message) => message.id === logical.priorMessageId)
        const boundaryVisible = logical.priorMessageId === null || (serverPriorIndex >= 0 && landedPriorIndex >= 0)
        if (boundaryVisible) {
          const serverSuffix = live.messages.slice(serverPriorIndex + 1)
          const targetIndex = serverSuffix.findIndex(
            (message) => message.role === 'user' && message.content === logical.text,
          )
          const completed = targetIndex >= 0 && serverSuffix[targetIndex + 1]?.role === 'assistant'
          nextLive = {
            ...live,
            messages: [
              ...nextLive.messages.slice(0, landedPriorIndex + 1),
              ...serverSuffix,
              ...(targetIndex < 0 && optimisticUser ? [optimisticUser] : []),
            ],
          }
          if (completed) {
            retryableSend = null
            sendFailure = null
          }
        } else if (optimisticUser) {
          // Compaction/paging can make the captured boundary unavailable. It
          // cannot prove completion, so prefer an explicit pending row over
          // silently dropping a user operation from the authoritative view.
          nextLive = {
            ...live,
            messages: [
              ...live.messages.filter((message) => message.id !== optimisticUser.id),
              optimisticUser,
            ],
          }
        }
      }

      return {
        ...s,
        live: nextLive,
        retryableSend,
        sendFailure,
        history: history
          ? preserveLoadedPrefix
            ? { ...s.history, loading: false, error: null }
            : { ...history, loading: false, error: null }
          : { olderTokens: 0, loading: false, error: null },
        reconciled: true,
      }
    })
    return true
  }

  /** Mark the one-per-session older-page read. Shared by duplicate panes so a
   *  double click cannot race two continuations into the same stream. */
  const setHistoryLoading = (id: string, loading: boolean, error: string | null = null): void =>
    update(id, (s) => ({ ...s, history: { ...s.history, loading, error } }))

  /** Land an older page before the loaded thread, id-deduped because a cursor
   *  replay and a concurrent tail refresh may overlap at the boundary. */
  const prependHistory = (id: string, since: number, live: Live, history: HistoryPage): boolean => {
    if (epoch(id) !== since) return false
    update(id, (s) => ({
      ...s,
      live: { ...s.live, messages: mergeMessages(live.messages, s.live.messages) },
      history: { ...history, loading: false, error: null },
    }))
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

  /** Account switch: drop every conversation — they're another tenant's. The
   *  epochs are BUMPED, never cleared: an in-flight stream from the outgoing
   *  account keeps its captured `since`, and no AbortSignal stops it, so the
   *  staleness fence is the only guard — clearing the map would rewind every
   *  epoch to 0 and let a stream that captured `since===0` (a just-adopted
   *  draft, whose target epoch adopt leaves untouched) re-match and write into
   *  the NEW account's store. Monotonic epochs make that re-match impossible. */
  const clearAll = (): void => {
    const ids = new Set([...states.keys(), ...epochs.keys()])
    states.clear()
    chains.clear()
    for (const id of ids) bump(id)
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
        update(id, (s) => ({
          ...s,
          // A post-completion idempotency replay contains only `message.end`.
          // Append its authoritative message when this view never received the
          // original `message.start`; ordinary streams still replace their shell.
          live: s.live.messages.some((candidate) => candidate.id === message.id)
            ? { ...s.live, messages: s.live.messages.map((candidate) => (candidate.id === message.id ? message : candidate)) }
            : { ...s.live, messages: [...s.live.messages, message] },
        }))
        transport.onTurnSettled?.(id)
      },
    }
  }

  /** Stand the generation affordances down (however the stream ended — end,
   *  error, or drop; the record is the authority). */
  const settle = (id: string, since: number, failure?: string | null, retryableSend?: RetryableSend): void => {
    if (epoch(id) !== since) return
    update(id, (s) =>
      s.typing || s.busy || s.liveTurn || s.sendFailure || s.retryableSend || failure !== undefined
        ? {
            ...s,
            typing: false,
            busy: false,
            liveTurn: null,
            sendFailure: failure === undefined ? null : failure,
            retryableSend: failure === undefined ? null : (retryableSend ?? null),
          }
        : s,
    )
  }

  /** The whole send in one call — the PANE path (a real session, no draft
   *  materialization): the optimistic user turn + the generation flags land on
   *  the entry, then the turn streams. The singleton hook keeps its own
   *  dispatch (its optimistic writes may target the draft entry that `adopt`
   *  later moves). */
  let userSeq = 0
  /** The ONE optimistic user-message id mint — a per-mint sequence disambiguates
   *  sends within the same millisecond (rapid double-send, a supported flow), so
   *  no two optimistic turns collide on a React key or a `retry` lookup. The
   *  draft path (ConversationPane) mints through this too, not a hand-rolled copy. */
  const nextUserMessageId = (): string => `u-${Date.now().toString(36)}-${(userSeq += 1)}`
  /** Recover the logical operation represented by a server-owned user tail.
   *  Reattachment has no access to the original browser key, so a dropped
   *  reattach gets a fresh key while still targeting that one persisted turn. */
  const logicalForLastUser = (id: string, text?: string): RetryableSend | null => {
    const messages = get(id).live.messages
    let userIndex = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role === 'user' && (text === undefined || message.content === text)) {
        userIndex = index
        break
      }
    }
    const lastUser = messages[userIndex]
    return lastUser
      ? {
          text: lastUser.content,
          idempotencyKey: crypto.randomUUID(),
          userMessageId: lastUser.id,
          priorMessageId: messages[userIndex - 1]?.id ?? null,
        }
      : null
  }
  const dispatchTurn = (id: string, text: string): Promise<void> => {
    const priorMessageId = get(id).live.messages.at(-1)?.id ?? null
    const userMsg: Message = { id: nextUserMessageId(), role: 'user', content: text }
    const logical: RetryableSend = {
      text,
      idempotencyKey: crypto.randomUUID(),
      userMessageId: userMsg.id,
      priorMessageId,
    }
    update(id, (s) => ({
      ...s,
      typing: true,
      busy: true,
      sendFailure: null,
      retryableSend: null,
      live: { ...s.live, messages: [...s.live.messages, userMsg] },
    }))
    return runSend(id, logical, false)
  }

  /** Stream one sent turn into the keyed entry. Serialized per session; the
   *  caller set the optimistic flags (typing/busy + the user message) at
   *  dispatch, possibly on a different (draft) id that `adopt` moved here. */
  const runSend = (id: string, logical: RetryableSend, retryLastUser: boolean): Promise<void> => {
    const since = epoch(id)
    const run = async () => {
      if (epoch(id) !== since) return // reset while queued — the send is moot
      await transport.sendMessage(id, logical.text, streamHandlers(id, since), {
        idempotencyKey: logical.idempotencyKey,
        retryLastUser,
      }).then(
        () => settle(id, since),
        (err: unknown) => settle(id, since, err instanceof Error && err.message ? err.message : null, logical),
      )
    }
    const chain = (chains.get(id) ?? Promise.resolve()).then(run).catch(() => {})
    chains.set(id, chain)
    return chain
  }

  const sendTurn = (id: string, text: string): Promise<void> => {
    return runSend(id, logicalForLastUser(id, text) ?? { text, idempotencyKey: crypto.randomUUID() }, false)
  }

  /** Prepare a failed/orphaned turn for a clean replay: retain its one user row,
   * remove any unpersisted assistant shell/partial after it, and raise the normal
   * generation flags. Exposed for the draft host, which must re-run materialization
   * before it can send again. */
  const beginRetry = (id: string): RetryableSend | null => {
    const state = get(id)
    const remembered = state.retryableSend
    let userIndex = remembered?.userMessageId
      ? state.live.messages.findIndex((message) => message.id === remembered.userMessageId)
      : -1
    if (userIndex < 0) {
      for (let index = state.live.messages.length - 1; index >= 0; index -= 1) {
        const message = state.live.messages[index]
        if (message?.role === 'user' && (!remembered || message.content === remembered.text)) {
          userIndex = index
          break
        }
      }
    }
    if (userIndex < 0) return null
    const userMessage = state.live.messages[userIndex]!
    const logical: RetryableSend = remembered ?? {
      text: userMessage.content,
      idempotencyKey: crypto.randomUUID(),
      userMessageId: userMessage.id,
      priorMessageId: state.live.messages[userIndex - 1]?.id ?? null,
    }
    update(id, (current) => ({
      ...current,
      typing: true,
      busy: true,
      liveTurn: null,
      sendFailure: null,
      retryableSend: null,
      pendingEscalation: null,
      live: { ...current.live, messages: current.live.messages.slice(0, userIndex + 1) },
    }))
    return logical
  }

  /** Retry is one logical turn, never a second visible prompt. In-memory
   * failures retain their key for attach/replay; after a reload the server-owned
   * final user row is retried with a new key plus `retryLastUser`. */
  const retryTurn = (id: string): Promise<void> => {
    const logical = beginRetry(id)
    if (!logical) return Promise.resolve()
    return logical.turnId ? reattach(id, logical.turnId) : runSend(id, logical, true)
  }

  /** Resume rendering a turn still generating server-side (invariant I1's UI
   *  face) — replays from seq 0 through the same handlers. */
  const reattach = (id: string, turnId: string): Promise<void> => {
    const since = epoch(id)
    patch(id, { typing: true, busy: true, liveTurn: { sessionId: id, turnId } })
    return transport.reattachTurn(id, turnId, 0, streamHandlers(id, since)).then(
      () => settle(id, since),
      (err: unknown) => settle(
        id,
        since,
        err instanceof Error && err.message ? err.message : null,
        (() => {
          const logical = logicalForLastUser(id)
          return logical ? { ...logical, turnId } : undefined
        })(),
      ),
    )
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
    setHistoryLoading,
    prependHistory,
    adopt,
    holdEscalation,
    clearAll,
    sendTurn,
    dispatchTurn,
    beginRetry,
    retryTurn,
    nextUserMessageId,
    reattach,
    stop,
  }
}
