/** ── The resource guardian (D5) ─────────────────────────────────────────────
 *  Per shared resource (a context element id), a reservation ledger enforcing a
 *  capacity invariant. This is the escrow primitive from
 *  docs/shared-resource-coordination.md: it turns a non-monotonic-irreversible
 *  conflict — "two sessions write the same resource" — into a reversible
 *  reservation conflict the broker can refuse up front. `reserve` is reversible
 *  (releasable, TTL'd); `commit` records the single irreversible step. `capacity`
 *  is how many distinct holder sessions may be active at once (default 1 = mutual
 *  exclusion).
 *
 *  Lives broker-side — the *resource* authority, beside mediation — distinct from
 *  the agent's host grant (D3). Mock fulfilment, real semantics: the same shape a
 *  production guardian would enforce. The clock is injectable so TTL behaviour is
 *  testable (mirrors AgentRegistry / AgentJournal). */
import type { Reservation, ResourceStatus, ServerEvent } from '../contract/index.ts'

/** A reservation the guardian refused or couldn't find. `code` maps to the
 *  contract error envelope so the route can surface it verbatim. */
export class GuardianError extends Error {
  readonly code: 'conflict' | 'not_found'
  constructor(code: 'conflict' | 'not_found', message: string) {
    super(message)
    this.code = code
    this.name = 'GuardianError'
  }
}

/** Default lease lifetime — a held reservation lapses (frees its slot) after this
 *  if not refreshed, so a crashed/forgotten holder can't lock a resource forever. */
const DEFAULT_TTL_MS = 60_000

interface Resource {
  capacity: number
  reservations: Map<string, Reservation>
}

export class ResourceGuardian {
  private readonly resources = new Map<string, Resource>()
  private readonly emit: (e: ServerEvent) => void
  private readonly now: () => number
  private seq = 0

  constructor(emit: (e: ServerEvent) => void, now: () => number = () => Date.now()) {
    this.emit = emit
    this.now = now
  }

  private resourceFor(resourceId: string): Resource {
    let r = this.resources.get(resourceId)
    if (!r) {
      r = { capacity: 1, reservations: new Map() }
      this.resources.set(resourceId, r)
    }
    return r
  }

  /** A reservation occupies a slot while it is held or committed and not expired. */
  private isActive(r: Reservation): boolean {
    return r.status !== 'released' && r.expiresAt > this.now()
  }

  private activeList(res: Resource): Reservation[] {
    return [...res.reservations.values()].filter((r) => this.isActive(r))
  }

  /** Drop dead entries (released or lapsed) so the ledger doesn't grow unbounded —
   *  one entry would otherwise linger per effect ever run. Called on the
   *  read / acquire paths; the active set is unaffected (those entries were already
   *  filtered out of it). */
  private prune(res: Resource): void {
    const now = this.now()
    for (const [id, r] of res.reservations) {
      if (r.status === 'released' || r.expiresAt <= now) res.reservations.delete(id)
    }
  }

  /** Set how many distinct sessions may concurrently hold this resource. */
  setCapacity(resourceId: string, capacity: number): ResourceStatus {
    const res = this.resourceFor(resourceId)
    res.capacity = Math.max(1, Math.floor(capacity))
    this.emit({ type: 'reservation.changed', resourceId })
    return this.status(resourceId)
  }

  /** Acquire — or re-enter — a reservation for `holder` on `resourceId`. Re-entrant:
   *  a holder already holding an active reservation gets it back with its TTL
   *  refreshed (so a burst of writes by one session doesn't self-conflict) — the
   *  returned reservation reflects its current status (`held`, or `committed` if this
   *  holder already committed). A new holder is granted iff the distinct active
   *  holders are below capacity; otherwise the resource is escrow-locked and this
   *  throws `conflict`. */
  reserve(resourceId: string, holder: string, opts: { ttlMs?: number } = {}): Reservation {
    const res = this.resourceFor(resourceId)
    this.prune(res)
    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
    const now = this.now()
    const active = this.activeList(res)
    const mine = active.find((r) => r.holder === holder)
    if (mine) {
      mine.expiresAt = now + ttl
      this.emit({ type: 'reservation.changed', resourceId })
      return { ...mine }
    }
    const holders = new Set(active.map((r) => r.holder))
    if (holders.size >= res.capacity) {
      throw new GuardianError(
        'conflict',
        `resource '${resourceId}' is at capacity (${res.capacity}) — held by another session`,
      )
    }
    const r: Reservation = {
      id: `res-${(this.seq += 1)}`,
      resourceId,
      holder,
      status: 'held',
      at: now,
      expiresAt: now + ttl,
    }
    res.reservations.set(r.id, r)
    this.emit({ type: 'reservation.changed', resourceId })
    return { ...r }
  }

  private find(reservationId: string): Reservation {
    for (const res of this.resources.values()) {
      const r = res.reservations.get(reservationId)
      if (r) return r
    }
    throw new GuardianError('not_found', `no reservation '${reservationId}'`)
  }

  /** Record the irreversible step. Idempotent (a committed reservation stays
   *  committed); throws `conflict` if the reservation already lapsed (expired or
   *  released) — its slot is gone, so the effect can't claim it after the fact. */
  commit(reservationId: string): Reservation {
    const r = this.find(reservationId)
    if (r.status === 'committed') return { ...r }
    if (!this.isActive(r)) {
      throw new GuardianError('conflict', `reservation '${reservationId}' is no longer held`)
    }
    r.status = 'committed'
    this.emit({ type: 'reservation.changed', resourceId: r.resourceId })
    return { ...r }
  }

  /** Free the slot (reverse a hold, or close out a committed lease). Idempotent. */
  release(reservationId: string): Reservation {
    const r = this.find(reservationId)
    if (r.status !== 'released') {
      r.status = 'released'
      this.emit({ type: 'reservation.changed', resourceId: r.resourceId })
    }
    return { ...r }
  }

  /** A resource's capacity + the reservations currently active. */
  status(resourceId: string): ResourceStatus {
    const res = this.resourceFor(resourceId)
    this.prune(res)
    return { resourceId, capacity: res.capacity, active: this.activeList(res).map((r) => ({ ...r })) }
  }
}
