/** Portable persistence export / restore.
 *
 * Backends are an implementation detail of one durable state contract. A backup
 * therefore carries the canonical `PersistedState` JSON, never a copy of the
 * backend's private bytes: a JSON-backed desktop can restore into SQLite (and the
 * reverse), and a future schema implementation does not strand older exports.
 *
 * Restore validates and forward-migrates the export *before* it writes anything,
 * then reads the selected backend back and compares its canonical form. That
 * read-back matters because runtime persistence is intentionally best-effort and
 * logs I/O errors; an explicit recovery command must instead fail loudly when it
 * cannot prove the acknowledged restore landed. */
import {
  readFileSync,
} from 'node:fs'
import {
  hasCorePersistedShape,
  type PersistedState,
  type PersistenceBackend,
} from './format.ts'
import { migrateState } from './migrate.ts'
import { writeTextFileAtomically } from './atomicFile.ts'

function canonical(state: PersistedState): PersistedState {
  return JSON.parse(JSON.stringify(state)) as PersistedState
}

function sameState(left: PersistedState, right: PersistedState): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/** Parse an export without mutating the live backend. Older supported versions
 * are migrated exactly as they are during server boot. */
export function readPortableSnapshot(file: string): PersistedState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`snapshot at ${file} is not readable JSON: ${(err as Error).message}`)
  }
  let state: PersistedState | null
  try {
    state = migrateState(parsed as PersistedState)
  } catch {
    state = null
  }
  if (!hasCorePersistedShape(state)) {
    throw new Error(`snapshot at ${file} has an unsupported or invalid store version`)
  }
  return canonical(state)
}

/** Atomically materialize canonical portable JSON (temp file + rename). */
export function writePortableSnapshot(file: string, state: PersistedState): void {
  const checked = migrateState(canonical(state))
  if (!hasCorePersistedShape(checked)) throw new Error('refusing to export an unsupported or invalid store version')

  try {
    writeTextFileAtomically(file, JSON.stringify(canonical(checked)), `.tmp-${process.pid}`)
  } catch (err) {
    throw new Error(`failed to write portable snapshot at ${file}: ${(err as Error).message}`)
  }
}

/** Export the selected backend through its public state port. */
export function exportBackendSnapshot(
  backend: PersistenceBackend,
  file: string,
): PersistedState {
  const state = backend.load()
  if (!state) {
    throw new Error(`no live persisted state in the ${backend.name} backend`)
  }
  writePortableSnapshot(file, state)
  return canonical(state)
}

/** Restore a portable export into any backend and prove the write landed. */
export function restoreBackendSnapshot(
  backend: PersistenceBackend,
  file: string,
): PersistedState {
  const state = readPortableSnapshot(file)
  return restoreBackendState(backend, state)
}

/** Restore an already-validated state. Kept separate so callers can validate an
 * export before opening (and, for SQLite, possibly creating) the live store. */
export function restoreBackendState(
  backend: PersistenceBackend,
  state: PersistedState,
): PersistedState {
  const checked = migrateState(canonical(state))
  if (!hasCorePersistedShape(checked)) {
    throw new Error('refusing to restore an unsupported or invalid store version')
  }
  backend.save(checked)
  const restored = backend.load()
  if (!restored || !sameState(restored, checked)) {
    throw new Error(`the ${backend.name} backend did not retain the restored snapshot`)
  }
  return canonical(restored)
}
