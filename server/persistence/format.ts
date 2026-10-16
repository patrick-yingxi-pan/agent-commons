/** ── The persisted format: shape, version, slice manifest, locations, port ────
 *  A *leaf* module (no back-edges into the rest of `server/`) so the backends
 *  (`json.ts`, `sqlite.ts`) and the facade (`server/persistence/persist.ts`) can all import it
 *  without an import cycle. It defines:
 *    • `PersistedState` — the store's mutable, UI-owned state on disk,
 *    • `STORE_VERSION` — the data-schema version (unsupported ⇒ startup refuses),
 *    • `SLICE_KIND` — how each top-level slice maps onto a relational shape
 *      (singleton / array / map-entries), shared by every backend,
 *    • `dataFile()` / `databaseFile()` — where each backend keeps its bytes,
 *    • `PersistenceBackend` — the port both backends implement. */
import { isAssistantTextItems } from '../../contract/assistantTextItems.ts'
import type {
  Agent,
  AgentChangeProposal,
  ApiToken,
  ArtifactContent,
  A2aPeer,
  AppNotification,
  AuditEntry,
  Commission,
  Contribution,
  ContributionEvent,
  Delegation,
  Discussion,
  DiscussionPost,
  DispatchRun,
  Grant,
  OpenSubGoal,
  ModelProvider,
  PrincipalRef,
  ProjectRole,
  RecentsSnapshot,
  RelationGraph,
  SavedContext,
  ScheduledTask,
  SocialProposal,
  Session,
  SessionContext,
  SessionPreferences,
  SessionWorkspace,
  SocialEntityRef,
  SystemPromptEntry,
  WorkItemComment,
} from '../../contract/index.ts'
import { isAttachmentInput } from '../../contract/attachmentInput.ts'
import { validDispatchState } from '../dispatchState.ts'
import { validStoredReviews, type StoredContributionReview } from '../contributionReviewState.ts'
import { validStoredJudgments, type StoredDelegatedJudgment } from '../delegatedJudgmentState.ts'
import { normalizedEnvelopeProposalLines, envelopeProposalLinesMatch, type NormalizedEnvelopeProposalLine, type StoredContributionEnvelope, type StoredContributionEnvelopeLine } from '../contributionEnvelope.ts'
import { contributionEffectConsumesSlot, CONTRIBUTION_EFFECT_ATTEMPT_MAX, parseStoredContributionEffectAttempt, type StoredContributionEffectAttempt } from '../contributionEffectState.ts'
import { snapshotMcpBoundToolCall } from '../mcpBoundCall.ts'
import { PROJECT_EFFECT_TYPES } from '../../contract/coordination.ts'
import { CONTRIBUTION_FIELD_MAX, EFFECT_ENVELOPE_CARDINALITY_MAX, EFFECT_ENVELOPE_LINE_MAX, ENVELOPE_HARNESSES } from '../../contract/contributions.ts'
import { validStoredDelegations, validDelegationRetirements } from '../delegationPolicy.ts'
import { imageAssetRefMatches } from '../../contract/imageAssets.ts'
import { validProjectWorkPersistence } from '../projectWorkPersistence.ts'
import type { ImageAssetRef } from '../../contract/imageAssets.ts'
import { isServedImageSnapshot } from '../../contract/servedImageSnapshot.ts'
import { validWorkspaceFolders } from '../../contract/workspaceFolders.ts'
import { rehydrateImageAssets, type ImageAssetRow } from '../imageAssets.ts'
import { parseArtifactMetadataEntries } from '../artifactMetadata.ts'
import { parseArtifactLifecycleEntries } from '../artifactLifecycle.ts'
import type { ArtifactLifecycle } from '../../contract/artifactLifecycle.ts'
import { parseArtifactHistoryEntries, historyBodyWithoutRevision, type ArtifactHistoryEntries } from '../../contract/artifactHistory.ts'
import type { StoredArtifactHistoryRestoreReceipt } from '../artifactHistory.ts'
import { parseArtifactRetirements, parseArtifactDeletionReceipts, type ArtifactRetirement, type StoredArtifactDeletionReceipt } from '../artifactDeletion.ts'
import { parseStructuredArtifactBody } from '../../contract/artifactAuthoring.ts'
import type { ArtifactMetadata } from '../../contract/artifactMetadata.ts'
import type { ProviderConfig } from '../data/providers.ts'
import type {
  AccountUser,
  AccountTenant,
  Membership,
  StoredApiTokenMintReceipt,
  StoredOrgInvite,
} from '../accounts.ts'
import type { InitialWorld } from '../initialWorld.ts'
import { parseMcpConnectionState, type McpConnectionState } from '../mcpConnections.ts'
import { parseMcpActivityAuthorities, validateMcpActivityAuthorities, type McpActivityAuthority } from '../mcpActivityAuthority.ts'
import { parseAgentOwnership, validateAgentOwnershipJoins, type AgentOwnership } from '../agentOwnership.ts'
import { parseProxyRequests, validateProxyRequestJoins } from '../proxyRequestRegistry.ts'
import { proxyArgumentReservationId } from '../proxyArgumentDraftState.ts'
import { proxyReplyReservationId } from '../proxyReplyDraftState.ts'
import type { StoredProxyRequest } from '../proxyRequestState.ts'
import { parseMcpInputFlows, validateMcpInputFlows, type McpInputFlow } from '../mcpInputState.ts'
import { validateContributionMcpAuthorities } from '../contributionMcpAuthority.ts'
import { parseRoutineMcpRegistryState, validateRoutineMcpRegistryJoins, type RoutineMcpRegistryState } from '../routineMcpRegistry.ts'
import { validateRoutineMcpAuthorities } from '../routineMcpAuthority.ts'
import { parseCommissionMcpRegistryState, type CommissionMcpRegistryState } from '../commissionMcpRegistry.ts'
import { validateCommissionMcpRegistryJoins } from '../commissionMcpAuthority.ts'
import { parseUsageMeterEntries, parseUsageReservations, type UsageMeterEntries, type UsageReservationState } from '../usageRegistry.ts'
import { parseScheduleStanding } from '../scheduleStanding.ts'
import { parseScheduledArtifactSpec } from '../../contract/scheduledArtifact.ts'
import { isProjectContextSource } from '../../contract/cowork.ts'
import { parseMcpToolResult } from '../mcpToolResult.ts'
import { parsePersistedModelPreferences, type PersistedModelPreferences } from '../modelPreferences.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { isReplyOutputTokens } from '../../contract/providerReplyLimits.ts'
import type { AgentRequestArgumentDraft, AgentRequestReplyDraft } from '../../contract/agentRequests.ts'
import { join } from 'node:path'
import { persistencePath } from './persistencePath.ts'

/** On-disk schema version. A supported older snapshot migrates forward; an
 *  unsupported/newer snapshot stops startup without changing its bytes.
 *  v2: the "time ago" stamps moved from frozen display strings to absolute epoch-ms
 *  timestamps (artifact.editedAt, project.updatedAt, savedContext.lastUsedAt) and
 *  session.updatedLabel was dropped.
 *  v3: ScheduledRun followed suit — `when`/`absolute` strings dropped and `at`
 *  changed from minutes-ago to an absolute epoch-ms; a v2 snapshot has no safe
 *  automatic migration and now requires explicit recovery rather than reseeding.
 *  v4: the Agent Commons registries (providers + their server-only configs, the
 *  system-prompt library, worker agents, commissions) and their id counters joined
 *  the snapshot, so an agent / provider / prompt / commission created or edited
 *  through the Agents hub (or proposed by Claude and confirmed) survives a restart
 *  rather than reverting to the seed; a v3 snapshot lacks them and requires recovery.
 *  v5: `AuditEntry` gained a required `tenantId` (the audit trail is tenant-scoped,
 *  F5/PD9). A v4 snapshot's audit entries predate the field, so a forward-only data
 *  migration (`DATA_MIGRATIONS`, server/persistence/migrate.ts) backfills them to the
 *  personal tenant on load — the first real migration, replacing discard-and-reseed for
 *  this bump so a restored store keeps its audit history.
 *  Older versions without a migration path fail startup closed.
 *  (Dispatch runs joined as an *additive optional* slice — `dispatch?` + `seq.dispatch?` —
 *  so a v5 snapshot without them loads cleanly (rehydrate keeps the seed feed); no bump,
 *  matching how `savedContexts?` / `auditLog?` were added.) */
export const STORE_VERSION = 7

/** A notification as STORED — the wire row plus three server-private anchors the
 *  read strips (the caller sees a plain `AppNotification`).
 *
 *  `tenantId` is the RECIPIENT. The other two exist because a bell is a POINTER
 *  at an act, and a pointer must survive what happens to the thing it points at:
 *
 *  • `actorTenant` — the ACTOR's raw id, so the row's `actor` display name can be
 *    re-derived when a namespace is renamed (`refreshStoredNames`). Every other
 *    social row already pairs a public name with its authority id
 *    (`granterTenant`, `openerTenant`, `authorTenant`); the inbox was the one
 *    that did not, and it showed: after the 2026-08-09 seed rename the bell said
 *    "Acme, Inc. replied to your post" while the post it doored into was signed
 *    "Ada Lovelace" — the same person named two ways across one click.
 *
 *  • `postId` — the exact discussion post the bell ANNOUNCES. Without it a
 *    retracted post left its bell standing: the inbox went on claiming a reply
 *    that no longer existed, and the door landed in a thread where the reader
 *    could not find it. `discussionId` cannot stand in — a thread carries many
 *    posts, and dropping every bell for the thread would silence the survivors.
 *
 *  Both additive-optional. A row written before them is simply not retractable;
 *  an arbitrary actor name keeps the name it was minted with (the honest
 *  degrade), while the six code-owned seed aliases retired by the namespace
 *  rename recover their exact tenant id through `recoverSeedBellActors` and are
 *  then refreshed like every newer row. */
