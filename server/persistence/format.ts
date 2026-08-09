/** ── The persisted format: shape, version, slice manifest, locations, port ────
 *  A *leaf* module (no back-edges into the rest of `server/`) so the backends
 *  (`json.ts`, `sqlite.ts`) and the facade (`server/persist.ts`) can all import it
 *  without an import cycle. It defines:
 *    • `PersistedState` — the store's mutable, UI-owned state on disk,
 *    • `STORE_VERSION` — the data-schema version (mismatch ⇒ the store re-seeds),
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
  SessionWorkspace,
  SystemPromptEntry,
  WorkItemComment,
} from '../../contract/index.ts'
import type { ProviderConfig } from '../data/providers.ts'
import type { AccountUser, AccountTenant, Membership, StoredOrgInvite } from '../accounts.ts'
import { join } from 'node:path'

/** On-disk schema version. A snapshot whose version doesn't match is ignored (the
 *  store re-seeds), so an incompatible older file can't crash a newer build.
 *  v2: the "time ago" stamps moved from frozen display strings to absolute epoch-ms
 *  timestamps (artifact.editedAt, project.updatedAt, savedContext.lastUsedAt) and
 *  session.updatedLabel was dropped.
 *  v3: ScheduledRun followed suit — `when`/`absolute` strings dropped and `at`
 *  changed from minutes-ago to an absolute epoch-ms; a v2 snapshot's runs would
 *  render as "Jan 1 1970", so it's discarded and the store re-seeds.
 *  v4: the Agent Commons registries (providers + their server-only configs, the
 *  system-prompt library, worker agents, commissions) and their id counters joined
 *  the snapshot, so an agent / provider / prompt / commission created or edited
 *  through the Agents hub (or proposed by Claude and confirmed) survives a restart
 *  rather than reverting to the seed; a v3 snapshot lacks them, so it's discarded.
 *  v5: `AuditEntry` gained a required `tenantId` (the audit trail is tenant-scoped,
 *  F5/PD9). A v4 snapshot's audit entries predate the field, so a forward-only data
 *  migration (`DATA_MIGRATIONS`, server/persistence/migrate.ts) backfills them to the
 *  personal tenant on load — the first real migration, replacing discard-and-reseed for
 *  this bump so a restored store keeps its audit history.
 *  Older versions without a migration path remain discard-and-reseed.
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
 *  Both additive-optional: a row written before them keeps the name it was
 *  minted with, and is simply not retractable — the honest degrade. */
export interface StoredNotification extends AppNotification {
  tenantId: string
  actorTenant?: string
  postId?: string
}

/** A thread comment as STORED — the wire row plus the acting principal (FWD-5
 *  Phase 1). Server-private; the projection strips it and serves only `authorKind`. */
export type StoredWorkItemComment = WorkItemComment & { principal?: PrincipalRef }

/** A work item as STORED (D19) — the wire row plus the poster's RAW tenant id (the
 *  strict retract-authorization anchor: display names are attacker-controlled, so
 *  authorization compares tenant ids — the D23 lesson) and the acting principals of
 *  its post / retract acts (FWD-5 Phase 1). Server-private; `publicOpenSubGoal`
 *  strips all of it and serves only the display names + principal KINDs. */
export interface StoredOpenSubGoal extends Omit<OpenSubGoal, 'comments'> {
  postedByTenant?: string
  postedByPrincipal?: PrincipalRef
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
  events: StoredContributionEvent[]
}

/** A contribution timeline event as STORED — the wire row plus the acting
 *  principal (FWD-5); the projection strips it and serves only `actorKind`. */
export type StoredContributionEvent = ContributionEvent & { principal?: PrincipalRef }

/** A Delegation as STORED (CW8, Phase F) — the wire row plus the DELEGATOR's
 *  raw tenant id (the conservation-law anchor: the delegated decision executes
 *  as this tenant, and authorization compares raw ids — the D23 lesson). The
 *  projection strips it; `policy` is served to the delegator only. */
