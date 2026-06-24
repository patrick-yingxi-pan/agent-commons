/** ── Contract: resource guardians & reservations (D5) ───────────────────────
 *  The escrow primitive that tames the hard case — *different sessions producing
 *  irreversible effects on a shared resource* (see
 *  docs/shared-resource-coordination.md). A shared resource (a context element,
 *  keyed by its id) has a **guardian** enforcing a **capacity** invariant via a
 *  **reservation ledger**: a non-monotonic effect must hold a reservation, and
 *  `capacity` bounds how many distinct sessions may hold one at once (1 =
 *  exclusive). A reservation is reversible while `held` (it can be released, and it
 *  lapses by TTL); `commit` records the single irreversible step. */

export type ReservationStatus = 'held' | 'committed' | 'released'

/** One entry in a resource's reservation ledger. */
export interface Reservation {
  id: string
  /** The shared resource — a context element id (e.g. a repo / folder id). */
  resourceId: string
  /** Who holds it — the session id. Re-entrant: a holder gets one per resource. */
  holder: string
  status: ReservationStatus
  /** Epoch-ms when granted. */
  at: number
  /** Epoch-ms after which a `held` / `committed` reservation lapses (frees its slot). */
  expiresAt: number
}

/** Body of `POST /v1/resources/:key/reserve` — acquire (or re-enter) a reservation. */
export interface ReserveRequest {
  /** The session acquiring the reservation. */
  holder: string
  /** Optional lease lifetime (ms); the server applies a default when omitted. */
  ttlMs?: number
}

/** Body of `PATCH /v1/resources/:key` — configure a resource's capacity (how many
 *  distinct sessions may concurrently hold it; default 1 = exclusive). */
export interface SetCapacityRequest {
  capacity: number
}

/** `GET /v1/resources/:key` — a resource's guardian state: its capacity and the
 *  reservations currently active (held or committed, not expired / released). */
export interface ResourceStatus {
  resourceId: string
  capacity: number
  active: Reservation[]
}
