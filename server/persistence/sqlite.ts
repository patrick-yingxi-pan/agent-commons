/** ── Embedded-SQLite persistence backend ─────────────────────────────────────
 *  The production design's "embedded SQLite on desktop" (F6 PD28) made real, with
 *  **zero new dependencies**: Node ships `node:sqlite` (`DatabaseSync`) in core, so
 *  the prototype's "few runtime dependencies" rule survives even as we move off the
 *  single JSON blob onto a real relational store.
 *
 *  Selected with `PERSIST_BACKEND=sqlite` (the default stays JSON, so existing runs
 *  and the in-memory test suite are unchanged). Storage shape, driven entirely off
 *  the shared `SLICE_KIND` manifest so it can't drift from `PersistedState`:
 *    • `kv(key, json)`              — singleton slices + the `__slices__` manifest row,
 *    • `entities(slice, idx, …)`    — ordered list slices, one row per entity,
 *    • `map_entries(slice, key, …)` — `Map`-as-entries slices, one row per entry.
 *  Each value is stored as a JSON column for now; columns can be *promoted* out of
 *  JSON later via a forward-only migration (PD28) without a format break — that's why
 *  the schema is migration-managed from day one. Per-entity rows (vs one blob) are
 *  the point: real updates/deletes and a place to index by id as the store grows.
 *
 *  Best-effort, like the JSON backend: `load()` returns null on any failure and
 *  `save()` swallows I/O errors. It *does* throw if asked to persist a slice that
 *  isn't in the manifest — that's a coding error (a new `PersistedState` field left
 *  uncategorized) that would silently lose data, so it must be loud, not swallowed. */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import {
  SLICE_KIND,
  databaseFile,
  type PersistedState,
  type PersistenceBackend,
} from './format.ts'
import { migrateState } from './migrate.ts'

// ── Minimal local typing for the `node:sqlite` surface we use ─────────────────
// (the server hand-rolls its Node types in node.d.ts rather than pull in @types/node).
type SqliteValue = string | number | bigint | null | Uint8Array
interface SqliteStatement {
  run(...params: SqliteValue[]): { changes: number; lastInsertRowid: number | bigint }
  all(...params: SqliteValue[]): Record<string, unknown>[]
  get(...params: SqliteValue[]): Record<string, unknown> | undefined
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase
}

/** The `__slices__` manifest row records which top-level keys were present in the
 *  saved state, so load reconstructs exactly the JSON-canonical shape (an absent
 *  optional slice stays absent; a present-but-empty array comes back as `[]`). */
const SLICES_KEY = '__slices__'

