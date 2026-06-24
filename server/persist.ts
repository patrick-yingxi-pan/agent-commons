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
  RecentsSnapshot,
  RelationGraph,
  ScheduledTask,
  Session,
  SessionContext,
  SessionWorkspace,
} from '../contract/index.ts'

/** On-disk schema version. A snapshot whose version doesn't match is ignored (the
 *  store re-seeds), so an incompatible older file can't crash a newer build. */
export const STORE_VERSION = 1

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
  seq: { session: number; message: number; schedule: number; run: number; artifact: number }
}

/** Where the snapshot lives. Override with `DATA_FILE`; defaults to
 *  `.data/store.json` under the process's working directory (the repo root for the
 *  run scripts). Read per-call so a test can point it at a throwaway path. */
function dataFile(): string {
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
