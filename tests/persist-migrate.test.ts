/** Forward-only data migrations (design F1 PD6). Unit-tests the migration engine
 *  with injected migrations, then proves the SQLite backend routes load() through it
 *  (an older-version store upgrades in place instead of being discarded). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateState, DATA_MIGRATIONS, type DataMigration } from '../server/persistence/migrate.ts'
import { SqliteBackend, JsonFileBackend } from '../server/persistence/index.ts'
import { STORE_VERSION, type PersistedState } from '../server/persist.ts'

// A minimal valid snapshot at an arbitrary version (only the required slices).
const at = (version: number): PersistedState => ({
  version,
  sessions: [],
  bindings: [],
  workspaces: [],
  schedules: [],
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] } as unknown as PersistedState['recents'],
  graph: {
    sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
    artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
    extraArtifacts: [], extraProjects: [], standingApprovals: {},
  } as unknown as PersistedState['graph'],
  seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
})

test('migrateState passes a current-version snapshot straight through', () => {
  const s = at(STORE_VERSION)
  assert.equal(migrateState(s), s)
})

test('migrateState discards garbage / versionless input', () => {
  assert.equal(migrateState(null), null)
  assert.equal(migrateState({} as PersistedState), null)
})

test('migrateState refuses a snapshot newer than this build (no downgrade)', () => {
  assert.equal(migrateState(at(STORE_VERSION + 1)), null)
})

test('migrateState applies a chain, stamping the version and preserving/transforming data', () => {
  const migrations: DataMigration[] = [
    { to: 2, migrate: (s) => ({ ...s, seq: { ...s.seq, session: 1 } }) },
    { to: 3, migrate: (s) => ({ ...s, seq: { ...s.seq, message: 2 } }) },
  ]
  const out = migrateState(at(1), migrations, 3)
  assert.ok(out)
  assert.equal(out.version, 3, 'walked v1 → v3')
  assert.equal(out.seq.session, 1, 'first migration applied')
  assert.equal(out.seq.message, 2, 'second migration applied')
})

test('migrateState discards when a step in the chain is missing (gap ⇒ reseed)', () => {
  const migrations: DataMigration[] = [{ to: 3, migrate: (s) => s }] // no to:2
  assert.equal(migrateState(at(1), migrations, 3), null)
})

test('migrateState with the empty default registry behaves like discard-on-mismatch', () => {
  const current = at(STORE_VERSION)
  assert.equal(migrateState(current), current, 'current version passes straight through')
  assert.equal(migrateState(at(STORE_VERSION - 1)), null, 'an old version with no registered migration is discarded')
})

// Both backends route load() through migrateState (migrate.ts asserts this in prose),
// so prove the upgrade-in-place path on BOTH — JSON is the default backend.
test('the SQLite backend upgrades an older-version store via a registered migration', () => {
  // Register a temporary migration into the *real* registry the backend uses, proving
  // load() routes through migrateState. Restored in finally so the file stays clean.
  const marker = (s: PersistedState): PersistedState => ({ ...s, seq: { ...s.seq, run: 99 } })
  DATA_MIGRATIONS.push({ to: STORE_VERSION, migrate: marker })
  try {
    const db = new SqliteBackend(':memory:')
    db.save(at(STORE_VERSION - 1)) // an older-version store on disk
    const loaded = db.load()
    assert.ok(loaded, 'the old store was upgraded, not discarded')
    assert.equal(loaded.version, STORE_VERSION, 'upgraded to the current version')
    assert.equal(loaded.seq.run, 99, 'the registered migration ran during load()')
    db.close()
  } finally {
    DATA_MIGRATIONS.length = 0
  }
})

test('the JSON backend (default) upgrades an older-version store via a registered migration', () => {
  const file = join(tmpdir(), `claude-ui-migrate-json-${process.pid}.json`)
  const prevDataFile = process.env.DATA_FILE
  process.env.DATA_FILE = file
  DATA_MIGRATIONS.push({ to: STORE_VERSION, migrate: (s) => ({ ...s, seq: { ...s.seq, run: 77 } }) })
  try {
    const db = new JsonFileBackend()
    db.save(at(STORE_VERSION - 1))
    const loaded = db.load()
    assert.ok(loaded, 'the old store was upgraded, not discarded')
    assert.equal(loaded.version, STORE_VERSION, 'upgraded to the current version')
    assert.equal(loaded.seq.run, 77, 'the registered migration ran during load()')
  } finally {
    DATA_MIGRATIONS.length = 0
    if (prevDataFile === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = prevDataFile
    try {
      rmSync(file)
    } catch {
      /* already gone */
    }
  }
})
