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
import type { Connector, EscalationProposal, Message, ToolActivity } from './entities.ts'
import type { ScheduledRun } from './cowork.ts'
import type { RelationOp } from './relations.ts'
import type { AuditEntry } from './audit.ts'
import type { ContextTypeId, SessionContext } from './contexts.ts'
import type { Runner, CapabilityEffect } from './agents.ts'

/** ── Reply-stream events (one assistant turn) ── */
export interface MessageStartEvent {
  type: 'message.start'
  sessionId: string
  /** The server-owned turn this stream views (contract/turns.ts) — the handle
   *  for cancel and reattach. Optional: absent from pre-turn-registry payloads. */
  turnId?: string
  /** The shell of the assistant message; `content` fills in via deltas. */
  message: Message
}
export interface MessageDeltaEvent {
  type: 'message.delta'
  sessionId: string
  messageId: string
  /** Per-turn frame sequence (monotonic). A reattaching client passes the highest
   *  seq it applied as `?after=` and dedupes any overlap — retransmission can
   *  never double-apply text (invariant I4). Optional for the same reason. */
  seq?: number
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
  /** The tenant that applied the edit (F2/PD9) — the SSE fan-out delivers a relation
   *  event only to its own tenant, so an edit (and the project/session/agent names its
   *  op payload carries) never leaks cross-tenant. Unset ⇒ the backend's default tenant
   *  (desktop / the mock backend's single tenant). */
  tenantId?: string
}
/** Public Project metadata or visibility changed. No prose, actor, owner, or
 * audience identifiers cross this invalidation-only wire. `public` means the
 * project was public before OR after the change, so unsharing can evict open
 * visitor views. `readers` is checked against current ownership/grants on live
 * delivery and replay; the hint itself never grants read or write authority. */
export interface ProjectChangedEvent {
  type: 'project.changed'
  projectId: string
  scope: 'public' | 'readers'
}
/** A type's recents list changed (e.g. attached on another device/tab). */
export interface RecentsChangedEvent {
  type: 'recents.changed'
  contextType: ContextTypeId
  ids: string[]
  /** Owning viewer namespace; absent means the backend's legacy/default tenant. */
  tenantId?: string
}
/** A connector / MCP server's auth or setup state changed (OAuth callback completed,
 *  token expired, admin revoked). Emitted by `store.setConnectorStatus` — the
 *  Contexts page connect / disconnect, and the seam a real OAuth callback would use. */
export interface ConnectorStatusEvent {
  type: 'connector.status'
  id: string
  status: 'connected' | 'needs-auth'
  /** Owning viewer namespace; prevents setup/auth state leaking over SSE. */
  tenantId?: string
}
/** A saved context was ADDED to or REMOVED from the set-up registry (the Contexts
 *  page's Add / Remove — status flips ride `connector.status` above). Carries only
 *  the id (the row is gone on a remove); clients re-read the snapshot. */
export interface SavedContextChangedEvent {
  type: 'savedcontext.changed'
  id: string
  /** Owning viewer namespace; required even on delete because the row is gone. */
  tenantId?: string
}
/** The minimum identity an invalidation hint needs. Session updates can follow
 *  arbitrarily long conversations, so an ambient event must never echo or retain
 *  the transcript it is telling clients to refetch. `tenantId` is the push-side
 *  visibility stamp; an absent value keeps the seed/default-tenant semantics. */
export interface SessionEventRef {
  id: string
  tenantId?: string
}
/** A session's persisted summary changed (title, preview, updatedAt) — e.g.
 *  after a turn — so readers invalidate and refetch through their bounded door. */
export interface SessionUpdatedEvent {
  type: 'session.updated'
  session: SessionEventRef
}
/** A session was DELETED — the definitive gone-signal (a `session.updated`
 *  can't say "removed": its receiver only refetches lists, and a run session
 *  isn't in any list to vanish from). Carries the same minimal identity ref so
 *  the fan-out's tenant gate works after the row is gone. Receivers prune every
 *  pane hosting it (live prune) and invalidate its caches. */
