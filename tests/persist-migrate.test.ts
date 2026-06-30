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

test('migrateState: current version passes through; a version with no migration path is discarded', () => {
  const current = at(STORE_VERSION)
  assert.equal(migrateState(current), current, 'current version passes straight through')
  // v3 would need a to:4 step, which doesn't exist (only v4→v5 is registered), so it's discarded.
  assert.equal(migrateState(at(STORE_VERSION - 2)), null, 'a version with no registered path is discarded')
})

// ── The real registered migration (v4 → v5: backfill AuditEntry.tenantId) ─────
/** A legacy v4 snapshot whose audit entry predates `tenantId` — what a store persisted
 *  before the tenant-scoped-audit bump looks like on disk. */
const legacyV4 = (): PersistedState =>
  ({
    ...at(STORE_VERSION - 1),
    auditLog: [
      { id: 'audit-legacy', channel: 'proxy', capability: 'connector.read', target: 'legacy', outcome: 'fulfilled', at: 1 },
    ],
  }) as unknown as PersistedState

test('the v4→v5 migration backfills a tenant-less audit entry, preserving stamped ones', () => {
  const v4 = {
    ...at(STORE_VERSION - 1),
    auditLog: [
      { id: 'a-old', channel: 'proxy', capability: 'c', target: 't', outcome: 'fulfilled', at: 1 },
      { id: 'a-new', tenantId: 'tenant-acme', channel: 'proxy', capability: 'c', target: 't', outcome: 'fulfilled', at: 2 },
    ],
  } as unknown as PersistedState
  const out = migrateState(v4)
  assert.ok(out)
  assert.equal(out.version, STORE_VERSION)
  assert.equal(out.auditLog?.[0]?.tenantId, 'tenant-personal', 'an unstamped entry is backfilled to the personal tenant')
  assert.equal(out.auditLog?.[1]?.tenantId, 'tenant-acme', 'an already-stamped entry is left untouched')
})

test('the real registry includes the v4→v5 audit-tenant migration', () => {
  assert.ok(DATA_MIGRATIONS.some((m) => m.to === STORE_VERSION), `a migration to v${STORE_VERSION} is registered`)
})

// Both backends route load() through migrateState (migrate.ts asserts this in prose),
// so prove the real upgrade-in-place path on BOTH — JSON is the default backend.
test('the SQLite backend upgrades a legacy (v4) store in place via the real migration', () => {
  const db = new SqliteBackend(':memory:')
  db.save(legacyV4())
  const loaded = db.load()
  assert.ok(loaded, 'the old store was upgraded, not discarded')
  assert.equal(loaded.version, STORE_VERSION, 'upgraded to the current version')
  assert.equal(loaded.auditLog?.[0]?.tenantId, 'tenant-personal', 'the v4→v5 migration backfilled the audit tenant')
  db.close()
})

test('the JSON backend (default) upgrades a legacy (v4) store in place via the real migration', () => {
  const file = join(tmpdir(), `claude-ui-migrate-json-${process.pid}.json`)
  const prevDataFile = process.env.DATA_FILE
  process.env.DATA_FILE = file
  try {
    const db = new JsonFileBackend()
    db.save(legacyV4())
    const loaded = db.load()
    assert.ok(loaded, 'the old store was upgraded, not discarded')
    assert.equal(loaded.version, STORE_VERSION, 'upgraded to the current version')
    assert.equal(loaded.auditLog?.[0]?.tenantId, 'tenant-personal', 'audit tenant backfilled on the default backend')
  } finally {
    if (prevDataFile === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = prevDataFile
    try {
      rmSync(file)
    } catch {
      /* already gone */
    }
  }
})
