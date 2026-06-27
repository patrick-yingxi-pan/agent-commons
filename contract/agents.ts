/** ── Contract: native runners & the capability registry ─────────────────────
 *  The wire types for the capability-broker architecture (see
 *  docs/capability-broker-architecture.md). A *native runner* is a process on one
 *  of the user's hosts that connects to the server and advertises the
 *  capabilities it can perform on that host. The server keeps the live registry
 *  and routes capability invocations to the right runner.
 *
 *  This module is the contract — it is imported verbatim by both the UI and the
 *  server, so it stays framework- and Node-free. */

/** The classes of native access a runner can offer. Extensible — a new kind of
 *  capability is a new member here, advertised by runners that can fulfill it. */
export type CapabilityType = 'fs.read' | 'fs.write' | 'terminal' | 'process'

/** Is a capability **monotonic** (CALM)? A monotonic effect only observes / adds —
 *  it never retracts a conclusion another session acted on, so it is
 *  coordination-free and bypasses the resource guardian (D5). Non-monotonic effects
 *  (those that mutate shared state) must hold a reservation. Conservatively, only
 *  `fs.read` is monotonic; writes / terminals / processes may mutate.
 *  See docs/shared-resource-coordination.md. */
export function isMonotonic(capability: CapabilityType): boolean {
  return capability === 'fs.read'
}

/** One advertised capability plus the grant that scopes it. `scopes` means: the
 *  filesystem roots for `fs.*`, the allowed command patterns for `terminal` /
 *  `process`. `['*']` is unrestricted (the user granted everything of this kind).
 *  The runner — never the broker — enforces these grants (D3). */
export interface RunnerCapability {
  type: CapabilityType
  scopes: string[]
}

export type RunnerStatus = 'online' | 'offline'

/** A native runner as the registry knows it. Identity is **durable** (D4): a
 *  disconnect marks the runner `offline` but keeps it, so a reconnect re-binds to
 *  the same `id` and the user's references to it ("my laptop") stay stable. */
export interface Runner {
  /** Durable identity — stable across reconnect / restart / IP change. */
  id: string
  /** Human label the user *and* the model refer to it by ("Patrick's MacBook"). */
  label: string
  /** Display origin for the host (informational; not an address). */
  host: string
  status: RunnerStatus
  /** Epoch-ms of the last register / heartbeat — the liveness signal. */
  lastSeen: number
  /** What this runner can do on its host right now, with each grant's scope. */
  capabilities: RunnerCapability[]
}

/** Body of `POST /v1/runners` — a runner enrolls or reconnects. Omitting `id`
 *  mints a new durable identity (first enrollment); providing a known `id`
 *  reconnects to it (and re-advertises its capabilities). */
export interface RegisterRunnerRequest {
  id?: string
  label: string
  host: string
  capabilities: RunnerCapability[]
}

/** Body of `PATCH /v1/runners/:id/capabilities` — re-advertise the grant set
 *  (e.g. the user granted a new folder, or revoked one). */
export interface SetRunnerCapabilitiesRequest {
  capabilities: RunnerCapability[]
}

/** Body of `POST /v1/runners/:id/invoke` — run a capability on that runner's host.
 *  This is the addressed-and-routed capability call: the broker routes it to the
 *  runner, which enforces that `target` is within one of its granted scopes (D3)
 *  before executing. `target` is the thing acted on (an fs path for `fs.*`, a
 *  command for `terminal`/`process`); `args` carries capability-specific input
 *  (e.g. `{ content }` for `fs.write`).
 *
 *  `commandId` is the **idempotency key** (D2): a client assigns it once per
 *  logical invocation, so a retried call (lost response, reconnect) returns the
 *  recorded effect instead of executing twice. Omit it and the server mints one
 *  (single execution, but no cross-retry dedup).
 *
 *  `sessionId` + `contextId` are the **mediation handle** (D5): the effect is
 *  routed *through* a context attached to the session, and the broker enforces
 *  that `target` is within that context's scope (the reference-monitor check) on
 *  top of the runner's host grant. See docs/shared-resource-coordination.md. */
export interface CapabilityRequest {
  /** The session initiating the effect — the mediation subject. */
  sessionId: string
  /** The attached context this effect is routed through; its scope bounds the
   *  effect's `target`, enforced at the broker alongside the runner's host grant. */
  contextId: string
  capability: CapabilityType
  target: string
  args?: Record<string, unknown>
  commandId?: string
}

/** Result of a capability invocation. `output` is capability-specific (the runner
 *  fulfils it on its host). Mock fulfilment today; the wire shape is real. */
export interface CapabilityResult {
  capability: CapabilityType
  /** Which runner fulfilled it — the host the effect happened on. */
  runnerId: string
  /** Echoed target, so a caller can correlate without tracking request state. */
  target: string
  output: unknown
}

/** A recorded capability effect — an entry in a runner's authoritative log (D2).
 *  The runner is the system of record for its host's effects; the server keeps a
 *  projection of these and clients converge on it. `runnerSeq` is the runner's
 *  monotonic per-host ordering; `commandId` is the idempotency key + effect id. */
export interface CapabilityEffect {
  commandId: string
  runnerId: string
  capability: CapabilityType
  target: string
  output: unknown
  /** The runner's authoritative monotonic sequence on its host. */
  runnerSeq: number
  /** Epoch-ms the runner executed it. */
  at: number
}

/** One effect a runner reports to the server out-of-band — the unit of the
 *  outbox replay (`POST /v1/runners/:id/sync`). The effect already happened on the
 *  host (via the co-located fast path, or while the server was unreachable); the
 *  runner now tees it up so the server's projection catches up. */
export interface EffectReport {
  commandId: string
  capability: CapabilityType
  target: string
  output: unknown
  at?: number
}

/** Body of `POST /v1/runners/:id/sync` — a runner replays its outbox. Effects are
 *  merged idempotently by `commandId`, so re-sending an already-recorded effect
 *  is a no-op (the at-least-once delivery guarantee). */
export interface SyncEffectsRequest {
  effects: EffectReport[]
}

/** Result of a sync: the effects newly projected by this call and the runner's new
 *  projection cursor (how far the server has reconciled the runner's log). */
export interface SyncEffectsResult {
  projected: CapabilityEffect[]
  cursor: number
}
