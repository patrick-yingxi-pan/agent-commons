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
 *  `load()` returns null only for a database created by this backend on first boot;
 *  existing unreadable/incompatible state throws so it cannot be silently replaced.
 *  `save()` throws on any failed transaction so the caller cannot acknowledge an
 *  undurable mutation. An uncategorized slice is also loud. */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import {
  SLICE_KIND,
  databaseFile,
  hasCorePersistedShape,
  type PersistedState,
  type PersistenceBackend,
} from './format.ts'
import { migrateState } from './migrate.ts'
import type { ImageSnapshot } from '../../contract/imageInput.ts'

function sameImage(a: ImageSnapshot, b: ImageSnapshot): boolean {
  return a.data === b.data && a.mimeType === b.mimeType && a.width === b.width && a.height === b.height && a.byteLength === b.byteLength
}

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
const SQLITE_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const APPLICATION_TABLES = ['schema_migrations', 'kv', 'entities', 'map_entries'] as const

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
  {
    version: 2,
    sql: `
      CREATE TABLE image_assets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        image_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ord INTEGER NOT NULL
      );
      CREATE INDEX image_assets_by_tenant ON image_assets (tenant_id);
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
  readonly #path: string
  readonly #freshAtOpen: boolean
  // The process owns this connection. Retain immutable content references so an
  // ordinary small mutation need not reread/re-encode the entire image library.
  #imageContent = new Map<string, ImageSnapshot>()

  /** Opens (creating if absent) the database at `path` and brings its schema up to
   *  date. `path` defaults to `databaseFile()`; tests pass `':memory:'` or a temp
   *  file. Throws if `node:sqlite` is unavailable or the file can't be opened —
   *  sqlite is opt-in, so a misconfiguration should fail loudly, not silently. */
  constructor(path: string = databaseFile()) {
    this.#path = path
    const mainExists = path !== ':memory:' && existsSync(path)
    const orphan = path === ':memory:' || mainExists
      ? undefined
      : SQLITE_COMPANION_SUFFIXES.map((suffix) => `${path}${suffix}`).find(existsSync)
    this.#freshAtOpen = path === ':memory:' || (!mainExists && !orphan)
    if (orphan) throw new Error(`[persist] SQLite store is missing while recovery data remains at ${orphan}`)
    if (path !== ':memory:') {
      const dir = dirname(path)
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    // Lazy `require` so importing this module is cheap and `node:sqlite`'s
    // experimental warning only fires when the backend is actually constructed.
    const require = createRequire(import.meta.url)
    const { DatabaseSync } = require('node:sqlite') as SqliteModule
    this.#db = new DatabaseSync(path)
    try {
      // A pre-existing SQLite file must first prove it belongs to this application.
      // Otherwise #migrate would CREATE our schema inside an unrelated/partially
      // corrupted database before startup eventually refused it.
      if (!this.#freshAtOpen) {
        const tables = new Set(
          this.#db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)),
        )
        const missing = APPLICATION_TABLES.filter((table) => !tables.has(table))
        if (missing.length) throw new Error(`existing database has no complete Agent Commons schema marker (${missing.join(', ')} missing)`)
      }
      // WAL: concurrent readers + a single writer, and better crash recovery than the
      // rollback journal. (No `foreign_keys` pragma — the schema declares no FKs yet.)
      this.#db.exec('PRAGMA journal_mode = WAL;')
      this.#migrate()
    } catch (error) {
      try {
        this.#db.close()
      } catch {
        /* preserve the original startup failure */
      }
      throw error
    }
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

  /** Reconstruct `PersistedState` from the three tables. A database created by this
   *  backend with no manifest is genuine first boot and returns null. Missing state
   *  in an existing file, incompatible versions, invalid shape, and read failures
   *  throw so startup cannot replace acknowledged data with seeds. */
  load(): PersistedState | null {
    try {
      const slicesRow = this.#db.prepare('SELECT json FROM kv WHERE key = ?').get(SLICES_KEY)
      if (!slicesRow) {
        if (this.#freshAtOpen) return null
        throw new Error('store manifest is missing from an existing database')
      }
      const present = JSON.parse(String(slicesRow.json)) as (keyof PersistedState)[]

      const result: Record<string, unknown> = {}
      for (const key of present) {
        const kind = SLICE_KIND[key]
        if (!kind) continue // a slice this build no longer knows — skip it
        if (key === 'imageAssets') {
          const rows = this.#db.prepare('SELECT id, tenant_id, image_json, created_at FROM image_assets ORDER BY ord').all()
          result[key] = rows.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), image: JSON.parse(String(r.image_json)), createdAt: Number(r.created_at) }))
          continue
        }
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

      // Bring a supported older snapshot up to the current version (F1 PD6).
      const migrated = migrateState(result as unknown as PersistedState)
      if (!migrated) throw new Error('store version is unsupported or has no migration path')
      if (!hasCorePersistedShape(migrated)) throw new Error('store snapshot is missing required core slices')
      this.#imageContent = new Map((migrated.imageAssets ?? []).map((row) => [row.id, { ...row.image }]))
      return migrated
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`[persist] existing SQLite store at ${this.#path} is unreadable or incompatible: ${detail}`)
    }
  }

  /** Replace the logical snapshot in one transaction. Legacy slices are rewritten;
   *  immutable image rows are diff-synced so unchanged content is never updated.
   *  Any failed transaction throws after rollback. */
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
      const desiredImages = state.imageAssets ?? []
      const existingImages = new Map(this.#db.prepare('SELECT id, tenant_id, created_at, ord FROM image_assets').all().map((r) => [String(r.id), r]))
      const wantedImages = new Set(desiredImages.map((row) => row.id))
      const removeImage = this.#db.prepare('DELETE FROM image_assets WHERE id = ?')
      for (const id of existingImages.keys()) if (!wantedImages.has(id)) removeImage.run(id)
      const insertImage = this.#db.prepare('INSERT INTO image_assets (id, tenant_id, image_json, created_at, ord) VALUES (?, ?, ?, ?, ?)')
      const updateImage = this.#db.prepare('UPDATE image_assets SET tenant_id = ?, image_json = ?, created_at = ?, ord = ? WHERE id = ?')
      const reorderImage = this.#db.prepare('UPDATE image_assets SET ord = ? WHERE id = ?')
      const readImage = this.#db.prepare('SELECT image_json FROM image_assets WHERE id = ?')
      const nextImageContent = new Map<string, ImageSnapshot>()
      for (const [ord, row] of desiredImages.entries()) {
        const old = existingImages.get(row.id)
        const priorContent = old && (this.#imageContent.get(row.id) ?? JSON.parse(String(readImage.get(row.id)?.image_json)) as ImageSnapshot)
        if (!old) insertImage.run(row.id, row.tenantId, JSON.stringify(row.image), row.createdAt, ord)
        else if (String(old.tenant_id) !== row.tenantId || !priorContent || !sameImage(priorContent, row.image) || Number(old.created_at) !== row.createdAt) updateImage.run(row.tenantId, JSON.stringify(row.image), row.createdAt, ord, row.id)
        else if (Number(old.ord) !== ord) reorderImage.run(ord, row.id)
        nextImageContent.set(row.id, { ...row.image })
      }
      for (const key of present) {
        const kind = SLICE_KIND[key]
        const value = state[key]
        if (key === 'imageAssets') {
          continue
        } else if (kind === 'singleton') {
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
      this.#imageContent = nextImageContent
    } catch (err) {
      try {
        this.#db.exec('ROLLBACK')
      } catch {
        /* nothing to roll back */
      }
      throw err
    }
  }

  close(): void {
    this.#db.close()
  }
}
