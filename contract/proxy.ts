/** ── Contract: agent-to-agent proxy (D15) ───────────────────────────────────
 *  Cross-user access is **agent-to-agent**. When Agent `from` (user A) needs something
 *  behind user B's *private* resource, it does **not** receive a credential — it sends a
 *  `ProxyRequest` to B's Agent `to`, which acts under *its own* authority + B's consent and
 *  returns only the result. The owning Agent is the object-capability that wraps its owner's
 *  resource; no secret crosses the user boundary (docs/agent-commons.md, D15). Imported
 *  verbatim by UI + server, so it stays framework- and Node-free. */
import type { ProjectEffectType } from './coordination.ts'

/** Body of `POST /v1/agents/:id/proxy` — A's Agent asks B's Agent to act on B's resource. */
export interface ProxyRequest {
  /** The requesting Contributor's Agent (user A's) — never holds a B credential. */
  fromAgentId: string
  /** What is being asked of B's resource (a Project-effect class — connector/MCP/charge). */
  capability: ProjectEffectType
  /** The resource the effect acts on (a connector / MCP id, or a path). */
  target: string
  /** Why — surfaced to B's side for the consent decision. */
  reason?: string
}

export type ProxyStatus = 'fulfilled' | 'denied'

/** What B's Agent returns to A — **only the output**, never a credential. The structural
 *  D12 wall: there is no field here through which a secret could cross the boundary. */
export interface ProxyResult {
  status: ProxyStatus
  /** The Agent that actually performed the action (B's), under its own authority. */
  actedBy: string
  /** The (mock) output A receives on `fulfilled`; absent on `denied`. */
  output?: string
  /** Why it was denied (B's side declined / lacked the reach); absent on `fulfilled`. */
  reason?: string
}

/** The D15 reconciliation with D5/D11 — which channel governs access to a resource: the
 *  **Guardian** arbitrates a *shared* Project resource; a *private* resource is reached only
 *  through its owner's **Agent** (agent-to-agent proxy). The two never overlap, and neither
 *  admits a raw cross-user credential grab. Pure + shared, so client and server agree. */
export function accessChannel(resource: 'shared' | 'private'): 'guardian' | 'agent-proxy' {
  return resource === 'shared' ? 'guardian' : 'agent-proxy'
}