export interface SessionRemovedEvent {
  type: 'session.removed'
  session: SessionEventRef
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

/** A Session provider's drain loop bound — its connector presented the rendezvous
 *  secret on a poll (binding IS presenting the secret; there is no enrollment
 *  protocol — docs/delegated-cognition-provider.md §7.3). The provider's dot goes
 *  green; the client re-reads the providers list for the computed `online` flag. */
export interface RelayConnectedEvent {
  type: 'relay.connected'
  providerId: string
  /** Server-owned routing snapshot. Optional only for legacy/default events. */
  tenantId?: string
}
/** A Session provider went quiet — no parked poll and no in-flight turn for the
 *  TTL (or its secret was rotated / the provider deleted). Dot goes grey; the
 *  durable identity is the provider row, so a later poll re-binds the same id. */
export interface RelayDisconnectedEvent {
  type: 'relay.disconnected'
  providerId: string
  /** Preserves the owner after an atomic Provider removal drops the live row. */
  tenantId?: string
}
/** A relay's in-flight set changed — an entry was DELIVERED to the far session
 *  or SETTLED (answered / timed out / cancelled). The observed half of the v5
 *  serving handshake (docs/delegated-cognition-provider.md §9.4): the client
 *  re-reads the providers list so the serve-time `activeConversations` /
 *  `conversationWindow` stamps stay live — the user can SEE the far session
 *  picking work up and finishing it, no attestation involved. */
export interface RelayActivityEvent {
  type: 'relay.activity'
  providerId: string
  /** Server-owned routing snapshot. Optional only for legacy/default events. */
  tenantId?: string
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

/** A Project's open-work backlog changed (docs/agent-commons.md, D19) — an item was
 *  posted, or standing dispatch resolved one. Carries only the project id; watchers
 *  re-read the backlog (and, on a resolve, the agents list for the D13 credit).
 *  Visibility mirrors the Project's: everyone while shared, owner-only while private. */
export interface OpenWorkChangedEvent {
  type: 'openwork.changed'
  projectId: string
}

/** A Project's contribution ledger changed (Phase A of the contribution workflow,
 *  docs/design/agent-contribution-workflow.md) — one was opened, noted, or landed.
 *  Carries only the project id; watchers re-read the ledger. Visibility mirrors
 *  the Project's, exactly like `openwork.changed`. */
export interface ContributionChangedEvent {
  type: 'contribution.changed'
  projectId: string
}

/** A Project's delegation roster changed (CW8, Phase F) — one was minted or
 *  revoked. Visibility mirrors the Project's, like `contribution.changed`. */
export interface DelegationChangedEvent {
  type: 'delegation.changed'
  projectId: string
}

/** A tenant's notification inbox changed (D24) — a public act fanned out to it, or a
 *  mark-read landed. Targeted: `eventVisibleToTenant` delivers it ONLY to the named
 *  tenant's streams (the `audit.entry` pattern); the client re-reads the inbox. */
export interface NotificationChangedEvent {
  type: 'notification.changed'
  tenantId: string
}

/** One organization invitation moved. The payload carries no raw address or row
 * id. Its opaque address audience exists for known and unknown emails alike, so
 * targeted SSE delivery cannot reveal whether an account already exists. */
export interface OrgInvitationChangedEvent {
  type: 'org.invitation.changed'
  orgId: string
  change: 'issued' | 'accepted' | 'declined' | 'revoked'
  /** Current organization-owner home namespaces. */
  parties: string[]
  /** Opaque normalized-address audience; never an account or tenant id. */
  addressAudience: string
}

/** A routine was created, edited, paused/resumed, or removed (here or on another
 *  client/device) — the schedules list (and the recent-runs feed a delete prunes)
 *  is stale. Carries only the id: the row itself may already be gone on a delete. */
export interface ScheduleChangedEvent {
  type: 'schedule.changed'
  taskId: string
  /** The owning routine's tenant, captured at emit time (F2/PD9) — the SSE gate
   *  reads this, not the (possibly deleted) row. Unset ⇒ the flagship seeds. */
  tenantId?: string
}

/** An artifact's BODY changed — its owner edited a block, or a proposal landed
 *  on it (social S3's `artifact-patch`). The content library every preview reads
 *  is stale (UI-12: the datum has a live source, so it needs a sync path).
 *  Carries the id ALONE: that is what the SSE gate walls on, and the reader
 *  invalidates the one library wholesale rather than a single key — so a name
 *  here would be a field nobody reads (and one the emitter could only fill with
 *  a sentinel for an artifact it can no longer resolve). */
export interface ArtifactChangedEvent {
  type: 'artifact.changed'
  artifactId: string
}

/** An Agent registry row changed. Private configuration activity reaches only
 * its owner; a change that adds, updates, or removes a published directory face
 * is safe and necessary to broadcast to every signed-in directory reader. The
 * owner id is omitted from directory events so a public invalidation never
 * carries a raw tenant identifier. */
export interface AgentChangedEvent {
  type: 'agent.changed'
  agentId: string
  scope: 'owner' | 'directory'
  /** Present only for tenant-owned owner-scoped events. Unset identifies shared
   * registry infrastructure and is visible to every registry reader. */
  tenantId?: string
}

/** A provider definition, connection/catalog, default pointer, credential, or
 * registry membership changed. Tenant-owned rows are owner-scoped; unstamped
 * shared infrastructure is visible to every provider-registry reader. */
export interface ProviderChangedEvent {
  type: 'provider.changed'
  providerId: string
  tenantId?: string
}

/** A system-prompt definition, viewer-default pointer, or registry membership
 * changed. Tenant-owned rows are owner-scoped; unstamped shared infrastructure
 * is visible to every prompt-registry reader. */
export interface SystemPromptChangedEvent {
  type: 'systemprompt.changed'
  systemPromptId: string
  tenantId?: string
}

/** A Project's Contributor roster changed — a commission was minted, re-granted, or
 *  removed, possibly by ANOTHER tenant (the P8 cooperation primitive the acting
 *  client's local invalidation can't cover). Visibility mirrors the Project's,
 *  exactly like `openwork.changed`: everyone while shared, owner-only while private. */
export interface CommissionChangedEvent {
  type: 'commission.changed'
  projectId: string
}

/** A D25 change proposal's lifecycle moved (opened / commented / merged / declined)
 *  — the agent's review queue is stale. Delivered ONLY to the two parties (a
 *  proposal is a private proposer ↔ owner negotiation, never a public feed). */
export interface ProposalChangedEvent {
  type: 'proposal.changed'
  agentId: string
  /** The two parties' tenant ids (owner + proposer), captured at emit time — the
   *  SSE gate delivers the event to exactly these streams. */
  parties: string[]
}

/** A grant on a resource changed (social layer S1) — one was created or revoked.
 *  Delivered ONLY to the parties (granting tenant + audience), the
 *  `proposal.changed` pattern: who can see a resource is a private negotiation
 *  between owner and audience, never a public feed. Watchers re-read the
 *  subject's grants (and, audience-side, their shared-with-me facet). */
export interface GrantChangedEvent {
  type: 'grant.changed'
  subject: import('./social.ts').SocialEntityRef
  /** The parties' tenant ids (granter + audience), captured at emit time — the
   *  SSE gate delivers the event to exactly these streams (org audiences via
   *  the member-read union). */
  parties: string[]
}

/** A discussion changed (social S2) — opened, posted to, reacted on, or
 *  resolved. Carries only the discussion id + its anchor; watchers re-read.
 *  Visibility MIRRORS THE ANCHOR's (owner / granted / shared ⇒ delivered) —
 *  the `openwork.changed` pattern generalized to the social nouns. */
export interface DiscussionChangedEvent {
  type: 'discussion.changed'
  discussionId: string
  anchor: import('./social.ts').SocialAnchor
}

/** A viewer's private DM read cursor changed. It names no thread: advancing one
 * cursor can evict another bounded mark, so every device re-derives its inbox
 * and open discussion projections. Exact-tenant delivery prevents this from
 * becoming a read receipt for the other party. */
export interface DiscussionReadsChangedEvent {
  type: 'discussion-reads.changed'
  tenantId: string
}

/** A social proposal changed (S3) — offered, landed, or declined. Visibility
 *  MIRRORS THE SUBJECT's read wall, like `discussion.changed`. (Distinct from
 *  `proposal.changed`, the D25 agent-definition review queue.) */
export interface SocialProposalChangedEvent {
  type: 'social-proposal.changed'
  proposalId: string
  subject: import('./social.ts').SocialEntityRef
}

/** A follow changed (social S7) — one principal started or stopped following
 *  another. Delivered ONLY to the two parties (follower + followee), the
 *  `grant.changed` pattern: who follows whom is not a public broadcast, and the
 *  follower re-reads their list + the Commons' Following lens while the
 *  followee re-reads their profile counts. */
export interface FollowChangedEvent {
  type: 'follow.changed'
  /** The two parties' tenant ids, captured at emit time — the SSE gate delivers
   *  the event to exactly these streams. */
  parties: string[]
}

/** A viewer changed whether one visible resource reaches their notification
 * inbox. This is private preference state: the tenant stamp gates the subject
 * identity to exactly the account whose Watch control and Commons lens moved. */
export interface WatchChangedEvent {
  type: 'watch.changed'
  tenantId: string
  subject: import('./social.ts').SocialEntityRef
}

/** One Commons item's public endorsement aggregate changed. Visibility mirrors
 * the subject: every permitted reader refreshes the count, while each response
 * derives its own private `liked` membership. */
export interface CommonsLikeChangedEvent {
  type: 'commons-like.changed'
  itemId: string
  subject: import('./social.ts').SocialEntityRef
}

/** Sent once when an SSE channel opens, so the client can confirm liveness. */
export interface HelloEvent {
  type: 'hello'
  /** Monotonic server boot id — a change means the server restarted (state was
   *  reseeded), so the client should refetch rather than trust its cache. */
  epoch: string
  /** The stream's current position (the global event sequence — multi-account
   *  design §5.3, invariant I3). Absent on pre-eventlog servers. */
  seq?: number
  /** True when the server replayed the events this subscriber missed (its
   *  `Last-Event-ID` was still inside the ring buffer): the client's cache is
   *  continuous and needs no reset. False/absent on a fresh subscribe OR when
   *  the gap aged out of the buffer — a client that had a previous connection
   *  must then drop its cache and refetch (loss is impossible: replayed or
   *  fully resynced). */
  resumed?: boolean
  /** The identity the server resolved for THIS stream (multi-account design
   *  §5.5, invariant I5) — the SSE face of the `x-resolved-tenant` echo. The
   *  client asserts it matches the account it believes it's acting as, turning
   *  an identity-routing bug into a loud local error instead of silent
   *  cross-account contamination. */
  identity?: { userId: string; tenantId: string }
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
  | ProjectChangedEvent
  | RecentsChangedEvent
  | NotificationChangedEvent
  | OrgInvitationChangedEvent
  | ConnectorStatusEvent
  | SavedContextChangedEvent
  | SessionUpdatedEvent
  | SessionRemovedEvent
  | SessionContextsChangedEvent
  | RunnerConnectedEvent
  | RunnerDisconnectedEvent
  | RunnerCapabilitiesChangedEvent
  | RunnerEffectEvent
  | ReservationChangedEvent
  | RelayConnectedEvent
  | RelayDisconnectedEvent
  | RelayActivityEvent
  | DispatchChangedEvent
  | AuditEntryEvent
  | OpenWorkChangedEvent
  | ContributionChangedEvent
  | DelegationChangedEvent
  | ScheduleChangedEvent
  | ArtifactChangedEvent
  | AgentChangedEvent
  | ProviderChangedEvent
  | SystemPromptChangedEvent
  | CommissionChangedEvent
  | ProposalChangedEvent
  | GrantChangedEvent
  | DiscussionChangedEvent
  | DiscussionReadsChangedEvent
  | SocialProposalChangedEvent
  | FollowChangedEvent
  | WatchChangedEvent
  | CommonsLikeChangedEvent

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
