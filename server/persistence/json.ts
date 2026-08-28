/** ── JSON-file persistence backend ───────────────────────────────────────────
 *  The prototype's original on-disk format, now behind the `PersistenceBackend`
 *  port: ONE JSON snapshot of the mutable state, written atomically (temp file +
 *  rename, so a crash mid-write can't leave a half-written store) and loaded once
 *  on boot. The whole state is a few KB, so a full rewrite is correct and trivial
 *  to reason about. This is the development/test default; desktop production selects
 *  SQLite, with both crossing the same portable export/import (design F6 §2.4).
 *
 *  The path is read per call via `dataFile()` (not captured in the constructor), so
 *  a test can repoint `DATA_FILE` between calls — preserving the original semantics. */
import { readFileSync, renameSync, existsSync } from 'node:fs'
import { dataFile, hasCorePersistedShape, type PersistedState, type PersistenceBackend } from './format.ts'
import { migrateState } from './migrate.ts'
import { writeTextFileAtomically } from './atomicFile.ts'

export class JsonFileBackend implements PersistenceBackend {
  readonly name = 'json'

  /** Read the snapshot and bring it up to the current version, or null when there's
   *  no usable persisted state — absent, unreadable, malformed, or un-migratable — so
   *  the caller seeds fresh. (Forward-only data migrations: F1 PD6.) */
  load(): PersistedState | null {
    const file = dataFile()
    try {
      if (!existsSync(file)) return null
      const parsed = JSON.parse(readFileSync(file).toString()) as PersistedState
      const migrated = migrateState(parsed)
      if (migrated && !hasCorePersistedShape(migrated)) {
        throw new Error('store snapshot is missing required core slices')
      }
      return migrated
    } catch (err) {
      // A file that EXISTS but won't parse/migrate is being DISCARDED and reseeded
      // over — preserve the unreadable bytes for post-mortem instead of silently
      // clobbering them (the reseed's next save would overwrite the evidence).
      try {
        if (existsSync(file)) {
          renameSync(file, file + '.corrupt')
          console.error(`[persist] unreadable store snapshot moved to ${file}.corrupt; reseeding:`, err)
        }
      } catch {
        /* preservation is itself best-effort */
      }
      return null
    }
  }

  /** Write the snapshot atomically (temp file + rename). Rename is retried on a
   *  transient Windows EPERM/EBUSY; every terminal failure propagates because
   *  the caller may not acknowledge an undurable mutation. */
  save(state: PersistedState): void {
    const file = dataFile()
    writeTextFileAtomically(file, JSON.stringify(state))
  }

  /** No handle to release — the file is opened per call. */
  close(): void {}
}
