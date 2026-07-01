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
  AuditEntry,
  Commission,
  DispatchRun,
  ModelProvider,
  RecentsSnapshot,
  RelationGraph,
  SavedContext,
  ScheduledTask,
  Session,
  SessionContext,
  SessionWorkspace,
  SystemPromptEntry,
} from '../../contract/index.ts'
import type { ProviderConfig } from '../data/providers.ts'
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
  agents?: [string, Agent][]
  commissions?: [string, Commission][]
  /** Per-Project D13 commission caps, as `[projectId, cap]` overlays onto the seed
   *  Projects (which are otherwise re-seeded, not persisted). Optional so a snapshot
   *  written before the field loads cleanly (no caps); only Projects with a cap set
   *  appear. Keeps a conversationally-set cap (the shared confirm card) across a restart. */
  commissionCaps?: [string, number][]
  /** The detective audit trail (D15/OQ7). Optional so a pre-field snapshot loads cleanly
   *  (an empty trail); append-only, so the watch survives a restart. */
  auditLog?: AuditEntry[]
  /** One-off dispatch runs (P7). Optional so a pre-field snapshot loads cleanly (rehydrate
   *  keeps the seed feed); a live run persists so it survives a restart, and a run left
   *  `running` when the process died is swept to `failed` on rehydrate (crash recovery). */
  dispatch?: DispatchRun[]
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
  agents: 'mapEntries',
  commissions: 'mapEntries',
  commissionCaps: 'mapEntries',
  auditLog: 'array',
  dispatch: 'array',
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
