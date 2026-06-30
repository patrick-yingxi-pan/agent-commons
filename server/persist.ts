/** ── Filesystem persistence for the mock backend (facade) ────────────────────
 *  The store is in-memory; this gives it durability, so UI operations that the
 *  backend owns — sent messages, created sessions, attached context + its panels,
 *  schedules, recents, relation edits — survive a server restart instead of
 *  resetting to the seed.
 *
 *  This file is the stable facade the rest of the server (and the snapshot tool)
 *  imports. The actual format lives behind a `PersistenceBackend` port under
 *  `server/persistence/`:
 *    • `json`   — ONE atomic JSON snapshot (the original; default; tests; desktop),
 *    • `sqlite` — an embedded relational store via core `node:sqlite` (design F6 PD28).
 *  `PERSIST_BACKEND` selects between them; the backend is chosen lazily and memoized
 *  (re-selected only if the env flips, which lets a test switch backends).
 *
 *  Only the real server entrypoint (server/index.ts) turns this on, via
 *  `store.initPersistence()`. Tests import the router directly and never call it,
 *  so they drive the store fully in-memory and never touch the filesystem. */
import { selectBackend, backendKind, type BackendKind } from './persistence/index.ts'
import type { PersistedState, PersistenceBackend } from './persistence/format.ts'

// Re-export the persisted shape + format primitives so existing importers
// (server/store.ts, scripts/snapshot.ts, tests/) keep their import paths.
export { STORE_VERSION, dataFile, databaseFile, type PersistedState } from './persistence/format.ts'

/** The active backend, memoized by kind so we don't reopen a DB handle per write.
 *  Re-selected when `PERSIST_BACKEND` changes (only a test does that), closing the
 *  previous one first. */
let active: { kind: BackendKind; backend: PersistenceBackend } | null = null
function backend(): PersistenceBackend {
  const kind = backendKind()
  if (!active || active.kind !== kind) {
    active?.backend.close()
    active = { kind, backend: selectBackend(kind) }
  }
  return active.backend
}

/** Read the snapshot, or null when there's no usable persisted state, so the caller
 *  seeds fresh. (Delegates to the selected backend.) */
export function loadState(): PersistedState | null {
  return backend().load()
}

/** Write the snapshot (best-effort; a failure is logged, not thrown). */
export function saveState(state: PersistedState): void {
  backend().save(state)
}
