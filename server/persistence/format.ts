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
  A2aPeer,
  AppNotification,
  AuditEntry,
  Commission,
  DispatchRun,
  OpenSubGoal,
  ModelProvider,
  PrincipalRef,
  ProjectRole,
  RecentsSnapshot,
  RelationGraph,
  SavedContext,
  ScheduledTask,
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

/** A notification as STORED — the wire row plus its recipient tenant (server-private;
 *  the tenant-scoped read serves only the caller's own rows, as `AppNotification`). */
export interface StoredNotification extends AppNotification {
  tenantId: string
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
  /** Watch subscriptions (D24) — `[tenantId, projectId]` pairs (tuples, not a Map:
   *  a project has many watchers). Additive-optional like `dispatch` (a pre-field
   *  snapshot loads cleanly with no watches). */
  watches?: [string, string][]
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
  watches: 'array',
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