export interface StoredNotification extends AppNotification {
  tenantId: string
  actorTenant?: string
  postId?: string
}

/** A thread comment as STORED — the wire row plus the acting principal (FWD-5
 *  Phase 1). Server-private; the projection strips it and serves only `authorKind`. */
export type StoredWorkItemComment = WorkItemComment & {
  principal?: PrincipalRef
  /** Exact private authority proof for keyed comment acknowledgement. */
  authorTenant?: string
}

/** A work item as STORED (D19) — the wire row plus the poster's RAW tenant id (the
 *  strict retract-authorization anchor: display names are attacker-controlled, so
 *  authorization compares tenant ids — the D23 lesson) and the acting principals of
 *  its post / retract acts (FWD-5 Phase 1). Server-private; `publicOpenSubGoal`
 *  strips all of it and serves only the display names + principal KINDs. */
export interface StoredOpenSubGoal extends Omit<OpenSubGoal, 'comments'> {
  postedByTenant?: string
  postedByPrincipal?: PrincipalRef
  /** Private acknowledgement anchor for a keyed native retraction. */
  retractionId?: string
  /** Raw authority anchor paired with `retractionId`; legacy/A2A rows may omit it. */
  retractedByTenant?: string
  retractedByPrincipal?: PrincipalRef
  comments?: StoredWorkItemComment[]
}

/** A change proposal as STORED (D25) — the wire row plus the proposer's RAW tenant
 *  id: the strict authorization anchor (the D23 lesson — write authorization compares
 *  tenant ids, never spoofable display names) — and the acting principal (FWD-5
 *  Phase 1). Server-private; every read strips both. */
export interface StoredAgentProposal extends Omit<AgentChangeProposal, 'comments'> {
  proposedByTenant: string
  proposedByPrincipal?: PrincipalRef
  /** Raw authority anchor paired with a public keyed-verdict receipt. */
  verdictByTenant?: string
  comments?: StoredWorkItemComment[]
}

/** A Contribution as STORED (contribution workflow Phase A) — the wire row plus
 *  the contributor's RAW tenant id (the strict land-authorization anchor — the
 *  D23 lesson: display names are attacker-controlled, authorization compares
 *  tenant ids) and the acting principals. Server-private; `publicContribution`
 *  strips all of it and serves display names + principal KINDs only. */
export interface StoredContribution extends Omit<Contribution, 'events' | 'reviews' | 'judgments' | 'effects' | 'envelope' | 'workItemResolution'> {
  reviewAttempts?: StoredContributionReview[]
  judgmentAttempts?: StoredDelegatedJudgment[]
  effectAttempts?: StoredContributionEffectAttempt[]
  envelope?: StoredContributionEnvelope
  contributorTenant?: string
  contributorPrincipal?: PrincipalRef
  /** Private acknowledgement anchor for a keyed native landing. */
  landingId?: string
  /** Raw authority anchor paired with `landingId`; legacy/delegated rows may omit it. */
  landedByTenant?: string
  events: StoredContributionEvent[]
}

/** A contribution timeline event as STORED — the wire row plus the acting
 * principal (FWD-5). Effect, crystallization, review, and envelope receipts retain the
 * raw retry authority and any exact private proof; projection strips it. */
export type StoredContributionEvent = ContributionEvent & {
  principal?: PrincipalRef
  notedByTenant?: string
  reviewedByTenant?: string
  reviewRequiredByTenant?: string
  /** Private authority proof for a keyed delegated-judgment acknowledgement. */
  delegatedByTenant?: string
  effectByTenant?: string
  effectResult?: 'executed' | 'unapproved' | 'refused'
  crystallizedByTenant?: string
  approvedByTenant?: string
  proposedByTenant?: string
  /** Canonical authored payload and compare boundary for durable proposal
   * replay. Private because the current/superseded public story belongs to the
   * envelope and timeline, not to transport metadata. */
  envelopeProposalLines?: NormalizedEnvelopeProposalLine[]
  envelopeProposalExpectedVersion?: number
  /** Private OAuth provenance survives replacement of the current envelope
   * and requires a retained exact connection identity, even with no attempts. */
  envelopeProposalOwnerUserId?: string
}

/** A Delegation as STORED (CW8, Phase F) — the wire row plus the DELEGATOR's
 *  raw tenant id (the conservation-law anchor: the delegated decision executes
 *  as this tenant, and authorization compares raw ids — the D23 lesson). The
 *  projection strips it; `policy` is served to the delegator only. */
export interface StoredDelegation extends Omit<Delegation, 'mine' | 'expired'> {
  delegatorTenant: string
}

/** Private tombstone for a removed Delegation. Every keyed grant is retained so
 * a delayed create Retry cannot restore revoked authority. A keyed revocation
 * also records its opaque operation receipt and exact immutable precondition,
 * allowing response-cache loss and process restart to replay only that act. */
export interface StoredDelegationRetirement {
  delegationId: string
  projectId: string
  createdAt: number
  revocationId?: string
  revokedByTenant?: string
  expectedCreatedAt?: number
  expectedRevision?: number
}

/** A Grant as STORED (social layer S1) — the wire row plus the GRANTER's raw
 *  tenant id (authorization compares raw ids — the D23 lesson) and, for a
 *  principal audience, the audience's raw tenant id. The projection
 *  (`publicGrant`) serves display names; raw foreign ids never cross. */
export interface StoredGrant extends Grant {
  granterTenant: string
  /** The audience resolved to a tenant id (principal → their namespace; org →
   *  the org tenant) — what the SSE gate and shared-with-me reads key on.
   *  Empty for LINK grants (S6), whose audience is whoever redeemed. */
  audienceTenant: string
  /** LINK grants (S6): the tenants that redeemed the token — server-private
   *  (the wire never lists who clicked a link). */
  redeemedBy?: string[]
}

/** A Discussion as STORED (social S2) — the wire row minus the viewer-relative
 *  fields, plus the OPENER's raw tenant id and each post's raw author tenant +
 *  the reacting tenants (a Set serialized as an array). The projection
 *  (`publicDiscussion`) strips all of it: display names + counts only. */
export interface StoredDiscussionPost extends Omit<DiscussionPost, 'reactions' | 'reacted' | 'reported'> {
  authorTenant: string
  reactedBy: string[]
  /** Private durable report receipt set; absent on legacy rows means none. */
  reportedBy?: string[]
  /** S7 — a monotonic ordinal within the thread, assigned once at creation and
   *  never reused. It is what a per-viewer READ MARK points at.
   *
   *  Not the array index: posts are deletable (S5), and a mark that is an index
   *  silently shifts when the array shrinks — read 5, one retracted, two new,
   *  and the reader is told 1 unread instead of 2. Not the timestamp either:
   *  two posts can share a millisecond, and `at > mark` then hides the second.
   *  An ordinal is stable under deletion and has no ties.
   *
   *  Additive-optional: a post written before this field reads as ordinal 0, so
   *  a pre-S7 snapshot shows its threads unread rather than silently read. */
  seq?: number
}
export interface StoredDiscussion extends Omit<Discussion, 'posts' | 'mine' | 'stateRevision'> {
  openerTenant: string
  /** Optional only on disk: public projection maps legacy absence to 0. */
  stateRevision?: number
  /** S7 — a PRINCIPAL-anchored thread (a DM) also stores the raw tenant id of
   *  the person it was addressed TO, captured when the thread was opened.
   *
   *  The anchor itself carries a DISPLAY NAME, because that is the public face
   *  every social payload wears. But a name is not an identity: `createUser`
   *  guards uniqueness on EMAIL, not name, so two workspaces can wear the same
   *  one — and this repo's own earned rule (src/lib/social-ui.test.ts) is that
   *  preference may key on a name while AUTHORITY never may. A DM's wall is
   *  authority, so resolving "who are the two parties" by name at read time
   *  would let a later signup wearing the same display name change who a
   *  private conversation belongs to. Captured once, at open, like
   *  `openerTenant` / `authorTenant` / `granterTenant` beside it.
   *
   *  Additive-optional: a row written before this field falls back to the name
   *  lookup, which is what it did anyway. `publicDiscussion` strips it. */
  targetTenant?: string
  posts: StoredDiscussionPost[]
}

/** A social Proposal as STORED (S3) — the wire row plus the OFFERER's raw
 *  tenant id (authorization compares raw ids). `publicSocialProposal` strips it. */
export interface StoredSocialProposal extends Omit<SocialProposal, 'mine' | 'deltaBase' | 'stale'> {
  offererTenant: string
  /** Applying deltas freeze the target domain's revision at offer time. Absent
   *  is the legacy unconditional form for snapshots written before PD80. */
  baseRevision?: number
  /** `artifact-patch` only: the reviewed block pre-image at offer time. */
  offeredBase?: string
  /** `artifact-patch` only: the block's text as it stood the instant this
   *  proposal LANDED — the pre-image, frozen because a landed row is history
   *  and the body has since moved on. Serves as `SocialProposal.deltaBase` for
   *  landed rows, while an open one resolves its base live. Absent on every
   *  other state and delta kind (INV-9). */
  appliedBase?: string
}

/** A peer as STORED (D28) — the wire row plus the credential's SHA-256 (the
 *  relay-secret pattern: the token is shown once at mint; only its hash persists). */
export interface StoredA2aPeer extends A2aPeer {
  tokenHash: string
}

/** The persisted shape — the store's mutable, UI-owned state. Maps are stored as
 *  entry arrays (JSON has no Map). The id counters ride along so minted ids don't
 *  collide with persisted ones after a restart. */
