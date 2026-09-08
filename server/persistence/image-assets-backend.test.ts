import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteBackend } from './sqlite.ts'
import { STORE_VERSION, type PersistedState } from './format.ts'
import { ImageAssetRegistry } from '../imageAssets.ts'
import type { ImageSnapshot } from '../../contract/imageInput.ts'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { JsonFileBackend } from './json.ts'
import { restoreBackendState, writePortableSnapshot } from './portable.ts'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'

const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
const image: ImageSnapshot = { mimeType: 'image/png', data: Buffer.from(bytes).toString('base64'), width: 1, height: 1, byteLength: bytes.length }
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

test('SQLite unchanged image rows survive ordinary saves without content changes', (t) => {
  const registry = new ImageAssetRegistry()
  const row = registry.put('tenant-a', image, 9)
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
    db.save({ ...baseline(), imageAssets: [row] })
    assert.deepEqual(raw.prepare('SELECT kind FROM image_asset_events').all(), [], 'unchanged save does not rewrite image rows')
    assert.deepEqual(db.load()?.imageAssets, [row])
  } finally {
    raw?.close()
    db.close()
  }
})

test('image ordering and portable JSON↔SQLite round-trip retain bytes', (t) => {
  const registry = new ImageAssetRegistry()
  const otherBytes = imageFixture(2, 1)
  const second = registry.put('tenant-a', { mimeType: 'image/png', data: Buffer.from(otherBytes).toString('base64'), width: 2, height: 1, byteLength: otherBytes.byteLength }, 10)
  const first = registry.put('tenant-a', image, 9)
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
