/** ── Filesystem persistence for the mock backend ────────────────────────────
 *  The store is in-memory; this gives it durability, so UI operations that the
 *  backend owns — sent messages, created sessions, attached context + its panels,
 *  schedules, recents, relation edits — survive a server restart instead of
 *  resetting to the seed.
 *
 *  Simplest viable format (we'll refine later): ONE JSON snapshot of the mutable
 *  state, written atomically on each mutation and loaded once on boot. Not a log,
 *  not per-resource files — the whole state is a few KB, so a full rewrite is
 *  correct and trivial to reason about. Atomicity is a temp-file + rename, so a
 *  crash mid-write can't leave a half-written (corrupt) store.json.
 *
 *  Only the real server entrypoint (server/index.ts) turns this on, via
 *  `store.initPersistence()`. Tests import the router directly and never call it,
 *  so they drive the store fully in-memory and never touch the filesystem. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type {
  Agent,
  Commission,
  ModelProvider,
  RecentsSnapshot,
  RelationGraph,
  SavedContext,
  ScheduledTask,
  Session,
  SessionContext,
  SessionWorkspace,
  SystemPromptEntry,
} from '../contract/index.ts'
import type { ProviderConfig } from './data/providers.ts'

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
 *  A snapshot whose version is below the current one is incompatible → re-seed. */
export const STORE_VERSION = 4

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
  }
}

/** Where the snapshot lives. Override with `DATA_FILE`; defaults to
 *  `.data/store.json` under the process's working directory (the repo root for the
 *  run scripts). Read per-call so a test can point it at a throwaway path.
 *  Exported so the backup tool (scripts/snapshot.ts) resolves the SAME path the
 *  store reads/writes, rather than re-deriving (and drifting from) it. */
export function dataFile(): string {
  return process.env.DATA_FILE ?? join(process.cwd(), '.data', 'store.json')
}

/** Read the snapshot, or null when there's no usable persisted state — absent,
 *  unreadable, malformed, or a version mismatch — so the caller seeds fresh. */
export function loadState(): PersistedState | null {
  try {
    const file = dataFile()
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file).toString()) as PersistedState
    if (!parsed || parsed.version !== STORE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/** Write the snapshot atomically (temp file + rename). Best-effort: a write
 *  failure is logged and swallowed — the in-memory store stays authoritative for
 *  the session, and the next successful write catches up. */
export function saveState(state: PersistedState): void {
  try {
    const file = dataFile()
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, file)
  } catch (err) {
    console.error('[persist] failed to write store snapshot:', err)
  }
}
