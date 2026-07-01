/** ── Contract: server → client events ──────────────────────────────────────
 *  Every change that originates on the *server* and the UI must learn about
 *  without having made a matching request. Two SSE channels carry these, but they
 *  share one typed union so the client has a single event router:
 *
 *  • The **reply stream** — the SSE body of `POST /v1/sessions/:id/messages`.
 *    An assistant turn is incremental and open-ended (mirrors the Anthropic
 *    Messages API), and it can carry *structured* side-effects — it proposes
 *    relation edits mid-turn (`message.relations`), and the final message can
 *    escalate the session (carried on its `Message.escalate`, applied at
 *    `message.end`). So the channel carries typed events, not just text deltas.
 *  • The **ambient stream** — `GET /v1/events`. A scheduled run fires on its
 *    cadence; a standing approval makes the daemon edit the graph unprompted; a
 *    connector's auth expires. None of these has a pending request to answer.
 *
 *  Request/response is enough for plain reads and for *initiating* a command; it
 *  is not enough for anything on this list. */
import type { Connector, EscalationProposal, Message, Session, ToolActivity } from './entities.ts'
import type { ScheduledRun } from './cowork.ts'
import type { RelationOp } from './relations.ts'
import type { AuditEntry } from './audit.ts'
import type { ContextTypeId, SessionContext } from './contexts.ts'
import type { Runner, CapabilityEffect } from './agents.ts'

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
/** A mid-turn relation proposal: the assistant offers graph edits as a card. */
export interface MessageRelationsEvent {
  type: 'message.relations'
  sessionId: string
  messageId: string
  relationActions: RelationOp[]
}
/** A mid-turn escalation proposal — the structured result of a panel-producing
 *  tool call (open_workspace / connect_repo / create_project). The UI shows the
 *  matching consent prompt and applies it only on approval. */
export interface MessageEscalationEvent {
  type: 'message.escalation'
  sessionId: string
  messageId: string
  escalation: EscalationProposal
}
/** A mid-turn connector/MCP tool call + its (mock) result (P6). A read tool only
 *  surfaced data, so this is *activity* shown under the message — not a consent
 *  proposal like `message.escalation` / `message.relations`. */
export interface MessageToolActivityEvent {
  type: 'message.toolActivity'
  sessionId: string
  messageId: string
  toolActivities: ToolActivity[]
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
/** A running scheduled run advanced a step (relights the detail rail). Emitted per
 *  step as `store.runSchedule` walks a run from 0 → its step count before finishing. */
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
/** A relation edit was applied — `by: 'user'` from a confirmation (store.applyRelationOp),
 *  or `by: 'standing'` when a run applies a schedule's standing-approved effect
 *  unprompted (store.applyStandingEffects — e.g. "save <artifact> each run"). Open
 *  sections re-read. */
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
/** A connector / MCP server's auth or setup state changed (OAuth callback completed,
 *  token expired, admin revoked). Emitted by `store.setConnectorStatus` — the
 *  Contexts page connect / disconnect, and the seam a real OAuth callback would use. */
export interface ConnectorStatusEvent {
  type: 'connector.status'
  id: string
  status: 'connected' | 'needs-auth'
}
/** A session's persisted summary changed (title, preview, updatedAt) — e.g.
 *  after a turn — so list rows refresh without a full refetch. */
export interface SessionUpdatedEvent {
  type: 'session.updated'
  session: Session
}
/** A session's attached contexts changed — attached or detached (Primitive 1 of
 *  docs/shared-resource-coordination.md). Carries the full list so the cache can
 *  upsert without a refetch. */
export interface SessionContextsChangedEvent {
  type: 'session.contexts.changed'
  sessionId: string
  contexts: SessionContext[]
}
/** A native runner connected — a new enrollment, or a known runner returning from
 *  offline (its durable identity re-bound). Carries the full runner record so the
 *  registry cache can upsert it without a refetch. */
export interface RunnerConnectedEvent {
  type: 'runner.connected'
  runner: Runner
}
/** A native runner disconnected. Its identity persists (marked offline) so a later
 *  reconnect re-binds; the UI shows it offline rather than dropping it. */
export interface RunnerDisconnectedEvent {
  type: 'runner.disconnected'
  runnerId: string
}
/** An online runner re-advertised its capabilities (a grant added or revoked). */
export interface RunnerCapabilitiesChangedEvent {
  type: 'runner.capabilities.changed'
  runner: Runner
}
/** A capability effect was projected into the server's record (D2) — from a
 *  relayed invoke or a synced outbox. Broadcast so every client's view of that
 *  runner's effect log converges without polling. */
export interface RunnerEffectEvent {
  type: 'runner.effect'
  effect: CapabilityEffect
}
/** A resource's reservation ledger changed (D5) — a reservation was acquired,
 *  committed, released, or the capacity was set. Carries the resource id so a
 *  client watching that resource's lock state re-reads it. */
export interface ReservationChangedEvent {
  type: 'reservation.changed'
  resourceId: string
}

/** The Dispatch feed changed — a one-off dispatch was kicked off, or one finished.
 *  The feed is small, so the client just re-reads it whole. */
export interface DispatchChangedEvent {
  type: 'dispatch.changed'
}

/** A new entry landed in the detective audit trail (D15/OQ7) — a cross-user effect was
 *  recorded (fulfilled or denied). Carries the entry so a watching client refreshes the
 *  Audit surface. */
export interface AuditEntryEvent {
  type: 'audit.entry'
  entry: AuditEntry
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
  | MessageRelationsEvent
  | MessageEscalationEvent
  | MessageToolActivityEvent
  | MessageEndEvent
  | RunStartedEvent
  | RunProgressEvent
  | RunFinishedEvent
  | RelationAppliedEvent
  | RecentsChangedEvent
  | ConnectorStatusEvent
  | SessionUpdatedEvent
  | SessionContextsChangedEvent
  | RunnerConnectedEvent
  | RunnerDisconnectedEvent
  | RunnerCapabilitiesChangedEvent
  | RunnerEffectEvent
  | ReservationChangedEvent
  | DispatchChangedEvent
  | AuditEntryEvent

export type ServerEventType = ServerEvent['type']

/** Reply-stream events appear only in a `POST …/messages` SSE body; the rest are
 *  ambient. Handy for the client router and for server-side typing. */
export type ReplyStreamEvent =
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageRelationsEvent
  | MessageEscalationEvent
  | MessageToolActivityEvent
  | MessageEndEvent
