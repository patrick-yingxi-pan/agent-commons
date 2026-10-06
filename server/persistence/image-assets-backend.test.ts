import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteBackend } from './sqlite.ts'
import { STORE_VERSION, type PersistedState } from './format.ts'
import { ImageAssetRegistry } from '../imageAssets.ts'
import type { ImageSnapshot } from '../../contract/imageInput.ts'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { JsonFileBackend } from './json.ts'
import { restoreBackendSnapshot, restoreBackendState, writePortableSnapshot } from './portable.ts'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { imageOriginal, type ImageOriginal } from '../../contract/imageOriginal.ts'

const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
const image: ImageSnapshot = { mimeType: 'image/png', data: Buffer.from(bytes).toString('base64'), width: 1, height: 1, byteLength: bytes.length }
const originalBytes = Uint8Array.from(Buffer.from('original source bytes'))
const original: ImageOriginal = imageOriginal('source.png', originalBytes)
const baseline = (): PersistedState => ({
  version: STORE_VERSION, sessions: [], bindings: [], workspaces: [], schedules: [],
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] } as never,
  graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} } as never,
  seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
})

test('SQLite persists image bytes and explicitly clears absent/empty image slices', () => {
  const registry = new ImageAssetRegistry()
  const row = registry.put('tenant-a', image, 9)
  const db = new SqliteBackend(':memory:')
  try {
    db.save({ ...baseline(), imageAssets: [row] })
    assert.deepEqual(db.load()?.imageAssets, [row])
    db.save(baseline())
    assert.deepEqual(db.load()?.imageAssets, undefined)
    db.save({ ...baseline(), imageAssets: [] })
    assert.deepEqual(db.load()?.imageAssets, [])
  } finally {
    db.close()
  }
})

test('JSON and SQLite preserve optional originals and legacy normalized-only rows', (t) => {
  const withOriginal = new ImageAssetRegistry().put('tenant-a', image, 9, original)
  const legacy = new ImageAssetRegistry().put('tenant-b', image, 10)
  const state = { ...baseline(), imageAssets: [withOriginal, legacy] }
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-original-backend-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const jsonFile = join(directory, 'store.json')
  const old = process.env.DATA_FILE
  try {
    writeFileSync(jsonFile, JSON.stringify(state))
    process.env.DATA_FILE = jsonFile
    assert.deepEqual(new JsonFileBackend().load()?.imageAssets, state.imageAssets,
      'JSON load preserves the original and legacy row shape')

    const db = new SqliteBackend(':memory:')
    try {
      db.save(state)
      assert.deepEqual(db.load()?.imageAssets, state.imageAssets,
        'SQLite load preserves the original and legacy row shape')
    } finally {
      db.close()
    }
  } finally {
    if (old === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = old
  }
})

test('SQLite unchanged image rows with originals survive ordinary saves without content changes', (t) => {
  const registry = new ImageAssetRegistry()
  const row = registry.put('tenant-a', image, 9, original)
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-assets-trigger-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'store.db')
  const db = new SqliteBackend(file)
  let raw: { exec(sql: string): void; prepare(sql: string): { all(): unknown[] }; close(): void } | undefined
  try {
    db.save({ ...baseline(), imageAssets: [row] })
    const require = createRequire(import.meta.url)
    raw = new (require('node:sqlite').DatabaseSync)(file)
    raw.exec('CREATE TABLE image_asset_events (kind TEXT); CREATE TRIGGER image_asset_noop_update AFTER UPDATE ON image_assets BEGIN INSERT INTO image_asset_events VALUES (\'update\'); END; CREATE TRIGGER image_asset_noop_delete AFTER DELETE ON image_assets BEGIN INSERT INTO image_asset_events VALUES (\'delete\'); END; CREATE TRIGGER image_asset_noop_insert AFTER INSERT ON image_assets BEGIN INSERT INTO image_asset_events VALUES (\'insert\'); END;')
    const stringify = JSON.stringify
    JSON.stringify = function (value: unknown, replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null, space?: string | number): string {
      if (value && typeof value === 'object' && 'name' in value && value.name === original.name && 'data' in value && value.data === original.data) {
        throw new Error('unchanged original bytes were JSON-stringified during ordinary save')
      }
      return stringify.call(JSON, value, replacer as never, space)
    }
    try {
      db.save({ ...baseline(), imageAssets: [row] })
    } finally {
      JSON.stringify = stringify
    }
    assert.deepEqual(raw.prepare('SELECT kind FROM image_asset_events').all(), [], 'unchanged save does not rewrite image rows')
    assert.deepEqual(db.load()?.imageAssets, [row])
  } finally {
    raw?.close()
    db.close()
  }
})