export interface StoredDelegation extends Omit<Delegation, 'mine'> {
  delegatorTenant: string
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
export interface StoredDiscussionPost extends Omit<DiscussionPost, 'reactions' | 'reacted'> {
  authorTenant: string
  reactedBy: string[]
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
export interface StoredDiscussion extends Omit<Discussion, 'posts' | 'mine'> {
  openerTenant: string
  /** S7 — a PRINCIPAL-anchored thread (a DM) also stores the raw tenant id of
   *  the person it was addressed TO, captured when the thread was opened.
   *
   *  The anchor itself carries a DISPLAY NAME, because that is the public face
   *  every social payload wears. But a name is not an identity: `createUser`
   *  guards uniqueness on EMAIL, not name, so two workspaces can wear the same
   *  one — and this repo's own earned rule (tests/social-ui.test.ts) is that
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
export interface StoredSocialProposal extends Omit<SocialProposal, 'mine' | 'deltaBase'> {
  offererTenant: string
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
  sessions: Session[]
  bindings: [string, SessionContext[]][]
  workspaces: [string, SessionWorkspace][]
  schedules: ScheduledTask[]
  recents: RecentsSnapshot
  graph: RelationGraph
  /** Saved-context auth status (Contexts page connect/disconnect). Optional so a
   *  snapshot written before this field loads cleanly (the store defaults to seed). */
  savedContexts?: SavedContext[]
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
  /** Change proposals against published definitions (D25), keyed by target agent
   *  id. Additive-optional like `dispatch`. */
  agentProposals?: [string, StoredAgentProposal[]][]
  /** Registered A2A peers (D28) — verified-identity credentials, hashed. */
  a2aPeers?: [string, StoredA2aPeer][]
  /** The account registry (multi-account P7 — real onboarded accounts): users
   *  (with their server-only scrypt credential), tenants/workspaces, and
   *  memberships. Additive-optional like `dispatch` (a pre-P7 snapshot loads
   *  cleanly; rehydrate keeps the seeds); the seeds are re-ensured on load so a
   *  snapshot can never lose the dev-switcher directory. */
  accountUsers?: [string, AccountUser][]
  accountTenants?: [string, AccountTenant][]
  memberships?: Membership[]
  /** Minted bearer-token registry rows (the revocation authority — contract
   *  `ApiToken`), keyed by userId. Additive-optional like every account slice;
   *  revocation must survive a restart, so the rows persist with the accounts. */
  apiTokens?: [string, ApiToken[]][]
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
  sessions: 'array',
  bindings: 'mapEntries',
  workspaces: 'mapEntries',
  schedules: 'array',
  recents: 'singleton',
  graph: 'singleton',
  savedContexts: 'array',
  providers: 'mapEntries',
  providerConfigs: 'mapEntries',
  systemPrompts: 'mapEntries',
  registryDefaults: 'mapEntries',
  agents: 'mapEntries',
  commissions: 'mapEntries',
  commissionCaps: 'mapEntries',
  projectDefaultRoles: 'mapEntries',
  auditLog: 'array',
  dispatch: 'array',
  openSubGoals: 'array',
  contributions: 'array',
  delegations: 'array',
  grants: 'array',
  discussions: 'array',
  socialProposals: 'array',
  artifactBodies: 'mapEntries',
  mutes: 'mapEntries',
  follows: 'mapEntries',
  discussionReads: 'mapEntries',
  watches: 'array',
  commonsLikes: 'array',
  views: 'array',
  notifications: 'array',
  agentProposals: 'mapEntries',
  a2aPeers: 'mapEntries',
  accountUsers: 'mapEntries',
  accountTenants: 'mapEntries',
  memberships: 'array',
  apiTokens: 'mapEntries',
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

/** The persistence port: load the last snapshot (or null to seed fresh) and save a
 *  new one. Both faces follow the prototype's best-effort contract — `load()`
 *  returns null on *any* failure (absent / unreadable / malformed / version
 *  mismatch) so the caller seeds, and `save()` never throws (a write failure is
 *  logged; the in-memory store stays authoritative until the next write catches up).
 *  `close()` releases a backend's resources (a DB handle); the JSON backend has none. */
export interface PersistenceBackend {
  readonly name: string
  load(): PersistedState | null
  save(state: PersistedState): void
  close(): void
}