export interface PersistedState {
  version: number
  /** Which authored baseline this database began from. Additive-optional so
   * historical snapshots (all demo worlds) remain readable; every new writer
   * stamps it. The stored value, never today's environment, governs rehydrate. */
  initialWorld?: InitialWorld
  sessions: Session[]
  /** Durable tombstones for keyed human Session creation, including drafts and
   * branches. They prevent a late Retry from resurrecting a row that was
   * explicitly removed on another device. Additive-optional so older snapshots
   * begin with no retired keys. */
  retiredSessionCreationIds?: string[]
  bindings: [string, SessionContext[]][]
  workspaces: [string, SessionWorkspace][]
  /** Per-user, per-session presentation intent. Nested map entries keep viewer
   * preferences out of the shared Session row. Additive-optional so older
   * snapshots load with the product default. */
  sessionPreferences?: [string, [string, SessionPreferences][]][]
  /** Per-namespace, per-person model composer intent. Scope fields are supplied
   * by authenticated reads; nested storage keys avoid trusting duplicated JSON. */
  modelPreferences?: PersistedModelPreferences
  /** Recorded usage and period anchors, tenant-scoped. Absent older snapshots
   * migrate once from their demo/clean baseline; present malformed data refuses. */
  usageMeters?: UsageMeterEntries
  schedules: ScheduledTask[]
  /** Legacy/default tenant's context MRU lists. Kept as the canonical default
   * partition for backward compatibility with every pre-tenancy snapshot. */
  recents: RecentsSnapshot
  /** Non-default viewer partitions for context MRU lists. Additive-optional;
   * absence means only the legacy/default partition existed. */
  recentsByTenant?: [string, RecentsSnapshot][]
  graph: RelationGraph
  /** Saved-context auth status (Contexts page connect/disconnect). Optional so a
   *  snapshot written before this field loads cleanly (the store defaults to seed).
   *  Runtime rows carry a server-owned tenant stamp; unstamped seed/legacy rows
   *  belong to the default tenant. */
  savedContexts?: (SavedContext & { tenantId?: string })[]
  /** The Agent Commons registries (docs/agent-commons.md, D6/D9/D10/D7) — stored as
   *  Map entry arrays. Each is optional so a snapshot written before the slice existed
   *  loads cleanly (rehydrate keeps the seed when absent). Providers ride with their
   *  server-only `ProviderConfig` (the concrete model id), keyed in lock-step, so a
   *  restored provider still resolves the model it was created with. */
  providers?: [string, ModelProvider][]
  providerConfigs?: [string, ProviderConfig][]
  systemPrompts?: [string, SystemPromptEntry][]
  /** Per-tenant default-flag pointers for the provider / prompt registries — the UI
   *  pre-selection shortcut (`isDefault` is stamped from these at serve time, never
   *  stored on the entities). Additive-optional: a pre-field snapshot loads cleanly
   *  with no defaults flagged (pickers fall back to the first entry). */
  registryDefaults?: [string, { providerId?: string; promptId?: string }][]
  agents?: [string, Agent][]
  /** Private immutable person provenance, with retirement retained for history.
   * Legacy absence stays unbound; this is never a live execution grant. */
  agentOwnership?: AgentOwnership[]
  /** Exact person-private request history; legacy absence means no requests. */
  agentRequests?: StoredProxyRequest[]
  /** Durable tombstones for keyed Agent creation and Agent forks. A delayed
   * Retry cannot recreate a definition explicitly removed on another device. */
  retiredAgentCreationIds?: string[]
  commissions?: [string, Commission][]
  /** Per-Project D13 commission caps, as `[projectId, cap]` overlays onto the seed
   *  Projects (which are otherwise re-seeded, not persisted). Optional so a snapshot
   *  written before the field loads cleanly (no caps); only Projects with a cap set
   *  appear. Keeps a conversationally-set cap (the shared confirm card) across a restart. */
  commissionCaps?: [string, number][]
  /** Per-Project D14 default contributor roles — the commissioning pickers' pre-selection
   *  (a UI shortcut, INV-9). Same seed-overlay shape as `commissionCaps`: only seed
   *  Projects carrying one appear; a created Project's rides the `graph` slice. */
  projectDefaultRoles?: [string, ProjectRole][]
  /** The detective audit trail (D15/OQ7). Optional so a pre-field snapshot loads cleanly
   *  (an empty trail); append-only, so the watch survives a restart. */
  auditLog?: AuditEntry[]
  /** One-off dispatch runs (P7). Optional so a pre-field snapshot loads cleanly (rehydrate
   *  keeps the seed feed); a live run persists so it survives a restart, and a run left
   *  `running` when the process died is swept to `failed` on rehydrate (crash recovery). */
  dispatch?: DispatchRun[]
  /** The Project open-work backlog (docs/agent-commons.md, D19) — posted work items,
   *  open and resolved. Additive-optional like `dispatch` (a pre-field snapshot loads
   *  cleanly with an empty backlog). Dispatch itself is synchronous at post time, so
   *  nothing in-flight ever needs recovering — only the items persist. */
  openSubGoals?: StoredOpenSubGoal[]
  /** The Project contribution ledgers (agent-contribution workflow Phase A) —
   *  open and landed contributions, timelines inline. Additive-optional like
   *  `openSubGoals` (a pre-field snapshot loads cleanly with empty ledgers). */
  contributions?: StoredContribution[]
  /** The Project delegation rosters (CW8, Phase F). Additive-optional like
   *  `contributions` (a pre-field snapshot loads cleanly with none). */
  delegations?: StoredDelegation[]
  /** Private authority tombstones and exact keyed-revocation receipts. */
  delegationRetirements?: StoredDelegationRetirement[]
  /** Social-layer grants (S1) — who can see/do what on which resource.
   *  Additive-optional like `delegations` (a pre-field snapshot loads with
   *  nothing shared). */
  grants?: StoredGrant[]
  /** Social-layer discussions (S2) — anchored threads, posts inline.
   *  Additive-optional like `grants`. */
  discussions?: StoredDiscussion[]
  /** Social-layer proposals (S3) — offered changes + the per-subject ledger.
   *  Additive-optional like `discussions`. */
  socialProposals?: StoredSocialProposal[]
  /** Artifact BODY edits (social S3's `artifact-patch`) — `[artifactId, body]`
   *  pairs laid over the authored fixture. Keyed by ID, never by the library's
   *  file name, so a restored snapshot can't move one tenant's revision onto a
   *  same-named artifact in another. Additive-optional like `socialProposals`
   *  (a pre-field snapshot loads with every body at its authored text). */
  artifactBodies?: [string, ArtifactContent][]
  /** Append-only owner-visible body history; absent on older snapshots. */
  artifactHistory?: ArtifactHistoryEntries
  /** Private exact restore receipts; keys and principal anchors never cross API projections. */
  artifactHistoryRestoreReceipts?: [string, StoredArtifactHistoryRestoreReceipt][]
  /** Independent display names, ordered by metadata revision rather than body revision. */
  artifactMetadata?: [string, ArtifactMetadata][]
  /** Recoverable Trash ordering. Retained rows and bodies remain canonical. */
  artifactLifecycle?: [string, ArtifactLifecycle][]
  /** Permanent Artifact retirement tombstones prevent fixture/keyed/provenance resurrection. */
  artifactRetirements?: ArtifactRetirement[]
  /** Exact owner-scoped lost-ack receipts for permanent deletion. */
  artifactDeletionReceipts?: [string, StoredArtifactDeletionReceipt][]
  /** S5 guardrails — per-viewer mute lists (`[tenantId, names[]]`).
   *  Additive-optional. */
  mutes?: [string, string[]][]
  /** S7 — per-viewer FOLLOW lists (`[tenantId, followee names[]]`), the same
   *  shape as `mutes` because it is the same kind of thing: a standing,
   *  name-keyed relationship the viewer holds. Additive-optional. */
  follows?: [string, string[]][]
  /** S7 — per-viewer discussion read marks (`[tenantId, [discussionId, posts
   *  seen][]]`), feeding the DM inbox's unread count. Derived, disposable state
   *  (losing it just marks everything unread); additive-optional. */
  discussionReads?: [string, [string, number][]][]
  /** Watch subscriptions (D24) — `[tenantId, subjectKey]` pairs (tuples, not a Map:
   *  a subject has many watchers), where the key is `kind:id`. Additive-optional
   *  like `dispatch` (a pre-field snapshot loads cleanly with no watches); a
   *  snapshot written before the key generalized carries a BARE project id, which
   *  rehydrate migrates to `project:<id>`. */
  watches?: [string, string][]
  /** Commons likes (S4) — `[tenantId, feedItemId]` pairs, same tuple shape as
   *  `watches` (an item has many likers). Additive-optional. */
  commonsLikes?: [string, string][]
  /** Each tenant's recently-viewed subjects (S4) — `[tenantId, kind, id, at]`
   *  rows, newest re-sorted and capped on load. Derived, disposable state (the
   *  subjects remain where they live); additive-optional. */
  views?: [string, string, string, number][]
  /** The per-tenant notification inbox (D24) — derived, capped, disposable state
   *  (the acts themselves remain on their backlogs/profiles). Additive-optional. */
  notifications?: StoredNotification[]
  /** Immutable tenant-scoped image snapshots, retained for restart-safe model input. */
  imageAssets?: ImageAssetRow[]
  /** Change proposals against published definitions (D25), keyed by target agent
   *  id. Additive-optional like `dispatch`. */
  agentProposals?: [string, StoredAgentProposal[]][]
  /** Registered A2A peers (D28) — verified-identity credentials, hashed. */
  a2aPeers?: [string, StoredA2aPeer][]
  /** Private inspected MCP connection registry. Additive-optional so older
   * snapshots boot with an empty registry; present malformed state refuses
   * startup rather than silently discarding a connection. */
  mcpConnections?: McpConnectionState
  /** Person authority for OAuth-backed MCP activities. Private and never
   * projected into Session/Message wire rows; older non-OAuth snapshots omit it. */
  mcpActivityAuthorities?: McpActivityAuthority[]
  /** Private form continuation state; answer payloads are represented only by
   * command hashes and never retained in Session or snapshot rows. */
  mcpInputFlows?: McpInputFlow[]
  /** Owner-only unattended permissions, frozen run grants and exact receipts. */
  routineMcp?: RoutineMcpRegistryState
  /** Private fresh Commission grants, pre-model claims and exact effect receipts.
   * Missing legacy state is empty, never inferred from standing configuration. */
  commissionMcp?: CommissionMcpRegistryState
  /** Private durable model-usage receipts/holds, exactly joined to Commission
   * claims. Optional only when claimless; v6's absent legacy slice is normalized
   * by migration because that release had no Commission model-I/O execution. */
  usageReservations?: UsageReservationState[]
  /** The account registry (multi-account P7 — real onboarded accounts): users
   *  (with their server-only scrypt credential), tenants/workspaces, and
   *  memberships. Additive-optional like `dispatch` (a pre-P7 snapshot loads
   *  cleanly; rehydrate keeps the seeds); demo snapshots re-ensure the switcher
   *  directory; clean desktop snapshots re-ensure only the local device owner,
   *  while clean hosted snapshots begin accountless until signup. */
  accountUsers?: [string, AccountUser][]
  accountTenants?: [string, AccountTenant][]
  memberships?: Membership[]
  /** Minted bearer-token registry rows (the revocation authority — contract
   *  `ApiToken`), keyed by userId. Additive-optional like every account slice;
   *  revocation must survive a restart, so the rows persist with the accounts. */
  apiTokens?: [string, ApiToken[]][]
  /** Restart-safe keyed mint acknowledgement without persisted bearer values.
   * Active receipts reconstruct one exact token; cancelled receipts prevent a
   * late Retry from recreating access the user explicitly dismissed. */
  apiTokenMintReceipts?: [string, StoredApiTokenMintReceipt[]][]
  /** Org invitations (FWD-6 O-D3) — email-keyed, existence-hidden; the pending
   *  ones are what an invitee's `GET /me/invites` resolves lazily. Additive-
   *  optional like every account slice. */
  orgInvites?: StoredOrgInvite[]
  seq: {
    session: number
    message: number
    schedule: number
    run: number
    artifact: number
    provider: number
    systemPrompt: number
    agent: number
    commission: number
    /** Optional so a pre-field snapshot loads (rehydrate falls back to the seed counter). */
    audit?: number
    /** Dispatch run id counter (P7). Optional so a pre-field snapshot loads (falls back to
     *  the seed counter). */
    dispatch?: number
    /** Open-work item id counter (D19). Optional like `dispatch`. */
    openSubGoal?: number
    /** Contribution + contribution-event id counters (Phase A). Optional like
     *  `dispatch`. Landing numbers are NOT counters here — they're per-project
     *  positions derived from the ledger itself at land time. */
    contribution?: number
    /** Delegation id counter (Phase F). Optional like `dispatch`. */
    delegation?: number
    /** Grant id counter (social S1). Optional like `dispatch`. */
    grant?: number
    /** Discussion + post id counter (social S2). Optional like `dispatch`. */
    discussion?: number
    /** Social proposal id counter (S3). Optional like `dispatch`. */
    socialProposal?: number
    /** Notification id counter (D24). Optional like `dispatch`. */
    notification?: number
    /** Account registry counters (multi-account P7). Optional like the slices. */
    user?: number
    tenant?: number
    /** Org invite id counter (FWD-6). Optional like the slices. */
    orgInvite?: number
  }
}

