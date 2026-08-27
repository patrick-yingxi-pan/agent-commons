/** ── The ambient event log — resumable push (multi-account design §5.3) ─────
 *  Every ambient `ServerEvent` gets a global monotonic sequence number and a slot
 *  in a small ring buffer. The `/v1/events` SSE stream writes the seq as the SSE
 *  `id:` field, so a reconnecting `EventSource` presents `Last-Event-ID` and the
 *  route REPLAYS what the subscriber missed (tenant-filtered at replay time — the
 *  same visibility gate as the live fan-out, so replay can never widen it).
 *
 *  Reliability math (invariants I3/I4): events are cache-invalidation *hints* —
 *  a duplicate is a harmless re-invalidation, and a gap is impossible: either the
 *  tail is still in the buffer (replayed) or it aged out and the `hello` says
 *  `resumed: false`, telling the client to drop its cache and refetch. So the
 *  buffer bounds *staleness recovery cost*, never correctness. Transient by
 *  design (a restart re-seeds state anyway — the epoch mechanism covers it). */
import type { ServerEvent } from '../contract/index.ts'

export interface LoggedEvent {
  seq: number
  event: ServerEvent
}

/** How many events the replay window holds. A few minutes of typical chatter;
 *  past it a reconnect falls back to a full resync (correct, just costlier).
 *  Invalidation events carry compact resource refs (not session transcripts),
 *  so entry count is a meaningful first bound; a byte ceiling remains the next
 *  refinement if other event payloads grow. */
const DEFAULT_CAPACITY = 512

export class EventLog {
  private ring: LoggedEvent[] = []
  private counter = 0
  private readonly capacity: number

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity
  }

  /** Stamp the next sequence number on an event and remember it for replay. */
  record(event: ServerEvent): number {
    this.counter += 1
    this.ring.push({ seq: this.counter, event })
    if (this.ring.length > this.capacity) this.ring.shift()
    return this.counter
  }

  /** The stream's current position (the last stamped seq; 0 = nothing yet). */
  seq(): number {
    return this.counter
  }

  /** The tail after `afterSeq`. `complete` is true when nothing in the gap has
   *  aged out of the buffer — i.e. the caller can trust the replay is the whole
   *  story. `complete: false` means the subscriber must fully resync instead. */
  since(afterSeq: number): { events: LoggedEvent[]; complete: boolean } {
    const oldest = this.ring[0]?.seq
    // Complete iff the buffer still reaches back to afterSeq+1 (or nothing was
    // ever recorded / nothing is missing).
    const complete = afterSeq >= this.counter || (oldest !== undefined && oldest <= afterSeq + 1)
    return { events: this.ring.filter((f) => f.seq > afterSeq), complete }
  }
}

/** The process-wide log (one server, one ambient stream) — the same singleton
 *  pattern as the turn registry. */
export const eventlog = new EventLog()
