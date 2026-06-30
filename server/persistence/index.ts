/** ── Persistence backend selection ───────────────────────────────────────────
 *  One place that maps `PERSIST_BACKEND` to a concrete backend. Default is `json`
 *  (the prototype's original behaviour — desktop + the in-memory test suite are
 *  unchanged); `sqlite` opts into the embedded relational store (design F6 PD28).
 *
 *  Importing this module is cheap and does NOT load `node:sqlite`: `SqliteBackend`'s
 *  `require('node:sqlite')` lives inside its constructor, so the experimental SQLite
 *  warning only fires when a sqlite backend is actually constructed. */
import type { PersistenceBackend } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

export type BackendKind = 'json' | 'sqlite'

/** The configured backend kind (lower-cased), defaulting to `json`. */
export function backendKind(): BackendKind {
  return (process.env.PERSIST_BACKEND ?? 'json').toLowerCase() === 'sqlite' ? 'sqlite' : 'json'
}

/** Construct the backend for the given kind (defaults to the configured one). */
export function selectBackend(kind: BackendKind = backendKind()): PersistenceBackend {
  return kind === 'sqlite' ? new SqliteBackend() : new JsonFileBackend()
}

export { JsonFileBackend } from './json.ts'
export { SqliteBackend } from './sqlite.ts'