/** How each top-level slice maps onto a relational shape — the single manifest the
 *  SQLite backend drives off, so adding a slice is one line here, not scattered SQL:
 *    • `singleton`   — one JSON value (version, recents, graph, seq) → a `kv` row.
 *    • `array`       — an ordered list of entities → rows in `entities`, order kept.
 *    • `mapEntries`  — `[key, value][]` (a Map serialized) → rows in `map_entries`.
 *  Typed `Record<keyof PersistedState, …>` so a new field on `PersistedState` is a
 *  compile error here until it's categorized — the format can't silently drop a slice. */
export type SliceKind = 'singleton' | 'array' | 'mapEntries'
export const SLICE_KIND: Record<keyof PersistedState, SliceKind> = {
  version: 'singleton',
  initialWorld: 'singleton',
  sessions: 'array',
  retiredSessionCreationIds: 'array',
  bindings: 'mapEntries',
  workspaces: 'mapEntries',
  sessionPreferences: 'mapEntries',
  modelPreferences: 'mapEntries',
  usageMeters: 'mapEntries',
  schedules: 'array',
  recents: 'singleton',
  recentsByTenant: 'mapEntries',
  graph: 'singleton',
  savedContexts: 'array',
  providers: 'mapEntries',
  providerConfigs: 'mapEntries',
  systemPrompts: 'mapEntries',
  registryDefaults: 'mapEntries',
  agents: 'mapEntries',
  agentOwnership: 'array',
  agentRequests: 'array',
  retiredAgentCreationIds: 'array',
  commissions: 'mapEntries',
  commissionCaps: 'mapEntries',
  projectDefaultRoles: 'mapEntries',
  auditLog: 'array',
  dispatch: 'array',
  openSubGoals: 'array',
  contributions: 'array',
  delegations: 'array',
  delegationRetirements: 'array',
  grants: 'array',
  discussions: 'array',
  socialProposals: 'array',
  artifactBodies: 'mapEntries',
  artifactHistory: 'mapEntries',
  artifactHistoryRestoreReceipts: 'mapEntries',
  artifactMetadata: 'mapEntries',
  artifactLifecycle: 'mapEntries',
  artifactRetirements: 'array',
  artifactDeletionReceipts: 'mapEntries',
  mutes: 'mapEntries',
  follows: 'mapEntries',
  discussionReads: 'mapEntries',
  watches: 'array',
  commonsLikes: 'array',
  views: 'array',
  notifications: 'array',
  imageAssets: 'array',
  agentProposals: 'mapEntries',
  a2aPeers: 'mapEntries',
  mcpConnections: 'singleton',
  mcpActivityAuthorities: 'array',
  mcpInputFlows: 'array',
  routineMcp: 'singleton',
  commissionMcp: 'singleton',
  usageReservations: 'array',
  accountUsers: 'mapEntries',
  accountTenants: 'mapEntries',
  memberships: 'array',
  apiTokens: 'mapEntries',
  apiTokenMintReceipts: 'mapEntries',
  orgInvites: 'array',
  seq: 'singleton',
}

/** Where the JSON snapshot lives. Override with `DATA_FILE`; defaults to
 *  `.data/store.json` under the process's working directory (the repo root for the
 *  run scripts). Read per-call so a test can point it at a throwaway path; test
 *  processes must set DATA_FILE explicitly rather than fall back to this default.
 *  Exported so the backup tool (scripts/snapshot.ts) resolves the SAME path the
 *  store reads/writes, rather than re-deriving (and drifting from) it. */
export function dataFile(): string {
  return persistencePath(process.env.DATA_FILE, join(process.cwd(), '.data', 'store.json'), 'DATA_FILE')
}

/** Where the embedded SQLite database lives (when `PERSIST_BACKEND=sqlite`).
 *  Override with `DATABASE_PATH`; defaults to `.data/store.db`. Read per-call,
 *  mirroring `dataFile()`; test processes must set it explicitly. */
export function databaseFile(): string {
  return persistencePath(process.env.DATABASE_PATH, join(process.cwd(), '.data', 'store.db'), 'DATABASE_PATH')
}

/** The persistence port: load the last snapshot (or null only on genuine first boot)
 *  and save a new one. `load()` MUST throw for existing unreadable, malformed,
 *  structurally invalid, or incompatible state; `save()` MUST throw when it cannot
 *  commit. This makes both boot and mutation acknowledgements fail closed. `close()`
 *  releases a backend's resources (a DB handle); the JSON backend has none. */
export interface PersistenceBackend {
  readonly name: string
  load(): PersistedState | null
  save(state: PersistedState): void
  close(): void
}

function persistedRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactFieldSet(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

function validProviderReplyOutputLimits(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !persistedRecord(entry[1])) return false
    const config = entry[1]
    return !Object.hasOwn(config, 'replyOutputTokens') || isReplyOutputTokens(config.replyOutputTokens)
  })
}

function canonicalMcpJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMcpJson)
  if (persistedRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalMcpJson(value[key])]))
  return value
}

function sameMcpJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalMcpJson(left)) === JSON.stringify(canonicalMcpJson(right))
}

function validNormalizedEnvelopeProposalLines(value: unknown): value is NormalizedEnvelopeProposalLine[] {
  if (!Array.isArray(value)) return false
  for (const line of value) {
    if (!persistedRecord(line) || !exactFieldSet(line, ['type', 'target', 'cardinality', 'harness', 'note'], ['mcp'])) return false
    if (line.mcp !== undefined && (!persistedRecord(line.mcp) ||
        !exactFieldSet(line.mcp, ['connectionId', 'connectionRevision', 'toolName', 'arguments'], ['transport']) ||
        (Object.hasOwn(line.mcp, 'transport') && line.mcp.transport !== 'stdio') ||
        !persistedRecord(line.mcp.arguments))) return false
  }
  try {
    const requestLines = value.map((line) => {
      if (!persistedRecord(line) || !persistedRecord(line.mcp) || !Object.hasOwn(line.mcp, 'transport')) return line
      const { transport: _transport, ...mcp } = line.mcp
      return { ...line, mcp }
    })
    const normalized = normalizedEnvelopeProposalLines({ lines: requestLines } as never)
    return normalized !== undefined && envelopeProposalLinesMatch(normalized, value as NormalizedEnvelopeProposalLine[])
  } catch { return false }
}

