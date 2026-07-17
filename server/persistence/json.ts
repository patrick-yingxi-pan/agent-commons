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

/** A synchronous best-effort spin-wait (no async in the save path — persistence
 *  is called from synchronous mutators). Short, bounded; only reached on the rare
 *  Windows `renameSync` EPERM/EBUSY (an AV/indexer momentarily holding the file). */
function briefStall(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* spin — a few ms at most, only on a contended rename */
  }
}

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
      return migrateState(parsed)
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

  /** Write the snapshot atomically (temp file + rename). Best-effort, but the
   *  rename is RETRIED on a transient Windows EPERM/EBUSY (an AV/indexer holding
   *  the target) — without the retry, the failed write is dropped and, since
   *  persistence has no shutdown flush, the last write before exit could be lost. */
  save(state: PersistedState): void {
    try {
      const file = dataFile()
      const dir = dirname(file)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = file + '.tmp'
      writeFileSync(tmp, JSON.stringify(state))
      for (let attempt = 0; ; attempt++) {
        try {
          renameSync(tmp, file)
          return
        } catch (err) {
          const code = (err as { code?: string }).code
          if ((code === 'EPERM' || code === 'EBUSY') && attempt < 3) {
            briefStall(15 * (attempt + 1))
            continue
          }
          throw err
        }
      }
    } catch (err) {
      console.error('[persist] failed to write store snapshot:', err)
    }
  }

  /** No handle to release — the file is opened per call. */
  close(): void {}
}
