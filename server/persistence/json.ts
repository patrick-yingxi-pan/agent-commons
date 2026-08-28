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
import { readFileSync, existsSync } from 'node:fs'
import { dataFile, hasCorePersistedShape, type PersistedState, type PersistenceBackend } from './format.ts'
import { migrateState } from './migrate.ts'
import { writeTextFileAtomically } from './atomicFile.ts'

export class JsonFileBackend implements PersistenceBackend {
  readonly name = 'json'

  /** Read an existing snapshot and bring it up to the current version. Only genuine
   *  absence returns null (first boot). Existing unreadable, malformed, structurally
   *  invalid, or un-migratable bytes throw and remain untouched for recovery. */
  load(): PersistedState | null {
    const file = dataFile()
    if (!existsSync(file)) {
      const recovery = [`${file}.tmp`, `${file}.corrupt`].find(existsSync)
      if (recovery) throw new Error(`[persist] live JSON store is missing while recovery data remains at ${recovery}`)
      return null
    }
    try {
      const parsed = JSON.parse(readFileSync(file).toString()) as PersistedState
      const migrated = migrateState(parsed)
      if (!migrated) throw new Error('store version is unsupported or has no migration path')
      if (!hasCorePersistedShape(migrated)) throw new Error('store snapshot is missing required core slices')
      return migrated
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`[persist] existing JSON store at ${file} is unreadable or incompatible: ${detail}`)
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
