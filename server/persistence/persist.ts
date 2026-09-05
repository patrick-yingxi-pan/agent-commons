/** ── Filesystem persistence for the mock backend (facade) ────────────────────
 *  The store is in-memory; this gives it durability, so UI operations that the
 *  backend owns — sent messages, created sessions, attached context + its panels,
 *  schedules, recents, relation edits — survive a server restart instead of
 *  resetting to the seed.
 *
 *  This file is the stable facade the rest of the server (and the snapshot tool)
 *  imports. The actual format lives behind a `PersistenceBackend` port under
 *  `server/persistence/`:
 *    • `json`   — ONE atomic JSON snapshot (the development/test default),
 *    • `sqlite` — the desktop production store via core `node:sqlite` (design F6 PD28).
 *  `PERSIST_BACKEND` selects between them; the backend is chosen lazily and memoized
 *  (re-selected only if the env flips, which lets a test switch backends).
 *
 *  Only the real server entrypoint (server/index.ts) turns this on, via
 *  `store.initPersistence()`. Tests import the router directly and never call it,
 *  so they drive the store fully in-memory and never touch the filesystem. */
import { selectBackend, backendKind, type BackendKind } from './index.ts'
import type { PersistedState, PersistenceBackend } from './format.ts'

/** Cross-layer durability failure. The router recognizes this exact class and
 * returns a non-leaking 503; `detail` stays server-side for diagnostics. */
export class PersistenceWriteError extends Error {
  readonly detail: unknown

  constructor(detail: unknown) {
    super('Durable storage could not commit this change.')
    this.name = 'PersistenceWriteError'
    this.detail = detail
  }
}

/** Startup integrity failure. Only a genuinely absent backend may seed. Existing
 * unreadable or incompatible state is never converted into an empty world. */
export class PersistenceLoadError extends Error {
  readonly backend: BackendKind
  readonly detail: unknown

  constructor(backend: BackendKind, detail: unknown) {
    const reason = detail instanceof Error ? detail.message : String(detail)
    super(`Durable ${backend} storage could not be loaded. Refusing to replace existing data. ${reason}`)
    this.name = 'PersistenceLoadError'
    this.backend = backend
    this.detail = detail
  }
}

// Re-export the persisted shape + format primitives so existing importers
// (server/store/index.ts, scripts/snapshot.ts, tests/) keep their import paths.
export { STORE_VERSION, dataFile, databaseFile, type PersistedState, type StoredNotification, type StoredAgentProposal, type StoredA2aPeer, type StoredOpenSubGoal, type StoredWorkItemComment, type StoredContribution, type StoredContributionEvent, type StoredDelegation, type StoredDelegationRetirement, type StoredGrant, type StoredDiscussion, type StoredDiscussionPost, type StoredSocialProposal } from './format.ts'

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

/** Read the snapshot. Null means genuine first boot only. Any existing unreadable,
 * malformed, structurally invalid, or incompatible state becomes a recognizable
 * startup error so the process exits before it can seed or listen. */
export function loadState(): PersistedState | null {
  const kind = backendKind()
  try {
    return backend().load()
  } catch (error) {
    if (error instanceof PersistenceLoadError) throw error
    throw new PersistenceLoadError(kind, error)
  }
}

/** Write the snapshot. A failure is a product acknowledgement boundary: wrap it
 * in one recognizable error and let the store fail closed. */
export function saveState(state: PersistedState): void {
  try {
    backend().save(state)
  } catch (error) {
    if (error instanceof PersistenceWriteError) throw error
    throw new PersistenceWriteError(error)
  }
}

/** Release the active backend handle. The server normally owns it for the
 * process lifetime; recovery/build tooling closes it before repointing storage so
 * SQLite checkpoints its WAL and no late call keeps writing to the old path. */
export function closePersistence(): void {
  active?.backend.close()
  active = null
}
