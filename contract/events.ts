/** ── Contract: server → client events ──────────────────────────────────────
 *  Every change that originates on the *server* and the UI must learn about
 *  without having made a matching request. Two SSE channels carry these, but they
 *  share one typed union so the client has a single event router:
 *
 *  • The **reply stream** — the SSE body of `POST /v1/sessions/:id/messages`.
 *    An assistant turn is incremental and open-ended (mirrors the Anthropic
 *    Messages API), and it can carry *structured* side-effects mid-turn — it
 *    escalates the session (attaches a workspace/repo) or proposes relation edits.
 *    So the channel carries typed events, not just text deltas.
 *  • The **ambient stream** — `GET /v1/events`. A scheduled run fires on its
 *    cadence; a standing approval makes the daemon edit the graph unprompted; a
 *    connector's auth expires. None of these has a pending request to answer.
 *
 *  Request/response is enough for plain reads and for *initiating* a command; it
 *  is not enough for anything on this list. */
import type { Connector, Message, Session } from './entities.ts'
import type { ScheduledRun } from './cowork.ts'
import type { RelationOp } from './relations.ts'
import type { ContextTypeId } from './contexts.ts'
import type { Agent, CapabilityEffect } from './agents.ts'

/** ── Reply-stream events (one assistant turn) ── */
export interface MessageStartEvent {
  type: 'message.start'
  sessionId: string
  /** The shell of the assistant message; `content` fills in via deltas. */
  message: Message
}
export interface MessageDeltaEvent {
  type: 'message.delta'
  sessionId: string
  messageId: string
  /** Text appended to the message's content. */
  text: string
}
/** A mid-turn escalation: the assistant attaches a workspace or a repo. The
 *  client applies it to the live session exactly as the guided tour does. */
export interface MessageEscalateEvent {
  type: 'message.escalate'
  sessionId: string
  messageId: string
  escalate: 'workspace' | 'repo'
}
/** A mid-turn relation proposal: the assistant offers graph edits as a card. */
export interface MessageRelationsEvent {
  type: 'message.relations'
  sessionId: string
  messageId: string
  relationActions: RelationOp[]
}
export interface MessageEndEvent {
  type: 'message.end'
  sessionId: string
  /** The complete, final assistant message (authoritative). */
  message: Message
}

/** ── Ambient events (global stream) ── */
/** A scheduled run started executing. Carries the run + the synthesized session
 *  id it executes in, so the left rail can show it live and open it. */
export interface RunStartedEvent {
  type: 'run.started'
  taskId: string
  taskName: string
  sessionId: string
  run: ScheduledRun
}
/** A running scheduled run advanced a step (relights the detail rail). */
export interface RunProgressEvent {
  type: 'run.progress'
  taskId: string
  runId: string
  reachedStep: number
  status: ScheduledRun['status']
}
/** A scheduled run finished (ok / failed / skipped). */
export interface RunFinishedEvent {
  type: 'run.finished'
  taskId: string
  taskName: string
  sessionId: string
  run: ScheduledRun
}
/** A relation edit was applied — by a user confirmation, or by a schedule's
 *  standing approval acting unprompted on a run. Open sections re-read. */
export interface RelationAppliedEvent {
  type: 'relation.applied'
  op: RelationOp
  by: 'user' | 'standing'
}
/** A type's recents list changed (e.g. attached on another device/tab). */
export interface RecentsChangedEvent {
  type: 'recents.changed'
  contextType: ContextTypeId
  ids: string[]
}
/** A connector / MCP server's auth or setup state changed asynchronously
 *  (OAuth callback completed, token expired, admin revoked). */
export interface ConnectorStatusEvent {
  type: 'connector.status'
  id: string
  status: 'connected' | 'needs-auth'
}
/** A session's persisted summary changed (title, preview, updatedLabel) — e.g.
 *  after a turn — so list rows refresh without a full refetch. */
export interface SessionUpdatedEvent {
  type: 'session.updated'
  session: Session
}
/** A native agent connected — a new enrollment, or a known agent returning from
 *  offline (its durable identity re-bound). Carries the full agent record so the
 *  registry cache can upsert it without a refetch. */
export interface AgentConnectedEvent {
  type: 'agent.connected'
  agent: Agent
}
/** A native agent disconnected. Its identity persists (marked offline) so a later
 *  reconnect re-binds; the UI shows it offline rather than dropping it. */
export interface AgentDisconnectedEvent {
  type: 'agent.disconnected'
  agentId: string
}
/** An online agent re-advertised its capabilities (a grant added or revoked). */
export interface AgentCapabilitiesChangedEvent {
  type: 'agent.capabilities.changed'
  agent: Agent
}
/** A capability effect was projected into the server's record (D2) — from a
 *  relayed invoke or a synced outbox. Broadcast so every client's view of that
 *  agent's effect log converges without polling. */
export interface AgentEffectEvent {
  type: 'agent.effect'
  effect: CapabilityEffect
}

/** Sent once when an SSE channel opens, so the client can confirm liveness. */
export interface HelloEvent {
  type: 'hello'
  /** Monotonic server boot id — a change means the server restarted (state was
   *  reseeded), so the client should refetch rather than trust its cache. */
  epoch: string
}

export type ServerEvent =
  | HelloEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEscalateEvent
  | MessageRelationsEvent
  | MessageEndEvent
  | RunStartedEvent
  | RunProgressEvent
  | RunFinishedEvent
  | RelationAppliedEvent
  | RecentsChangedEvent
  | ConnectorStatusEvent
  | SessionUpdatedEvent
  | AgentConnectedEvent
  | AgentDisconnectedEvent
  | AgentCapabilitiesChangedEvent
  | AgentEffectEvent

export type ServerEventType = ServerEvent['type']

/** Reply-stream events appear only in a `POST …/messages` SSE body; the rest are
 *  ambient. Handy for the client router and for server-side typing. */
export type ReplyStreamEvent =
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEscalateEvent
  | MessageRelationsEvent
  | MessageEndEvent