test('SQLite migration 3 preserves legacy image rows from a real version 2 database', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-assets-v2-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'store-v2.db')
  const legacy = new ImageAssetRegistry().put('tenant-legacy-image', image, 77)
  const require = createRequire(import.meta.url)
  const raw = new (require('node:sqlite').DatabaseSync)(file)
  try {
    raw.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 'v1'), (2, 'v2');
      CREATE TABLE kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE entities (slice TEXT NOT NULL, idx INTEGER NOT NULL, entity_id TEXT, json TEXT NOT NULL, PRIMARY KEY (slice, idx));
      CREATE INDEX entities_by_id ON entities (slice, entity_id);
      CREATE TABLE map_entries (slice TEXT NOT NULL, key TEXT NOT NULL, ord INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (slice, key));
      CREATE TABLE image_assets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, image_json TEXT NOT NULL, created_at INTEGER NOT NULL, ord INTEGER NOT NULL);
      CREATE INDEX image_assets_by_tenant ON image_assets (tenant_id);
    `)
    const state = baseline()
    const manifest = ['version', 'sessions', 'bindings', 'workspaces', 'schedules', 'recents', 'graph', 'seq', 'imageAssets']
    const putKv = raw.prepare('INSERT INTO kv (key, json) VALUES (?, ?)')
    putKv.run('__slices__', JSON.stringify(manifest))
    for (const key of ['version', 'recents', 'graph', 'seq'] as const) putKv.run(key, JSON.stringify(state[key]))
    raw.prepare('INSERT INTO image_assets (id, tenant_id, image_json, created_at, ord) VALUES (?, ?, ?, ?, ?)')
      .run(legacy.id, legacy.tenantId, JSON.stringify(legacy.image), legacy.createdAt, 0)
  } finally {
    raw.close()
  }

  const migrated = new SqliteBackend(file)
  try {
    assert.deepEqual(migrated.load()?.imageAssets, [legacy], 'the migration keeps the exact legacy id, tenant, normalized bytes and timestamp')
  } finally {
    migrated.close()
  }
  const inspected = new (require('node:sqlite').DatabaseSync)(file)
  try {
    assert.deepEqual(inspected.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row: { version: unknown }) => Number(row.version)), [1, 2, 3])
    assert.equal(inspected.prepare('SELECT original_json FROM image_assets WHERE id = ?').get(legacy.id)?.original_json, null,
      'migration adds nullable original storage without fabricating originals for legacy rows')
  } finally {
    inspected.close()
  }
})

test('image ordering and portable JSON↔SQLite round-trip retain normalized and original bytes', (t) => {
  const registry = new ImageAssetRegistry()
  const otherBytes = imageFixture(2, 1)
  const second = registry.put('tenant-a', { mimeType: 'image/png', data: Buffer.from(otherBytes).toString('base64'), width: 2, height: 1, byteLength: otherBytes.byteLength }, 10, imageOriginal('second.png', Uint8Array.from(Buffer.from('second original'))))
  const first = registry.put('tenant-a', image, 9, original)
  const ordered = [second, first]
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-assets-portable-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const jsonFile = join(directory, 'source.json')
  const roundTripFile = join(directory, 'round-trip.json')
  const db = new SqliteBackend(':memory:')
  const old = process.env.DATA_FILE
  try {
    writePortableSnapshot(jsonFile, { ...baseline(), imageAssets: ordered })
    process.env.DATA_FILE = jsonFile
    const json = new JsonFileBackend()
    const fromJson = json.load()
    assert.deepEqual(fromJson?.imageAssets, ordered, 'JSON source retains image order and bytes')

    db.save({ ...baseline(), imageAssets: [first] })
    restoreBackendState(db, fromJson!)
    assert.deepEqual(db.load()?.imageAssets, ordered, 'JSON→SQLite restore retains image order and bytes')

    writePortableSnapshot(roundTripFile, db.load()!)
    process.env.DATA_FILE = roundTripFile
    assert.deepEqual(new JsonFileBackend().load()?.imageAssets, ordered, 'SQLite→JSON export retains image order and bytes')
  } finally {
    if (old === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = old
    db.close()
  }
})

test('portable backup and restore retain original-bearing rows and legacy rows', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-original-portable-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const backup = join(directory, 'images.json')
  const registry = new ImageAssetRegistry()
  const withOriginal = registry.put('tenant-a', image, 9, original)
  const legacy = registry.put('tenant-b', image, 10)
  const state = { ...baseline(), imageAssets: [withOriginal, legacy] }
  const source = new JsonFileBackend()
  const target = new SqliteBackend(':memory:')
  const old = process.env.DATA_FILE
  const sourceFile = join(directory, 'source.json')
  try {
    process.env.DATA_FILE = sourceFile
    source.save(state)
    writePortableSnapshot(backup, source.load()!)
    assert.deepEqual(restoreBackendSnapshot(target, backup).imageAssets, state.imageAssets,
      'portable restore carries original bytes while retaining legacy normalized-only rows')
    assert.deepEqual(target.load()?.imageAssets, state.imageAssets)
  } finally {
    target.close()
    if (old === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = old
  }
})

test('malformed or altered originals fail restore before replacing prior SQLite bytes', () => {
  const registry = new ImageAssetRegistry()
  const row = registry.put('tenant-a', image, 9, original)
  const db = new SqliteBackend(':memory:')
  try {
    const current = { ...baseline(), imageAssets: [row] }
    db.save(current)
    const altered = { ...row, original: { ...original, data: Buffer.from('altered source bytes').toString('base64') } }
    assert.throws(() => restoreBackendState(db, { ...baseline(), imageAssets: [altered] }), /unsupported or invalid/)
    assert.deepEqual(db.load()?.imageAssets, [row], 'failed admission leaves the prior original bytes intact')
    const malformed = { ...row, original: { ...original, byteLength: original.byteLength + 1 } }
    assert.throws(() => restoreBackendState(db, { ...baseline(), imageAssets: [malformed] }), /unsupported or invalid/)
    assert.deepEqual(db.load()?.imageAssets, [row])
  } finally {
    db.close()
  }
})

test('removing an original-bearing image row releases its original-byte capacity', () => {
  const originalByteLength = original.byteLength
  const registry = new ImageAssetRegistry([], {
    maxTenantBytes: image.byteLength + originalByteLength,
    maxTotalBytes: image.byteLength + originalByteLength,
    maxCount: 1,
  })
  const first = registry.put('tenant-a', image, 9, original)
  assert.equal(registry.remove([first.id]), 1)
  assert.deepEqual(registry.snapshot(), [])
  assert.ok(registry.put('tenant-a', image, 10, original), 'removed original payload no longer consumes registry capacity')
})

test('invalid image restore is rejected before replacing the current SQLite state', () => {
  const registry = new ImageAssetRegistry()
  const row = registry.put('tenant-a', image, 9)
  const db = new SqliteBackend(':memory:')
  try {
    const current = { ...baseline(), imageAssets: [row] }
    db.save(current)
    assert.throws(() => restoreBackendState(db, { ...baseline(), imageAssets: [{ ...row, id: 'img-invalid' }] }), /unsupported or invalid/)
    assert.deepEqual(db.load()?.imageAssets, [row])
  } finally {
    db.close()
  }
})
