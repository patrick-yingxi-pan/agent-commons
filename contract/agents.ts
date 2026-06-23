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
