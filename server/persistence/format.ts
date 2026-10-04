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
  EffectEnvelopeLine,
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
  SystemPromptEntry,
  WorkItemComment,
} from '../../contract/index.ts'
import { isAttachmentInput } from '../../contract/attachmentInput.ts'
import { rehydrateImageAssets, type ImageAssetRow } from '../imageAssets.ts'
import { parseArtifactMetadataEntries } from '../artifactMetadata.ts'
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
import { parseUsageMeterEntries, type UsageMeterEntries } from '../usageRegistry.ts'
import { parseScheduleStanding } from '../scheduleStanding.ts'
import { parseScheduledArtifactSpec } from '../../contract/scheduledArtifact.ts'
import { isProjectContextSource } from '../../contract/cowork.ts'
import { parseMcpToolResult } from '../mcpToolResult.ts'
import { parsePersistedModelPreferences, type PersistedModelPreferences } from '../modelPreferences.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { join } from 'node:path'

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
export const STORE_VERSION = 5

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
export interface StoredContribution extends Omit<Contribution, 'events'> {
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
  envelopeProposalLines?: Omit<EffectEnvelopeLine, 'id' | 'used'>[]
  envelopeProposalExpectedVersion?: number
}

/** A Delegation as STORED (CW8, Phase F) — the wire row plus the DELEGATOR's
 *  raw tenant id (the conservation-law anchor: the delegated decision executes
 *  as this tenant, and authorization compares raw ids — the D23 lesson). The
 *  projection strips it; `policy` is served to the delegator only. */
export interface StoredDelegation extends Omit<Delegation, 'mine'> {
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
  /** Independent display names, ordered by metadata revision rather than body revision. */
  artifactMetadata?: [string, ArtifactMetadata][]
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
  artifactMetadata: 'mapEntries',
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
 *  run scripts). Read per-call so a test can point it at a throwaway path.
 *  Exported so the backup tool (scripts/snapshot.ts) resolves the SAME path the
 *  store reads/writes, rather than re-deriving (and drifting from) it. */
export function dataFile(): string {
  return process.env.DATA_FILE ?? join(process.cwd(), '.data', 'store.json')
}

/** Where the embedded SQLite database lives (when `PERSIST_BACKEND=sqlite`).
 *  Override with `DATABASE_PATH`; defaults to `.data/store.db`. Read per-call,
 *  mirroring `dataFile()`. */
export function databaseFile(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), '.data', 'store.db')
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

/** Runtime guard for the core slices every rehydrate reads unconditionally.
 * TypeScript cannot protect a filesystem/import boundary; optional additive
 * slices deliberately stay optional for backward compatibility. */
export function hasCorePersistedShape(state: PersistedState | null): state is PersistedState {
  // Authored rich bodies retain their exact shape through portable restores.
  // A revision is storage-owned metadata, not an author-supplied body field.
  if (state?.artifactBodies !== undefined) {
    if (!Array.isArray(state.artifactBodies)) return false
    for (const entry of state.artifactBodies) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') return false
      const body = entry[1]
      if (body?.type !== 'sheet' && body?.type !== 'slides') continue
      const { revision, ...values } = body
      if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) return false
      if (!parseStructuredArtifactBody(values)) return false
    }
  }
  if (state?.artifactMetadata !== undefined) {
    try { parseArtifactMetadataEntries(state.artifactMetadata) } catch { return false }
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
  if (state?.modelPreferences !== undefined) {
    try { parsePersistedModelPreferences(state.modelPreferences) } catch { return false }
  }
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
  const mcpActivitiesValid = (sessions: unknown): boolean => {
    if (!Array.isArray(sessions)) return false
    for (const session of sessions) {
      if (!record(session)) return false
      const activeMessages = session.messages
      const compactedMessages = session.compactedMessages
      if (activeMessages !== undefined && !Array.isArray(activeMessages)) return false
      if (compactedMessages !== undefined && !Array.isArray(compactedMessages)) return false
      for (const message of [...(activeMessages ?? []), ...(compactedMessages ?? [])]) {
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
          if (!['proposed', 'running', 'done', 'failed', 'uncertain', 'declined'].includes(String(status))) return false
        }
      }
    }
    return true
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
      if (!record(workspace) || !Array.isArray(workspace.attachments)) continue
      for (const attachment of workspace.attachments) {
        if (record(attachment) && Object.hasOwn(attachment, 'textSnapshot') && !isAttachmentInput(attachment)) return false
      }
    }
    return true
  }
  return Boolean(
    state
      && (state.initialWorld === undefined || state.initialWorld === 'demo' || state.initialWorld === 'clean')
      && Array.isArray(state.sessions)
      && mcpActivitiesValid(state.sessions)
      && Array.isArray(state.bindings)
      && Array.isArray(state.workspaces)
      && servedSnapshotsValid(state.workspaces)
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
