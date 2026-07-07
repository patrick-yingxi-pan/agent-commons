/** ── Contract: the A2A (Agent2Agent) edge dialect (docs/a2a-integration.md, D20) ──
 *  The platform speaks A2A at its edge as a TRANSLATION layer over objects that
 *  already exist — a published Agent's D18 definition served as an **Agent Card**,
 *  a D19 open-work item's lifecycle served as a **Task** — never as a new authority
 *  path ("a protocol translates; it never authorizes"). These types are the wire
 *  subset the prototype implements of A2A ~0.3 (JSON-RPC 2.0 over HTTP), kept
 *  framework-free like the rest of the contract. */

/** The A2A protocol revision the cards declare. */
export const A2A_PROTOCOL_VERSION = '0.3.0'

/** One advertised skill on an Agent Card. For a published Agent, skills are its
 *  public tool list (the D18 definition's `tools`); for the platform card, the
 *  one instance-level act (posting open work to a shared Project). */
export interface A2aAgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
}

/** An A2A **Agent Card** — the machine-readable front door. Ours are built from
 *  exactly the fields the D17 directory already exposes (the same redaction, one
 *  wall two windows); `metadata` carries the public track record. */
export interface A2aAgentCard {
  protocolVersion: string
  name: string
  description: string
  /** The card subject's A2A JSON-RPC endpoint (absolute). */
  url: string
  version: string
  preferredTransport: 'JSONRPC'
  /** The owning workspace's public display name — never a raw tenant id. */
  provider?: { organization: string }
  capabilities: { streaming: boolean; pushNotifications: boolean }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: A2aAgentSkill[]
  /** Public, non-spec extras: the D13/D18 track record (contributions, forks)
   *  and the published system prompt (already public via the directory). */
  metadata?: Record<string, unknown>
}

/** A2A message parts — the v1 subset: text and structured data. */
export interface A2aTextPart {
  kind: 'text'
  text: string
}
export interface A2aDataPart {
  kind: 'data'
  data: Record<string, unknown>
}
export type A2aPart = A2aTextPart | A2aDataPart

/** An A2A **Message** — one conversational unit inside a task exchange. */
export interface A2aMessage {
  kind: 'message'
  role: 'user' | 'agent'
  messageId: string
  parts: A2aPart[]
  taskId?: string
  contextId?: string
  /** Spec extras — this platform stamps a history message's comment author + time. */
  metadata?: Record<string, unknown>
}

/** The Task states this edge emits — the honest image of the D19 lifecycle:
 *  `submitted` = the item is open, awaiting a taker (NOT `working`: dispatch is
 *  synchronous, nothing is executing between reads); `completed` = a standing
 *  Contributor took it (the artifact carries the D13 credit line); `rejected` =
 *  the D18 refusal (an Agent endpoint never leases its owner's capability). */
export type A2aTaskState = 'submitted' | 'working' | 'completed' | 'canceled' | 'failed' | 'rejected'

/** An A2A **Task** — for this platform, the wire image of an `OpenSubGoal`
 *  (task id = item id, contextId = the Project id). */
export interface A2aTask {
  kind: 'task'
  id: string
  contextId: string
  status: {
    state: A2aTaskState
    /** ISO-8601, per spec. */
    timestamp: string
    message?: A2aMessage
  }
  artifacts?: { artifactId: string; name?: string; parts: A2aPart[] }[]
  /** The task's message history — for this platform, the work item's D23
   *  discussion thread (one comment = one message; the author display name rides
   *  each message's metadata). Present when the item has comments. */
  history?: A2aMessage[]
  metadata?: Record<string, unknown>
}

/** JSON-RPC 2.0 envelope (the A2A transport). Errors ride HTTP 200 with an
 *  `error` member, per protocol convention. */
export interface A2aRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}
export interface A2aRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}
export interface A2aRpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}
export type A2aRpcResponse = A2aRpcSuccess | A2aRpcFailure

/** The JSON-RPC / A2A error codes this edge uses. `taskNotFound` doubles as the
 *  existence-hiding answer for a Project the caller cannot see — identical to a
 *  nonexistent one, as everywhere else in the API. */
export const A2A_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
} as const

/** Body of `POST /v1/agents/import-card` — the outbound half (federation seed):
 *  fetch a remote Agent Card and mint a private, UNBOUND definition-stub Agent
 *  from it (`importedFrom` lineage; no authority / budget / provider — D18's
 *  "capability never travels", across instances). */
export interface ImportAgentCardRequest {
  url: string
}
