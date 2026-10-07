/** Safe offline replacement for an existing SQLite store that cannot be opened.
 * Build and prove a portable snapshot in a private sibling before touching the
 * current store. The caller must stop every live service first. */
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { SqliteBackend } from './sqlite.ts'
import type { PersistedState, PersistenceBackend } from './format.ts'
import { restoreBackendState } from './portable.ts'

const SQLITE_COMPANIONS = ['-wal', '-shm', '-journal'] as const
type BackendFactory = (path: string) => PersistenceBackend

function syncPath(path: string, directory = false): void {
  if (process.platform === 'win32') return
  const fd = openSync(path, directory ? 'r' : 'r+')
  try { fsyncSync(fd) }
  finally { closeSync(fd) }
}

function regularSlotExists(path: string): boolean {
  let details
  try { details = lstatSync(path) }
  catch (error) {
    if ((error as { code?: string })?.code === 'ENOENT') return false
    throw error
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`refusing to replace non-file SQLite storage at ${path}`)
  }
  return true
}

/** Replace a damaged SQLite file without ever leaving its main pathname absent.
 * Sidecars are moved only after their old names are durable in staging. A
 * same-directory rename then atomically replaces the main database. If final
 * path read-back fails, roll back to the preserved old database and sidecars. */
export function restoreDamagedSqlite(
  to: string,
  state: PersistedState,
  createBackend: BackendFactory = (path) => new SqliteBackend(path),
): void {
  const directory = dirname(to)
  const originalDatabaseExists = regularSlotExists(to)
  const existingSidecarPaths = SQLITE_COMPANIONS
    .map((suffix) => `${to}${suffix}`)
    .filter(regularSlotExists)
  if (!originalDatabaseExists && existingSidecarPaths.length > 0) {
    throw new Error('refusing damaged-SQLite recovery without an existing main database file')
  }
  const staging = mkdtempSync(join(directory, '.agent-commons-restore-'))
  const stagedDatabase = join(staging, basename(to))
  const originalSidecars = existingSidecarPaths
    .map((original) => ({ original, saved: join(staging, `previous-${basename(original)}`) }))
  const savedDatabase = join(staging, `previous-${basename(to)}`)
  const movedSidecars: { saved: string; original: string }[] = []
  let databasePublished = false
  let preserveStaging = false

  try {
    const staged = createBackend(stagedDatabase)
    try {
      restoreBackendState(staged, state)
    } finally {
      staged.close()
    }

    const stagedPaths = [stagedDatabase, ...SQLITE_COMPANIONS.map((suffix) => `${stagedDatabase}${suffix}`)]
      .filter(existsSync)
    if (!stagedPaths.includes(stagedDatabase)) throw new Error('the staged SQLite replacement is missing')
    if (stagedPaths.length !== 1) throw new Error('the staged SQLite replacement did not checkpoint its sidecar files')
    for (const stagedPath of stagedPaths) syncPath(stagedPath)
    syncPath(staging, true)
    syncPath(directory, true)

    // Preserve the live main file without removing its pathname. Removing it
    // first could let a crash restart into a newly seeded, empty profile.
    if (originalDatabaseExists) linkSync(to, savedDatabase)
    syncPath(staging, true)

    // Old WAL/SHM/journal files must not be paired with the replacement main.
    for (const sidecar of originalSidecars) {
      renameSync(sidecar.original, sidecar.saved)
      movedSidecars.push(sidecar)
    }
    syncPath(directory, true)
    syncPath(staging, true)

    // Since staging is a sibling, rename atomically replaces `to` on supported
    // filesystems. At every crash boundary an old or validated new main remains.
    renameSync(stagedDatabase, to)
    databasePublished = true
    syncPath(directory, true)

    const finalBackend = createBackend(to)
    let finalState
    try {
      finalState = finalBackend.load()
    } finally {
      finalBackend.close()
    }
    if (!finalState || JSON.stringify(finalState) !== JSON.stringify(state)) {
      throw new Error('the published SQLite replacement did not retain the selected backup')
    }
    for (const suffix of SQLITE_COMPANIONS) {
      if (regularSlotExists(`${to}${suffix}`)) syncPath(`${to}${suffix}`)
    }
    syncPath(to)
    syncPath(directory, true)
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (databasePublished) {
      // Final verification may create WAL/SHM files; remove them before old
      // sidecars are restored, or SQLite could pair them with the old main.
      for (const suffix of SQLITE_COMPANIONS) {
        try { rmSync(`${to}${suffix}`, { force: true }) }
        catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
      try {
        if (originalDatabaseExists) renameSync(savedDatabase, to)
        else rmSync(to, { force: true })
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    for (const { saved, original } of movedSidecars.reverse()) {
      try {
        if (existsSync(saved)) renameSync(saved, original)
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    try {
      if (originalDatabaseExists) {
        if (!regularSlotExists(to)) throw new Error(`restored SQLite main file is missing at ${to}`)
        syncPath(to)
      } else if (regularSlotExists(to)) {
        throw new Error(`unexpected SQLite main file remains at ${to}`)
      }
      for (const { original } of originalSidecars) {
        if (!regularSlotExists(original)) throw new Error(`restored SQLite companion is missing at ${original}`)
        syncPath(original)
      }
      syncPath(directory, true)
      syncPath(staging, true)
    } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    if (rollbackErrors.length > 0) {
      preserveStaging = true
      throw new Error(`SQLite restore failed and its original files are preserved in ${staging}.`, {
        cause: new AggregateError([error, ...rollbackErrors], 'SQLite replacement rollback was incomplete'),
      })
    }
    throw error
  } finally {
    if (!preserveStaging) {
      try {
        rmSync(staging, { recursive: true, force: true })
        syncPath(directory, true)
      } catch { /* the replacement is proven; a leftover staging copy is harmless */ }
    }
  }
}
