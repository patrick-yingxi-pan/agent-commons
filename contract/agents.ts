/** ── Contract: native agents & the capability registry ─────────────────────
 *  The wire types for the capability-broker architecture (see
 *  docs/capability-broker-architecture.md). A *native agent* is a process on one
 *  of the user's hosts that connects to the server and advertises the
 *  capabilities it can perform on that host. The server keeps the live registry
 *  and routes capability invocations to the right agent.
 *
 *  This module is the contract — it is imported verbatim by both the UI and the
 *  server, so it stays framework- and Node-free. */

/** The classes of native access an agent can offer. Extensible — a new kind of
 *  capability is a new member here, advertised by agents that can fulfill it. */
export type CapabilityType = 'fs.read' | 'fs.write' | 'terminal' | 'process'

/** One advertised capability plus the grant that scopes it. `scopes` means: the
 *  filesystem roots for `fs.*`, the allowed command patterns for `terminal` /
 *  `process`. `['*']` is unrestricted (the user granted everything of this kind).
 *  The agent — never the broker — enforces these grants (D3). */
export interface AgentCapability {
  type: CapabilityType
  scopes: string[]
}

export type AgentStatus = 'online' | 'offline'

/** A native agent as the registry knows it. Identity is **durable** (D4): a
 *  disconnect marks the agent `offline` but keeps it, so a reconnect re-binds to
 *  the same `id` and the user's references to it ("my laptop") stay stable. */
export interface Agent {
  /** Durable identity — stable across reconnect / restart / IP change. */
  id: string
  /** Human label the user *and* the model refer to it by ("Patrick's MacBook"). */
  label: string
  /** Display origin for the host (informational; not an address). */
  host: string
  status: AgentStatus
  /** Epoch-ms of the last register / heartbeat — the liveness signal. */
  lastSeen: number
  /** What this agent can do on its host right now, with each grant's scope. */
  capabilities: AgentCapability[]
}

/** Body of `POST /v1/agents` — an agent enrolls or reconnects. Omitting `id`
 *  mints a new durable identity (first enrollment); providing a known `id`
 *  reconnects to it (and re-advertises its capabilities). */
export interface RegisterAgentRequest {
  id?: string
  label: string
  host: string
  capabilities: AgentCapability[]
}

/** Body of `PATCH /v1/agents/:id/capabilities` — re-advertise the grant set
 *  (e.g. the user granted a new folder, or revoked one). */
export interface SetAgentCapabilitiesRequest {
  capabilities: AgentCapability[]
}

/** Body of `POST /v1/agents/:id/invoke` — run a capability on that agent's host.
 *  This is the addressed-and-routed capability call: the broker routes it to the
 *  agent, which enforces that `target` is within one of its granted scopes (D3)
 *  before executing. `target` is the thing acted on (an fs path for `fs.*`, a
 *  command for `terminal`/`process`); `args` carries capability-specific input
 *  (e.g. `{ content }` for `fs.write`).
 *
 *  `commandId` is the **idempotency key** (D2): a client assigns it once per
 *  logical invocation, so a retried call (lost response, reconnect) returns the
 *  recorded effect instead of executing twice. Omit it and the server mints one
 *  (single execution, but no cross-retry dedup). */
export interface CapabilityRequest {
  capability: CapabilityType
  target: string
  args?: Record<string, unknown>
  commandId?: string
}

/** Result of a capability invocation. `output` is capability-specific (the agent
 *  fulfils it on its host). Mock fulfilment today; the wire shape is real. */
export interface CapabilityResult {
  capability: CapabilityType
  /** Which agent fulfilled it — the host the effect happened on. */
  agentId: string
  /** Echoed target, so a caller can correlate without tracking request state. */
  target: string
  output: unknown
}

/** A recorded capability effect — an entry in an agent's authoritative log (D2).
 *  The agent is the system of record for its host's effects; the server keeps a
 *  projection of these and clients converge on it. `agentSeq` is the agent's
 *  monotonic per-host ordering; `commandId` is the idempotency key + effect id. */
export interface CapabilityEffect {
  commandId: string
  agentId: string
  capability: CapabilityType
  target: string
  output: unknown
  /** The agent's authoritative monotonic sequence on its host. */
  agentSeq: number
  /** Epoch-ms the agent executed it. */
  at: number
}

/** One effect an agent reports to the server out-of-band — the unit of the
 *  outbox replay (`POST /v1/agents/:id/sync`). The effect already happened on the
 *  host (via the co-located fast path, or while the server was unreachable); the
 *  agent now tees it up so the server's projection catches up. */
export interface EffectReport {
  commandId: string
  capability: CapabilityType
  target: string
  output: unknown
  at?: number
}

/** Body of `POST /v1/agents/:id/sync` — an agent replays its outbox. Effects are
 *  merged idempotently by `commandId`, so re-sending an already-recorded effect
 *  is a no-op (the at-least-once delivery guarantee). */
export interface SyncEffectsRequest {
  effects: EffectReport[]
}

/** Result of a sync: the effects newly projected by this call and the agent's new
 *  projection cursor (how far the server has reconciled the agent's log). */
export interface SyncEffectsResult {
  projected: CapabilityEffect[]
  cursor: number
}