function validStoredContributionEnvelope(value: unknown): value is StoredContributionEnvelope {
  if (!persistedRecord(value) || !exactFieldSet(value,
    ['version', 'status', 'proposedBy', 'proposedAt', 'lines'], ['approvedBy', 'approvedAt', 'approvedVersion']) ||
      !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
      !['proposed', 'approved'].includes(String(value.status)) || typeof value.proposedBy !== 'string' ||
      !value.proposedBy.trim() || value.proposedBy.length > CONTRIBUTION_FIELD_MAX ||
      !Number.isSafeInteger(value.proposedAt) || (value.proposedAt as number) < 0 ||
      !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > EFFECT_ENVELOPE_LINE_MAX) return false
  if (value.status === 'approved') {
    if (typeof value.approvedBy !== 'string' || !value.approvedBy.trim() || value.approvedBy.length > CONTRIBUTION_FIELD_MAX ||
        !Number.isSafeInteger(value.approvedAt) || (value.approvedAt as number) < 0 ||
        value.approvedVersion !== value.version) return false
  } else if (['approvedBy', 'approvedAt', 'approvedVersion'].some((key) => Object.hasOwn(value, key))) return false

  const lineIds = new Set<string>()
  for (const line of value.lines) {
    if (!persistedRecord(line) || !exactFieldSet(line,
      ['id', 'type', 'target', 'cardinality', 'harness', 'note', 'used'], ['mcp', 'mcpAuthority']) ||
        typeof line.id !== 'string' || !line.id.trim() || lineIds.has(line.id) ||
        !PROJECT_EFFECT_TYPES.includes(line.type as never) || typeof line.target !== 'string' ||
        !line.target.trim() || line.target.length > CONTRIBUTION_FIELD_MAX ||
        !Number.isSafeInteger(line.cardinality) || (line.cardinality as number) < 1 ||
        (line.cardinality as number) > EFFECT_ENVELOPE_CARDINALITY_MAX ||
        typeof line.harness !== 'string' || !ENVELOPE_HARNESSES.includes(line.harness as never) ||
        typeof line.note !== 'string' || line.note.length > CONTRIBUTION_FIELD_MAX ||
        !Number.isSafeInteger(line.used) || (line.used as number) < 0 || (line.used as number) > (line.cardinality as number)) return false
    lineIds.add(line.id)

    const hasPreview = Object.hasOwn(line, 'mcp')
    const hasAuthority = Object.hasOwn(line, 'mcpAuthority')
    if (!hasPreview && !hasAuthority) {
      if (line.harness === 'explicit-call') return false
      continue
    }
    if (!hasPreview || !hasAuthority || line.harness !== 'explicit-call' || line.type !== 'mcp.mutate' ||
        !persistedRecord(line.mcp) ||
        !exactFieldSet(line.mcp, ['connectionLabel', 'toolName', 'arguments'], ['transport']) ||
        (Object.hasOwn(line.mcp, 'transport') && line.mcp.transport !== 'stdio') ||
        typeof line.mcp.connectionLabel !== 'string' || !line.mcp.connectionLabel.trim() ||
        line.mcp.connectionLabel.length > CONTRIBUTION_FIELD_MAX || typeof line.mcp.toolName !== 'string' ||
        !persistedRecord(line.mcp.arguments) || !persistedRecord(line.mcpAuthority) ||
        !exactFieldSet(line.mcpAuthority, ['tenantId', 'call'], ['ownerUserId', 'transport']) ||
        (Object.hasOwn(line.mcpAuthority, 'transport') && line.mcpAuthority.transport !== 'stdio') ||
        typeof line.mcpAuthority.tenantId !== 'string' ||
        !line.mcpAuthority.tenantId.trim()) return false
    if (Object.hasOwn(line.mcpAuthority, 'ownerUserId') &&
        (typeof line.mcpAuthority.ownerUserId !== 'string' || line.mcpAuthority.ownerUserId.length > 200 ||
          !line.mcpAuthority.ownerUserId.trim() || !/^[\x20-\x7e]+$/.test(line.mcpAuthority.ownerUserId))) return false
    if (Object.hasOwn(line.mcpAuthority, 'transport') !== Object.hasOwn(line.mcp, 'transport') ||
        (Object.hasOwn(line.mcpAuthority, 'transport') && !Object.hasOwn(line.mcpAuthority, 'ownerUserId'))) return false
    const boundCall = snapshotMcpBoundToolCall(line.mcpAuthority.call)
    if (!boundCall || line.target !== boundCall.toolName || line.mcp.toolName !== boundCall.toolName ||
        !sameMcpJson(line.mcp.arguments, boundCall.arguments)) return false
  }
  return true
}

function currentEnvelopeApprovalMatches(contribution: StoredContribution): boolean {
  const envelope = contribution.envelope
  if (!envelope || envelope.status !== 'approved') return true
  const approvals = contribution.events.filter((event) => event.kind === 'envelope-approved' &&
    event.envelopeVersion === envelope.version)
  return approvals.length === 1 && approvals[0].at === envelope.approvedAt &&
    approvals[0].body === `v${envelope.version}` && typeof approvals[0].actor === 'string' &&
    Boolean(approvals[0].actor.trim())
}

function approvedEnvelopeVersion(contribution: StoredContribution, version: number): boolean {
  if (contribution.envelope?.version === version) {
    return contribution.envelope.status === 'approved' && contribution.envelope.approvedVersion === version &&
      currentEnvelopeApprovalMatches(contribution)
  }
  return contribution.events.some((event) => event.kind === 'envelope-approved' && event.envelopeVersion === version)
}

function proposalForEffectVersion(
  contribution: StoredContribution,
  attempt: StoredContributionEffectAttempt,
): NormalizedEnvelopeProposalLine | undefined {
  const proposal = contribution.events.find((event) => event.kind === 'envelope-proposed' &&
    event.envelopeVersion === attempt.envelopeVersion && event.envelopeProposalLines !== undefined)
  if (!proposal || proposal.proposedByTenant !== attempt.tenantId ||
      !validNormalizedEnvelopeProposalLines(proposal.envelopeProposalLines)) return undefined
  return proposal.envelopeProposalLines.find((line) => line.mcp !== undefined &&
    line.mcp.connectionId === attempt.call.connectionId && line.mcp.connectionRevision === attempt.call.connectionRevision &&
    line.mcp.toolName === attempt.call.toolName && sameMcpJson(line.mcp.arguments, attempt.call.arguments) &&
    line.mcp.transport === attempt.transport &&
    line.type === 'mcp.mutate' && line.harness === 'explicit-call' && line.target === attempt.call.toolName)
}

/** Current MCP authority must still be the exact selection preserved by the
 * version's keyed proposal receipt. The public proposal intentionally omits
 * the private schema hash and line id; those remain bound by the stored call
 * and are revalidated against the current connection at runtime. */
function currentMcpProposalMatches(contribution: StoredContribution): boolean {
  const envelope = contribution.envelope
  if (!envelope || !envelope.lines.some((line) => line.harness === 'explicit-call')) return true
  if (!Array.isArray(contribution.events)) return false
  if (!currentEnvelopeApprovalMatches(contribution)) return false
  const proposals = contribution.events.filter((event) => event.kind === 'envelope-proposed' &&
    event.envelopeVersion === envelope.version)
  if (proposals.length !== 1) return false
  const proposal = proposals[0]
  if (typeof proposal.proposedByTenant !== 'string' || !proposal.proposedByTenant.trim() ||
      !validNormalizedEnvelopeProposalLines(proposal.envelopeProposalLines)) return false
  const projected: NormalizedEnvelopeProposalLine[] = []
  for (const line of envelope.lines) {
    const base = {
      type: line.type,
      target: line.target,
      cardinality: line.cardinality,
      harness: line.harness,
      note: line.note,
    }
    if (line.harness !== 'explicit-call') {
      projected.push(base)
      continue
    }
    if (!line.mcpAuthority || line.mcpAuthority.tenantId !== proposal.proposedByTenant) return false
    const call = snapshotMcpBoundToolCall(line.mcpAuthority.call)
    if (!call) return false
    projected.push({ ...base, mcp: {
      connectionId: call.connectionId,
      connectionRevision: call.connectionRevision,
      toolName: call.toolName,
      arguments: call.arguments,
      ...(line.mcp?.transport === undefined ? {} : { transport: line.mcp.transport }),
    } })
  }
  return envelopeProposalLinesMatch(projected, proposal.envelopeProposalLines)
}

function validStoredContributionEffectAttempts(contribution: StoredContribution): boolean {
  const attempts = contribution.effectAttempts
  if (attempts === undefined) {
    const lines = Array.isArray(contribution.envelope?.lines) ? contribution.envelope.lines : []
    return !lines.some((line) => line.harness === 'explicit-call' && line.used !== 0)
  }
  if (!Array.isArray(attempts) || attempts.length > CONTRIBUTION_EFFECT_ATTEMPT_MAX || !contribution.envelope ||
      (attempts.length > 0 && contribution.effectsFired !== true)) return false
  const ids = new Set<string>()
  const parsed: StoredContributionEffectAttempt[] = []
  for (const raw of attempts) {
    let attempt: StoredContributionEffectAttempt
    try { attempt = parseStoredContributionEffectAttempt(raw) } catch { return false }
    if (ids.has(attempt.id) || attempt.projectId !== contribution.projectId || attempt.contributionId !== contribution.id ||
        attempt.envelopeVersion > contribution.envelope.version || !approvedEnvelopeVersion(contribution, attempt.envelopeVersion)) return false
    if (attempt.status === 'pending' && (contribution.status !== 'open' ||
        attempt.envelopeVersion !== contribution.envelope.version || contribution.envelope.status !== 'approved' ||
        contribution.envelope.approvedVersion !== contribution.envelope.version)) return false
    ids.add(attempt.id)
    parsed.push(attempt)
    if (attempt.envelopeVersion === contribution.envelope.version) {
      const line = contribution.envelope.lines.find((candidate) => candidate.id === attempt.lineId)
      const call = line?.mcpAuthority && snapshotMcpBoundToolCall(line.mcpAuthority.call)
      if (!line || !call || line.harness !== 'explicit-call' || line.type !== 'mcp.mutate' ||
          line.mcpAuthority?.tenantId !== attempt.tenantId || line.mcpAuthority.ownerUserId !== attempt.ownerUserId ||
          line.mcpAuthority.transport !== attempt.transport || line.mcp?.transport !== attempt.transport ||
          call.connectionId !== attempt.call.connectionId || call.connectionRevision !== attempt.call.connectionRevision ||
          call.toolName !== attempt.call.toolName || call.schemaHash !== attempt.call.schemaHash ||
          !sameMcpJson(call.arguments, attempt.call.arguments)) return false
    } else if (!proposalForEffectVersion(contribution, attempt)) return false
  }
  for (const line of contribution.envelope.lines) {
    if (line.harness !== 'explicit-call') continue
    const used = parsed.filter((attempt) => attempt.envelopeVersion === contribution.envelope!.version &&
      attempt.lineId === line.id && contributionEffectConsumesSlot(attempt)).length
    if (line.used !== used || used > line.cardinality) return false
  }
  return true
}

