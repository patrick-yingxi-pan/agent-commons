/** ── JSON-file persistence backend ───────────────────────────────────────────
 *  The prototype's original on-disk format, now behind the `PersistenceBackend`
 *  port: ONE JSON snapshot of the mutable state, written atomically (temp file +
 *  rename, so a crash mid-write can't leave a half-written store) and loaded once
 *  on boot. The whole state is a few KB, so a full rewrite is correct and trivial
 *  to reason about. This is the default backend (desktop + tests), and the spiritual
 *  ancestor of the desktop export/import (design F6 §2.4).
 *
 *  The path is read per call via `dataFile()` (not captured in the constructor), so
 *  a test can repoint `DATA_FILE` between calls — preserving the original semantics. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataFile, type PersistedState, type PersistenceBackend } from './format.ts'
import { migrateState } from './migrate.ts'

export class JsonFileBackend implements PersistenceBackend {
  readonly name = 'json'

  /** Read the snapshot and bring it up to the current version, or null when there's
   *  no usable persisted state — absent, unreadable, malformed, or un-migratable — so
   *  the caller seeds fresh. (Forward-only data migrations: F1 PD6.) */
  load(): PersistedState | null {
    try {
      const file = dataFile()
      if (!existsSync(file)) return null
      const parsed = JSON.parse(readFileSync(file).toString()) as PersistedState
      return migrateState(parsed)
    } catch {
      return null
    }
  }

  /** Write the snapshot atomically (temp file + rename). Best-effort: a write
   *  failure is logged and swallowed — the in-memory store stays authoritative for
   *  the session, and the next successful write catches up. */
  save(state: PersistedState): void {
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

  /** No handle to release — the file is opened per call. */
  close(): void {}
}