/** Forward-only, ordered schema migrations (F6 PD28). Each runs once, in a
 *  transaction, recorded in `schema_migrations`. Append new migrations; never edit a
 *  shipped one — that's how the on-disk schema evolves without discard-and-reseed. */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE kv (
        key  TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE entities (
        slice     TEXT    NOT NULL,
        idx       INTEGER NOT NULL,
        entity_id TEXT,
        json      TEXT    NOT NULL,
        PRIMARY KEY (slice, idx)
      );
      CREATE INDEX entities_by_id ON entities (slice, entity_id);
      CREATE TABLE map_entries (
        slice TEXT    NOT NULL,
        key   TEXT    NOT NULL,
        ord   INTEGER NOT NULL,
        json  TEXT    NOT NULL,
        PRIMARY KEY (slice, key)
      );
    `,
  },
]

/** Best-effort id extraction for the `entities.entity_id` index column — populated
 *  for queryability only; reconstruction never reads it. */
function idOf(value: unknown): string | null {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return null
}

export class SqliteBackend implements PersistenceBackend {
  readonly name = 'sqlite'
  readonly #db: SqliteDatabase

  /** Opens (creating if absent) the database at `path` and brings its schema up to
   *  date. `path` defaults to `databaseFile()`; tests pass `':memory:'` or a temp
   *  file. Throws if `node:sqlite` is unavailable or the file can't be opened —
   *  sqlite is opt-in, so a misconfiguration should fail loudly, not silently. */
  constructor(path: string = databaseFile()) {
    if (path !== ':memory:') {
      const dir = dirname(path)
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    // Lazy `require` so importing this module is cheap and `node:sqlite`'s
    // experimental warning only fires when the backend is actually constructed.
    const require = createRequire(import.meta.url)
    const { DatabaseSync } = require('node:sqlite') as SqliteModule
    this.#db = new DatabaseSync(path)
    // WAL: concurrent readers + a single writer, and better crash recovery than the
    // rollback journal. (No `foreign_keys` pragma — the schema declares no FKs yet.)
    this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#migrate()
  }

  /** Apply any unapplied migrations in order, each in its own transaction. */
  #migrate(): void {
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    INTEGER PRIMARY KEY,
         applied_at TEXT    NOT NULL
       );`,
    )
    const applied = new Set(
      this.#db.prepare('SELECT version FROM schema_migrations').all().map((r) => Number(r.version)),
    )
    const record = this.#db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue
      this.#db.exec('BEGIN')
      try {
        this.#db.exec(m.sql)
        record.run(m.version, new Date().toISOString())
        this.#db.exec('COMMIT')
      } catch (err) {
        this.#db.exec('ROLLBACK')
        throw err
      }
    }
  }

  /** Reconstruct `PersistedState` from the three tables, or null when there's no
   *  usable state — no `__slices__` row (fresh db), a version mismatch, or any read
   *  failure — so the caller seeds fresh. */
  load(): PersistedState | null {
    try {
      const slicesRow = this.#db.prepare('SELECT json FROM kv WHERE key = ?').get(SLICES_KEY)
      if (!slicesRow) return null
      const present = JSON.parse(String(slicesRow.json)) as (keyof PersistedState)[]

      const result: Record<string, unknown> = {}
      for (const key of present) {
        const kind = SLICE_KIND[key]
        if (!kind) continue // a slice this build no longer knows — skip it
        if (kind === 'singleton') {
          const row = this.#db.prepare('SELECT json FROM kv WHERE key = ?').get(key)
          if (row) result[key] = JSON.parse(String(row.json))
        } else if (kind === 'array') {
          const rows = this.#db
            .prepare('SELECT json FROM entities WHERE slice = ? ORDER BY idx')
            .all(key)
          result[key] = rows.map((r) => JSON.parse(String(r.json)))
        } else {
          const rows = this.#db
            .prepare('SELECT key, json FROM map_entries WHERE slice = ? ORDER BY ord')
            .all(key)
          result[key] = rows.map((r) => [String(r.key), JSON.parse(String(r.json))])
        }
      }

      // Bring an older snapshot up to the current version (F1 PD6); a newer or
      // un-migratable one ⇒ null ⇒ reseed.
      return migrateState(result as unknown as PersistedState)
    } catch {
      return null
    }
  }

  /** Replace the whole snapshot in one transaction (a full rewrite, mirroring the
   *  JSON backend — the state is small and this keeps "no stale rows" trivially
   *  true). Throws on an uncategorized slice (a coding error); swallows I/O errors. */
  save(state: PersistedState): void {
    const present = (Object.keys(state) as (keyof PersistedState)[]).filter(
      (k) => state[k] !== undefined,
    )
    const unknown = present.filter((k) => !SLICE_KIND[k])
    if (unknown.length) {
      throw new Error(`[persist] uncategorized slice(s) in SLICE_KIND: ${unknown.join(', ')}`)
    }

    try {
      this.#db.exec('BEGIN')
      this.#db.exec('DELETE FROM kv; DELETE FROM entities; DELETE FROM map_entries;')

      const putKv = this.#db.prepare('INSERT INTO kv (key, json) VALUES (?, ?)')
      const putEntity = this.#db.prepare(
        'INSERT INTO entities (slice, idx, entity_id, json) VALUES (?, ?, ?, ?)',
      )
      const putMapEntry = this.#db.prepare(
        'INSERT INTO map_entries (slice, key, ord, json) VALUES (?, ?, ?, ?)',
      )

      putKv.run(SLICES_KEY, JSON.stringify(present))
      for (const key of present) {
        const kind = SLICE_KIND[key]
        const value = state[key]
        if (kind === 'singleton') {
          putKv.run(key, JSON.stringify(value))
        } else if (kind === 'array') {
          ;(value as unknown[]).forEach((item, idx) => {
            putEntity.run(key, idx, idOf(item), JSON.stringify(item))
          })
        } else {
          ;(value as [string, unknown][]).forEach(([k, v], ord) => {
            putMapEntry.run(key, k, ord, JSON.stringify(v))
          })
        }
      }

      this.#db.exec('COMMIT')
    } catch (err) {
      try {
        this.#db.exec('ROLLBACK')
      } catch {
        /* nothing to roll back */
      }
      console.error('[persist] failed to write store snapshot (sqlite):', err)
    }
  }

  close(): void {
    this.#db.close()
  }
}