/** Runtime guard for the core slices every rehydrate reads unconditionally.
 * TypeScript cannot protect a filesystem/import boundary; optional additive
 * slices deliberately stay optional for backward compatibility. */
export function hasCorePersistedShape(state: PersistedState | null): state is PersistedState {
  // Provider reply limits were added to server-only connection config. Old rows
  // may omit them, but a present malformed value must not become a runtime cap.
  if (state?.providerConfigs !== undefined && !validProviderReplyOutputLimits(state.providerConfigs)) return false
  if (state?.delegations !== undefined && !validStoredDelegations(state.delegations)) return false
  if (state?.delegationRetirements !== undefined && !validDelegationRetirements(state.delegationRetirements, state.delegations ?? [])) return false
  if (state?.contributions !== undefined) {
    if (!Array.isArray(state.contributions)) return false
    const reviewIds = new Set<string>()
    for (const contribution of state.contributions) {
      if (!contribution || Object.hasOwn(contribution, 'reviews') || Object.hasOwn(contribution, 'judgments') ||
        Object.hasOwn(contribution, 'effects')) return false
      if (contribution.envelope !== undefined) {
        const rawEnvelope = contribution.envelope as unknown
        const lines = persistedRecord(rawEnvelope) && Array.isArray(rawEnvelope.lines) ? rawEnvelope.lines : undefined
        const hasMcpState = contribution.effectAttempts !== undefined || (Array.isArray(lines) && lines.some((line) =>
          persistedRecord(line) && (Object.hasOwn(line, 'mcp') || Object.hasOwn(line, 'mcpAuthority') ||
            Object.hasOwn(line, 'canRun') || line.harness === 'explicit-call')))
        if (hasMcpState && (!validStoredContributionEnvelope(contribution.envelope) ||
            !currentMcpProposalMatches(contribution))) return false
      }
      if (!validStoredReviews(contribution.reviewAttempts, contribution.changeset) ||
          !validStoredJudgments(contribution.judgmentAttempts) || !validStoredContributionEffectAttempts(contribution)) return false
      for (const event of contribution.events ?? []) {
        if (event.envelopeProposalLines !== undefined &&
            (event.kind !== 'envelope-proposed' || !validNormalizedEnvelopeProposalLines(event.envelopeProposalLines))) return false
        if (Object.hasOwn(event, 'envelopeProposalOwnerUserId') &&
            (event.kind !== 'envelope-proposed' || typeof event.envelopeProposalOwnerUserId !== 'string' ||
              event.envelopeProposalOwnerUserId.length > 200 || !event.envelopeProposalOwnerUserId.trim() ||
              !/^[\x20-\x7e]+$/.test(event.envelopeProposalOwnerUserId))) return false
      }
      for (const run of contribution.reviewAttempts ?? []) {
        if (reviewIds.has(run.id)) return false
        reviewIds.add(run.id)
      }
      for (const run of contribution.judgmentAttempts ?? []) {
        if (reviewIds.has(run.id)) return false
        reviewIds.add(run.id)
      }
    }
    const receiptCollisionIds = new Set<string>(reviewIds)
    for (const contribution of state.contributions) {
      for (const event of contribution.events ?? []) if (typeof event?.id === 'string') receiptCollisionIds.add(event.id)
    }
    const effectIds = new Set<string>()
    for (const contribution of state.contributions) {
      for (const attempt of contribution.effectAttempts ?? []) {
        if (receiptCollisionIds.has(attempt.id) || effectIds.has(attempt.id)) return false
        effectIds.add(attempt.id)
      }
    }
  }
  // Project-work joins consume already-parsed effect receipts and envelopes;
  // reject malformed nested Contribution state before the projection reads it.
  if (!validProjectWorkPersistence(state?.contributions, state?.openSubGoals)) return false
  // Authored rich bodies retain their exact shape through portable restores.
  // A revision is storage-owned metadata, not an author-supplied body field.
  if (state?.artifactBodies !== undefined) {
    if (!Array.isArray(state.artifactBodies)) return false
    for (const entry of state.artifactBodies) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') return false
      const body = entry[1]
      // Identity-bearing Documents must be valid even before their first edit
      // creates history. Keep legacy current-body admission unchanged; this is
      // not an implicit migration or a new bound on old un-identified content.
      if (body?.type === 'doc' && Array.isArray(body.blocks) && body.blocks.some((block) =>
        block !== null && typeof block === 'object' && Object.hasOwn(block, 'id'))) {
        if (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || body.revision < 0)) return false
        if (!historyBodyWithoutRevision(body)) return false
        continue
      }
      if (body?.type !== 'sheet' && body?.type !== 'workbook' && body?.type !== 'slides') continue
      const { revision, ...values } = body
      if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) return false
      if (!parseStructuredArtifactBody(values)) return false
    }
  }
  if (state?.artifactHistory !== undefined) {
    try {
      const entries = parseArtifactHistoryEntries(state.artifactHistory)
      const currentBodies = new Map(state.artifactBodies ?? [])
      for (const [id, versions] of entries) {
        const latest = versions.at(-1)!
        const body = currentBodies.get(id)
        // V6 may still admit a legacy current-only Document without IDs so it
        // can be normalized at read time. Once retained history exists, however,
        // current and every saved Document version must already share the
        // persisted identity model; normalizing only current would make edits,
        // restores, and history reads disagree about the same body.
        const identifiedDocument = (candidate: unknown): boolean => {
          if (!candidate || typeof candidate !== 'object' || (candidate as { type?: unknown }).type !== 'doc') return true
          const blocks = (candidate as { blocks?: unknown }).blocks
          return Array.isArray(blocks) && blocks.every((block) =>
            block !== null && typeof block === 'object' && typeof (block as { id?: unknown }).id === 'string')
        }
        if (!identifiedDocument(body) || versions.some((version) => !identifiedDocument(version.body))) return false
        if (!body || (body.revision ?? 0) !== latest.revision ||
          JSON.stringify(historyBodyWithoutRevision(body)) !== JSON.stringify(latest.body)) return false
      }
    } catch { return false }
  }
  if (state?.artifactHistoryRestoreReceipts !== undefined) {
    if (!Array.isArray(state.artifactHistoryRestoreReceipts)) return false
    const receiptKeys = new Set<string>()
    const histories = new Map(parseArtifactHistoryEntries(state.artifactHistory ?? []))
    for (const entry of state.artifactHistoryRestoreReceipts) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || receiptKeys.has(entry[0])) return false
      receiptKeys.add(entry[0])
      const [storageKey, receipt] = entry
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
        Object.keys(receipt).sort().join(',') !== 'artifactId,expectedRevision,keyHash,restoredRevision,sourceRevision,tenantId,userId' ||
        typeof receipt.tenantId !== 'string' || !receipt.tenantId || typeof receipt.userId !== 'string' || !receipt.userId ||
        typeof receipt.artifactId !== 'string' || !receipt.artifactId || typeof receipt.keyHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.keyHash) ||
        !Number.isSafeInteger(receipt.sourceRevision) || receipt.sourceRevision < 0 ||
        !Number.isSafeInteger(receipt.expectedRevision) || receipt.expectedRevision < 0 ||
        !Number.isSafeInteger(receipt.restoredRevision) || receipt.restoredRevision !== receipt.expectedRevision + 1) return false
      const versions = histories.get(receipt.artifactId)
      const version = versions?.find((candidate) => candidate.revision === receipt.restoredRevision)
      const sourceVersion = versions?.find((candidate) => candidate.revision === receipt.sourceRevision)
      if (!version || version.reason !== 'restore' || version.restoredFromRevision !== receipt.sourceRevision ||
        !sourceVersion || JSON.stringify(sourceVersion.body) !== JSON.stringify(version.body)) return false
      if (storageKey !== JSON.stringify([receipt.tenantId, receipt.userId, receipt.keyHash])) return false
    }
  }
  if (state?.artifactMetadata !== undefined) {
    try { parseArtifactMetadataEntries(state.artifactMetadata) } catch { return false }
  }
  if (state?.artifactLifecycle !== undefined) {
    try { parseArtifactLifecycleEntries(state.artifactLifecycle) } catch { return false }
  }
  if (state?.artifactRetirements !== undefined || state?.artifactDeletionReceipts !== undefined) {
    let retirements: ArtifactRetirement[]
    let receipts: Array<[string, StoredArtifactDeletionReceipt]>
    try {
      retirements = parseArtifactRetirements(state.artifactRetirements)
      receipts = parseArtifactDeletionReceipts(state.artifactDeletionReceipts)
    } catch { return false }
    const retired = new Map(retirements.map((row) => [row.artifactId, row]))
    const retiredDiscussionIds = new Set<string>()
    const retiredProposalIds = new Set<string>()
    for (const retirement of retirements) {
      for (const id of retirement.discussionIds ?? []) {
        if (retiredDiscussionIds.has(id)) return false
        retiredDiscussionIds.add(id)
      }
      for (const id of retirement.proposalIds ?? []) {
        if (retiredProposalIds.has(id)) return false
        retiredProposalIds.add(id)
      }
    }
    for (const [id, receipt] of receipts) {
      if (retired.get(receipt.artifactId)?.tenantId !== receipt.tenantId ||
        id !== JSON.stringify([receipt.tenantId, receipt.userId, receipt.keyHash])) return false
    }
    const pairsContain = (value: unknown, key: string): boolean =>
      Array.isArray(value) && value.some((entry) => Array.isArray(entry) && entry[0] === key)
    const graph = state.graph as RelationGraph
    for (const id of retired.keys()) {
      if (graph.extraArtifacts.some((artifact) => artifact.id === id) ||
        pairsContain(state.artifactBodies, id) || pairsContain(state.artifactHistory, id) ||
        pairsContain(state.artifactHistoryRestoreReceipts, id) || pairsContain(state.artifactMetadata, id) ||
        pairsContain(state.artifactLifecycle, id) || Object.hasOwn(graph.artifactProject, id) ||
        Object.hasOwn(graph.artifactSource, id) || (state.grants ?? []).some((grant) => grant.subject.kind === 'artifact' && grant.subject.id === id) ||
        (state.artifactHistoryRestoreReceipts ?? []).some(([, receipt]) => receipt.artifactId === id) ||
        (state.socialProposals ?? []).some((proposal) => proposal.subject.kind === 'artifact' && proposal.subject.id === id) ||
        (state.discussions ?? []).some((discussion) => discussion.anchor.ref.kind === 'artifact' && discussion.anchor.ref.id === id)) return false
    }
    const retiredSubject = (kind: unknown, id: unknown): boolean => typeof id === 'string' && (
      (kind === 'artifact' && retired.has(id)) ||
      (kind === 'discussion' && retiredDiscussionIds.has(id)) ||
      (kind === 'proposal' && retiredProposalIds.has(id)))
    if ((state.discussions ?? []).some((discussion) => retiredDiscussionIds.has(discussion.id) ||
      retiredSubject(discussion.anchor.ref.kind, discussion.anchor.ref.id)) ||
      (state.socialProposals ?? []).some((proposal) => retiredProposalIds.has(proposal.id) ||
        retiredSubject(proposal.subject.kind, proposal.subject.id)) ||
      (state.grants ?? []).some((grant) => retiredSubject(grant.subject.kind, grant.subject.id))) return false
    const hasRetiredAncestor = (ref: SocialEntityRef, root: string, seen = new Set<string>()): boolean => {
      const key = `${ref.kind}:${ref.id}`
      if (seen.has(key)) return false
      seen.add(key)
      if (ref.kind === 'artifact') return retired.has(ref.id) && ref.id === root
      if (ref.kind === 'discussion') {
        const row = state.discussions?.find((candidate) => candidate.id === ref.id)
        return row ? hasRetiredAncestor(row.anchor.ref, root, seen) : false
      }
      if (ref.kind === 'proposal') {
        const row = state.socialProposals?.find((candidate) => candidate.id === ref.id)
        return row ? hasRetiredAncestor(row.subject, root, seen) : false
      }
      return false
    }
    for (const id of retired.keys()) {
      if ((state.discussions ?? []).some((discussion) => hasRetiredAncestor(discussion.anchor.ref, id)) ||
        (state.socialProposals ?? []).some((proposal) => hasRetiredAncestor(proposal.subject, id))) return false
    }
    for (const notification of state.notifications ?? []) {
      if ((notification.subjectKind === 'artifact' && typeof notification.subjectId === 'string' && retired.has(notification.subjectId)) ||
        retiredSubject(notification.subjectKind, notification.subjectId) ||
        (typeof notification.discussionId === 'string' && retiredDiscussionIds.has(notification.discussionId) ) ||
        (typeof notification.proposalId === 'string' && retiredProposalIds.has(notification.proposalId))) return false
    }
    const subjectKeyRetired = (key: unknown): boolean => {
      if (typeof key !== 'string') return false
      const split = key.indexOf(':')
      return split > 0 && retiredSubject(key.slice(0, split), key.slice(split + 1))
    }
    if ((state.watches ?? []).some((entry) => Array.isArray(entry) && subjectKeyRetired(entry[1])) ||
      (state.commonsLikes ?? []).some((entry) => Array.isArray(entry) && typeof entry[1] === 'string' &&
        ([...retiredDiscussionIds].some((id) => entry[1] === `post:${id}`) ||
          [...retiredProposalIds].some((id) => entry[1] === `landing:${id}`))) ||
      (state.views ?? []).some((entry) => Array.isArray(entry) && retiredSubject(entry[1], entry[2])) ||
      (state.discussionReads ?? []).some((entry) => Array.isArray(entry) && Array.isArray(entry[1]) &&
        entry[1].some((read) => Array.isArray(read) && retiredDiscussionIds.has(read[0])))) return false
  }
  if (state?.usageMeters !== undefined) {
    try { parseUsageMeterEntries(state.usageMeters) } catch { return false }
  }
  if (state?.imageAssets !== undefined) {
    if (!Array.isArray(state.imageAssets)) return false
    try { rehydrateImageAssets(state.imageAssets) } catch { return false }
  }
  if (state?.mcpConnections !== undefined) {
    try { parseMcpConnectionState(state.mcpConnections) } catch { return false }
  }
  try {
    const authorities = parseMcpActivityAuthorities(state?.mcpActivityAuthorities)
    const connections = parseMcpConnectionState(state?.mcpConnections)
    if (!validateMcpActivityAuthorities(authorities, state?.sessions ?? [], connections)) return false
    if (!validateContributionMcpAuthorities(state?.contributions ?? [], connections)) return false
  } catch { return false }
  if (state?.routineMcp !== undefined) {
    try {
      const routineMcp = parseRoutineMcpRegistryState(state.routineMcp)
      if (!Array.isArray(state.schedules) || !validateRoutineMcpRegistryJoins(routineMcp, state.schedules)) return false
      // History admission proves saved owner/transport joins, not current native
      // execution capability. Private receipts remain readable without a host.
      if (!validateRoutineMcpAuthorities(routineMcp, parseMcpConnectionState(state.mcpConnections), true)) return false
    } catch { return false }
  }
  if (state?.commissionMcp !== undefined) {
    try {
      const commissionMcp = parseCommissionMcpRegistryState(state.commissionMcp)
      if ((state.commissions ?? []).some(entry => !Array.isArray(entry) || entry.length !== 2 || entry[0] !== entry[1]?.id) ||
          (state.agents ?? []).some(entry => !Array.isArray(entry) || entry.length !== 2 || entry[0] !== entry[1]?.id)) return false
      if (!validateCommissionMcpRegistryJoins(commissionMcp, {
        commissions: (state.commissions ?? []).map(([, row]) => row),
        agents: (state.agents ?? []).map(([, row]) => row), work: state.openSubGoals ?? [],
        connections: parseMcpConnectionState(state.mcpConnections),
      })) return false
    } catch { return false }
  }
  if (state?.usageReservations !== undefined) {
    try {
      const reservations = parseUsageReservations(state.usageReservations)
      const claims = new Map((state.commissionMcp?.claims ?? []).map(claim => [claim.id, claim]))
      const requests = parseProxyRequests(state.agentRequests)
      const draftRows = requests.filter(row => row.argumentDraft !== undefined || row.replyDraft !== undefined)
      const draftEntries = draftRows.flatMap(row => [
        ...(row.argumentDraft ? [[proxyArgumentReservationId(row.intent.id), { request: row, draft: row.argumentDraft }] as const] : []),
        ...(row.replyDraft ? [[proxyReplyReservationId(row.intent.id), { request: row, draft: row.replyDraft }] as const] : []),
      ])
      const drafts = new Map<string, { request: StoredProxyRequest; draft: AgentRequestArgumentDraft | AgentRequestReplyDraft }>(draftEntries)
      if (drafts.size !== draftRows.reduce((count, row) => count + Number(!!row.argumentDraft) + Number(!!row.replyDraft), 0) ||
          reservations.length !== claims.size + drafts.size) return false
      for (const reservation of reservations) {
        const claim = claims.get(reservation.id)
        if (claim) {
          if (reservation.tenantId !== claim.permission.tenantId ||
              (reservation.status === 'active' && claim.phase !== 'preparing')) return false
          continue
        }
        const joined = drafts.get(reservation.id)
        const request = joined?.request, draft = joined?.draft
        if (!request || !draft || reservation.tenantId !== request.intent.owner.tenantId ||
            (draft === request.argumentDraft ? reservation.id !== proxyArgumentReservationId(request.intent.id) :
              reservation.id !== proxyReplyReservationId(request.intent.id))) return false
        if (draft.status === 'pending') {
          // The model response may be durable before output validation/receipt
          // settlement, but a request hold cannot be detached from its draft.
          if (reservation.status === 'active') continue
          if (reservation.status === 'settled' && !reservation.report) return false
        } else if (draft.status === 'done') {
          if (reservation.status !== 'settled' || !reservation.report) return false
        } else if (reservation.status === 'active' ||
            (reservation.status === 'settled' && !reservation.report)) return false
      }
    } catch { return false }
  } else {
    try {
      if ((state?.commissionMcp?.claims.length ?? 0) > 0 ||
          parseProxyRequests(state?.agentRequests).some(row => row.argumentDraft !== undefined || row.replyDraft !== undefined)) {
        // Current snapshots with claims must retain their model usage receipt or
        // uncertainty hold; the v6 migration materializes legacy zero-usage rows.
        return false
      }
    } catch { return false }
  }
  if (state?.modelPreferences !== undefined) {
    try { parsePersistedModelPreferences(state.modelPreferences) } catch { return false }
  }
  try {
    if (!validateAgentOwnershipJoins(parseAgentOwnership(state?.agentOwnership), state!)) return false
    if (!validateProxyRequestJoins(parseProxyRequests(state?.agentRequests), parseAgentOwnership(state?.agentOwnership),
      parseMcpConnectionState(state?.mcpConnections))) return false
  } catch { return false }
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const exactJsonEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every((entry, index) => exactJsonEqual(entry, right[index]))
    }
    if (!record(left) || !record(right)) return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
      key === rightKeys[index] && exactJsonEqual(left[key], right[key]))
  }
  const mcpResultValid = (value: unknown): boolean => {
    try { return exactJsonEqual(parseMcpToolResult(value, MCP_MODERN_VERSION), value) }
    catch { return false }
  }
  const messageMetadataValid = (sessions: unknown): boolean => {
    if (!Array.isArray(sessions)) return false
    for (const session of sessions) {
      if (!record(session)) return false
      const activeMessages = session.messages
      const compactedMessages = session.compactedMessages
      if (activeMessages !== undefined && !Array.isArray(activeMessages)) return false
      if (compactedMessages !== undefined && !Array.isArray(compactedMessages)) return false
      for (const message of [...(activeMessages ?? []), ...(compactedMessages ?? [])]) {
        if (record(message) && Object.hasOwn(message, 'assistantTextItems') &&
            (message.role !== 'assistant' || !isAssistantTextItems(message.assistantTextItems, message.content))) return false
        if (!record(message) || message.toolActivities === undefined) continue
        if (!Array.isArray(message.toolActivities)) return false
        for (const activity of message.toolActivities) {
          if (!record(activity)) return false
          if (activity.mcp === undefined) {
            if (activity.status === 'running' || activity.status === 'uncertain' || activity.mcpResult !== undefined) return false
            continue
          }
          const anchor = activity.mcp
          if (!record(anchor) || Object.keys(anchor).some((key) => !['connectionRevision', 'toolName', 'schemaHash'].includes(key)) ||
              !Number.isSafeInteger(anchor.connectionRevision) || typeof anchor.connectionRevision !== 'number' || anchor.connectionRevision < 0 ||
              typeof anchor.toolName !== 'string' || anchor.toolName.length < 1 || Array.from(anchor.toolName).length > 128 ||
              typeof anchor.schemaHash !== 'string' || !/^[a-f0-9]{64}$/.test(anchor.schemaHash) ||
              typeof activity.connectorId !== 'string' || !activity.connectorId.startsWith('mcp-connection-') ||
              activity.kind !== 'action' || activity.op !== undefined) return false
          const status = activity.status
          const decision = activity.decisionId
          const receipt = typeof decision === 'string' && /^tool-activity-decision-[a-f0-9]{24}$/.test(decision)
          if (decision !== undefined && !receipt) return false
          if ((status === 'running' || status === 'done' || status === 'uncertain' || status === 'declined') && !receipt) return false
          if (status === 'proposed' && (decision !== undefined || activity.mcpResult !== undefined)) return false
          if (status === 'running' && activity.mcpResult !== undefined) return false
          if (status === 'uncertain' && activity.mcpResult !== undefined) return false
          if (status === 'done' && (!mcpResultValid(activity.mcpResult) || (activity.mcpResult as { isError?: unknown }).isError !== false)) return false
          if (activity.mcpResult !== undefined && status !== 'done' && status !== 'failed') return false
          if (status === 'failed' && activity.mcpResult !== undefined && !receipt) return false
          if (status === 'failed' && activity.mcpResult !== undefined &&
              (!mcpResultValid(activity.mcpResult) || (activity.mcpResult as { isError?: unknown }).isError !== true)) return false
          if (!['proposed', 'running', 'awaiting-input', 'done', 'failed', 'uncertain', 'declined'].includes(String(status))) return false
        }
      }
    }
    return true
  }
  const mcpInputFlowsValid = (sessions: unknown): boolean => {
    try {
      const flows = parseMcpInputFlows(state?.mcpInputFlows)
      return validateMcpInputFlows(flows, sessions)
    } catch { return false }
  }
  const graphContextsValid = (graph: unknown): boolean => {
    if (!record(graph)) return false
    const projectContexts = (graph as { projectContexts?: unknown }).projectContexts
    if (!record(projectContexts)) return false
    for (const contexts of Object.values(projectContexts as Record<string, unknown>)) {
      if (!Array.isArray(contexts)) return false
      for (const context of contexts) {
        if (!record(context)) return false
        const source = (context as { source?: unknown }).source
        if (source !== undefined && !isProjectContextSource(source)) return false
      }
    }
    return true
  }
  const graphScheduleArtifactsValid = (graph: unknown): boolean => {
    if (!record(graph)) return false
    const artifacts = (graph as { scheduleArtifact?: unknown }).scheduleArtifact
    return record(artifacts) && Object.values(artifacts).every((artifact) => parseScheduledArtifactSpec(artifact) !== undefined)
  }
  const artifactOriginsValid = (graph: unknown): boolean => {
    if (!record(graph)) return false
    const artifacts = (graph as { extraArtifacts?: unknown }).extraArtifacts
    if (!Array.isArray(artifacts)) return false
    return artifacts.every((artifact) => {
      if (!record(artifact)) return false
      const excerptSource = (artifact as { excerptSource?: unknown }).excerptSource
      if (excerptSource !== undefined && excerptSource !== 'body') return false
      const origin = (artifact as { saveOrigin?: unknown }).saveOrigin
      if (origin === undefined) return true
      if (!record(origin)) return false
      const fields = origin as Record<string, unknown>
      return Object.keys(fields).length === 2 && typeof fields.name === 'string' && typeof fields.source === 'string'
    })
  }
  const servedSnapshotsValid = (workspaces: unknown): boolean => {
    if (!Array.isArray(workspaces)) return false
    for (const entry of workspaces) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const workspace = entry[1]
      if (record(workspace) && Array.isArray(workspace.workspaces) && !validWorkspaceFolders(workspace.workspaces)) return false
      if (!record(workspace) || !Array.isArray(workspace.attachments)) continue
      for (const attachment of workspace.attachments) {
        if (record(attachment) && (attachment.kind === 'discussion' || Object.hasOwn(attachment, 'discussionSnapshot') || Object.hasOwn(attachment, 'discussionCaptureId'))) {
          if (!isAttachmentInput(attachment) || !attachment.discussionSnapshot) return false
        }
        if (record(attachment) && (attachment.kind === 'artifact' || Object.hasOwn(attachment, 'artifactSnapshot') || Object.hasOwn(attachment, 'artifactCaptureId'))) {
          if (!isAttachmentInput(attachment) || !attachment.artifactSnapshot) return false
        }
        if (record(attachment) && (Object.hasOwn(attachment, 'textSnapshot') || Object.hasOwn(attachment, 'imageSnapshot')) && !isAttachmentInput(attachment)) return false
      }
    }
    return true
  }
  const servedImageReferencesValid = (sessions: unknown, workspaces: unknown, assets: unknown): boolean => {
    if (!Array.isArray(sessions) || !Array.isArray(workspaces) || !Array.isArray(assets)) return false
    const sessionsById = new Map<string, Record<string, unknown>>()
    for (const session of sessions) {
      if (record(session) && typeof session.id === 'string') sessionsById.set(session.id, session)
    }
    const assetsById = new Map<string, ImageAssetRow>()
    for (const asset of assets) {
      if (record(asset) && typeof asset.id === 'string') assetsById.set(asset.id, asset as unknown as ImageAssetRow)
    }
    for (const entry of workspaces) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const workspace = entry[1]
      if (!record(workspace) || !Array.isArray(workspace.attachments)) continue
      for (const attachment of workspace.attachments) {
        if (!record(attachment) || !Object.hasOwn(attachment, 'imageSnapshot')) continue
        const snapshot = attachment.imageSnapshot
        if (!isServedImageSnapshot(snapshot) || typeof entry[0] !== 'string') return false
        const session = sessionsById.get(entry[0])
        const asset = assetsById.get(snapshot.image.id)
        if (!session || !asset || asset.id !== snapshot.image.id ||
            !imageAssetRefMatches(snapshot.image as ImageAssetRef, asset.image, asset.original)) return false
        if (session.tenantId !== undefined && asset.tenantId !== session.tenantId) return false
      }
    }
    return true
  }
  return Boolean(
    state
      && (state.initialWorld === undefined || state.initialWorld === 'demo' || state.initialWorld === 'clean')
      && Array.isArray(state.sessions)
      && validDispatchState(state.dispatch, state.sessions, state.retiredSessionCreationIds)
      && messageMetadataValid(state.sessions)
      && mcpInputFlowsValid(state.sessions)
      && Array.isArray(state.bindings)
      && Array.isArray(state.workspaces)
      && servedSnapshotsValid(state.workspaces)
      && servedImageReferencesValid(state.sessions, state.workspaces, state.imageAssets ?? [])
      && Array.isArray(state.schedules)
      && state.schedules.every((task) => record(task) && Array.isArray(task.runs) && task.runs.every((run) => {
        if (!record(run)) return false
        if (run.execution === undefined) return true
        if (!record(run.execution)) return false
        return !Object.hasOwn(run.execution, 'standing') || parseScheduleStanding(run.execution.standing) !== undefined
      }))
      && record(state.recents)
      && graphContextsValid(state.graph)
      && graphScheduleArtifactsValid(state.graph)
      && artifactOriginsValid(state.graph)
      && record(state.seq),
  )
}
