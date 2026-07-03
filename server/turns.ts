/** ── The turn registry — generation turns as server-owned resources ─────────
 *  docs/design/multi-account-ui.md §5.1 (invariants I1/I4). A turn's lifetime is
 *  decoupled from the HTTP connection that started it: the send route registers
 *  the turn here, tees every reply-stream frame into its buffer, and the turn
 *  runs to completion (or explicit cancel) whether or not anyone is watching.
 *  A viewer that detached — account switch, dropped network, reload — reattaches
 *  with `?after=<seq>` and gets the missed frames replayed, then the live tail.
 *
 *  Deliberately transient (like reservations and the runner registry): an entry
 *  exists only while the turn runs. Once the assistant message is persisted the
 *  entry is removed — the persisted message is the authority, and a late
 *  reattach 404s into a session refetch. A server restart voids the registry;
 *  the epoch mechanism resyncs clients (see the failure matrix, design §7). */
import type { ActiveTurn, ReplyStreamEvent } from '../contract/index.ts'

/** A buffered reply-stream frame: the event plus its per-turn sequence number. */
export interface TurnFrame {
  seq: number
  event: ReplyStreamEvent
}

/** Buffer cap per turn (bytes of delta text). Past it, older frames are dropped
 *  from the *replay* buffer only — the live tail and the persisted record are
 *  never truncated; a reattach that reaches back past the cap learns so via
 *  `truncated` and falls back to refetching the session after `message.end`. */
const BUFFER_CAP_BYTES = 256 * 1024

interface TurnEntry {
  turn: ActiveTurn
  frames: TurnFrame[]
  /** Bytes of delta text currently buffered (the cap's accounting unit). */
  bufferedBytes: number
  /** Highest seq evicted to respect the cap (0 = nothing evicted). A replay
   *  asking for frames at or before this point is incomplete and told so. */
  evictedThrough: number
  /** Live subscribers (reattached viewers). Called per frame, then with `null`
   *  exactly once when the turn finishes. */
  subscribers: Set<(frame: TurnFrame | null) => void>
  /** Trips the turn's AbortController — the explicit-cancel hook (design §5.2:
   *  `aborted` now means deliberate cancel, never viewer disconnect). */
  cancel: () => void
}

export class TurnRegistry {
  private byTurnId = new Map<string, TurnEntry>()
  private bySessionId = new Map<string, TurnEntry>()
  private counter = 0

  /** Register a turn for a session. One active turn per session: a second start
   *  while one is live returns `undefined` (the route refuses the send — the
   *  same first-come discipline the guardian applies to sub-goals). */
  start(sessionId: string, cancel: () => void): ActiveTurn | undefined {
    if (this.bySessionId.has(sessionId)) return undefined
    this.counter += 1
    const turn: ActiveTurn = {
      id: `turn-${this.counter}`,
      sessionId,
      messageId: '',
      seq: 0,
      startedAt: Date.now(),
    }
    const entry: TurnEntry = { turn, frames: [], bufferedBytes: 0, evictedThrough: 0, subscribers: new Set(), cancel }
    this.byTurnId.set(turn.id, entry)
    this.bySessionId.set(sessionId, entry)
    return { ...turn }
  }

  /** Tee a reply-stream frame into the turn's buffer and fan it out to live
   *  subscribers. Returns the frame's sequence number (the route stamps it onto
   *  delta events), or `undefined` for an unknown/finished turn. */
  append(turnId: string, event: ReplyStreamEvent): number | undefined {
    const entry = this.byTurnId.get(turnId)
    if (!entry) return undefined
    entry.turn.seq += 1
    if (event.type === 'message.start') entry.turn.messageId = event.message.id
    const frame: TurnFrame = { seq: entry.turn.seq, event }
    entry.frames.push(frame)
    if (event.type === 'message.delta') {
      entry.bufferedBytes += event.text.length
      // Evict oldest *delta* frames past the cap; structural frames (start /
      // relations / escalation / toolActivity) are tiny and stay replayable.
      while (entry.bufferedBytes > BUFFER_CAP_BYTES) {
        const idx = entry.frames.findIndex((f) => f.event.type === 'message.delta')
        if (idx === -1) break
        const [dropped] = entry.frames.splice(idx, 1)
        entry.bufferedBytes -= (dropped.event as { text: string }).text.length
        entry.evictedThrough = Math.max(entry.evictedThrough, dropped.seq)
      }
    }
    for (const sub of entry.subscribers) sub(frame)
    return frame.seq
  }

  /** Attach a viewer: replay buffered frames with `seq > after`, then subscribe
   *  to the live tail. Returns `undefined` for an unknown (finished) turn. The
   *  caller must `unsubscribe` when its connection closes. */
  attach(
    turnId: string,
    after: number,
    onFrame: (frame: TurnFrame | null) => void,
  ): { replay: TurnFrame[]; truncated: boolean; unsubscribe: () => void } | undefined {
    const entry = this.byTurnId.get(turnId)
    if (!entry) return undefined
    const replay = entry.frames.filter((f) => f.seq > after)
    entry.subscribers.add(onFrame)
    return {
      replay,
      // Incomplete only when the request reaches back past the eviction point;
      // attaching at the live edge is always complete.
      truncated: entry.evictedThrough > after,
      unsubscribe: () => entry.subscribers.delete(onFrame),
    }
  }

  /** The turn is over (persisted, cancelled, or errored): notify subscribers
   *  (with `null` — "no more frames") and remove the entry. Idempotent. */
  finish(turnId: string): void {
    const entry = this.byTurnId.get(turnId)
    if (!entry) return
    this.byTurnId.delete(turnId)
    this.bySessionId.delete(entry.turn.sessionId)
    for (const sub of entry.subscribers) sub(null)
    entry.subscribers.clear()
  }

  /** Trip a live turn's cancel hook (the explicit-cancel route). Returns false
   *  for an unknown/finished turn. Does NOT finish the entry — the send route's
   *  abort path does, after persisting the partial. */
  cancel(turnId: string): boolean {
    const entry = this.byTurnId.get(turnId)
    if (!entry) return false
    entry.cancel()
    return true
  }

  /** The live turn for a session, if any — feeds `Session.activeTurnId`. */
  bySession(sessionId: string): ActiveTurn | undefined {
    const entry = this.bySessionId.get(sessionId)
    return entry ? { ...entry.turn } : undefined
  }

  /** A live turn by id (route existence checks). */
  get(turnId: string): ActiveTurn | undefined {
    const entry = this.byTurnId.get(turnId)
    return entry ? { ...entry.turn } : undefined
  }
}

/** The process-wide registry (one server, one set of live turns) — the same
 *  singleton pattern as the runner registry. */
export const turns = new TurnRegistry()
