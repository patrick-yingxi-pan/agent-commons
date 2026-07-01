/** Tests for the persistence port (server/persistence/) — the JSON and embedded
 *  SQLite backends behind server/persist.ts. The headline invariant: **both
 *  backends preserve the exact JSON-canonical snapshot**, so swapping
 *  `PERSIST_BACKEND` can never change what the store rehydrates. Plus the SQLite
 *  specifics: version-mismatch / fresh-db → null, forward-only migrations are
 *  idempotent, and an uncategorized slice fails loudly (it would silently lose data).
 *  Everything runs against `:memory:` or a throwaway temp file — never the real store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonFileBackend, SqliteBackend } from '../server/persistence/index.ts'
import { STORE_VERSION, type PersistedState } from '../server/persist.ts'

// A fully-populated snapshot that exercises every slice kind: singletons (version,
// recents, graph, seq), ordered arrays (sessions, schedules-empty, savedContexts,
// auditLog) and Map-entry slices (bindings, workspaces, the Agent Commons registries,
// commissionCaps).
const sample: PersistedState = {
  version: STORE_VERSION,
  sessions: [
    // s1 carries a tenantId — the F2/PD9 isolation key. The byte-for-byte round-trip
    // assertions below therefore also prove tenantId survives persistence on BOTH
    // backends; dropping it on save/load would silently make a created session default-
    // tenant (cross-tenant visible) after a restart.
    { id: 's1', title: 'Hi', caps: ['chat'], preview: 'p', tenantId: 'tenant-a', messages: [{ id: 'm', role: 'user', content: 'x' }] },
    { id: 's2', title: 'Bye', caps: ['chat'], preview: 'q', messages: [] },
  ] as unknown as PersistedState['sessions'],
  bindings: [['s1', [{ id: 'c1', type: 'repo', label: 'r', scope: '*' }]]] as unknown as PersistedState['bindings'],
  workspaces: [['s1', { workspaces: [], repos: [], connectors: [], attachments: [] }]] as unknown as PersistedState['workspaces'],
  schedules: [], // present-but-empty array must round-trip as [], not vanish
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] } as unknown as PersistedState['recents'],
  graph: {
    sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
    artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
    extraArtifacts: [], extraProjects: [], standingApprovals: {},
  } as unknown as PersistedState['graph'],
  savedContexts: [{ id: 'sc1', type: 'connector', label: 'GitHub', status: 'connected' }] as unknown as PersistedState['savedContexts'],
  providers: [['provider-x', { id: 'provider-x', label: 'P', modelFamily: 'claude', effortLevels: ['Low'] }]] as unknown as PersistedState['providers'],
  providerConfigs: [['provider-x', { model: 'claude-opus-4-8' }]] as unknown as PersistedState['providerConfigs'],
  systemPrompts: [['sp-x', { id: 'sp-x', label: 'S', body: 'b', targetFamily: 'claude' }]] as unknown as PersistedState['systemPrompts'],
  agents: [['agent-x', { id: 'agent-x', label: 'A', systemPrompt: 'b', tools: [], instructions: '' }]] as unknown as PersistedState['agents'],
  commissions: [['commission-x', { id: 'commission-x', agentId: 'agent-x', projectId: 'p1' }]] as unknown as PersistedState['commissions'],
  commissionCaps: [['p1', 5]],
  auditLog: [{ id: 'a1', kind: 'project-effect', at: 1700000000000 }] as unknown as PersistedState['auditLog'],
  seq: { session: 3, message: 7, schedule: 1, run: 2, artifact: 0, provider: 1, systemPrompt: 1, agent: 1, commission: 1, audit: 1 },
}

/** What persistence must preserve byte-for-byte: the JSON-canonical form (drops
 *  `undefined`, normalizes nothing else). */
const canonical = JSON.parse(JSON.stringify(sample))

let counter = 0
function tempDbFile(): string {
  return join(tmpdir(), `claude-ui-sqlite-test-${process.pid}-${counter++}.db`)
}
function cleanup(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    try {
      rmSync(f)
    } catch {
      /* already gone */
    }
  }
}

test('SQLite backend round-trips the JSON-canonical snapshot exactly', () => {
  const db = new SqliteBackend(':memory:')
  db.save(sample)
  const loaded = db.load()
  assert.deepStrictEqual(loaded, canonical, 'every slice kind survives save → load')
  // Spell out the isolation-critical bit: a session's tenantId must survive the round-trip.
  assert.equal(loaded?.sessions?.[0]?.tenantId, 'tenant-a', 'a session keeps its tenantId across persistence')
  db.close()
})

test('JSON and SQLite backends produce identical loaded state (backend-swap is invisible)', () => {
  const file = tempDbFile()
  const sqlite = new SqliteBackend(file)
  sqlite.save(sample)
  const fromSqlite = sqlite.load()
  sqlite.close()

  // Drive the JSON backend at a throwaway path via DATA_FILE.
  const jsonFile = `${file}.json`
  const prev = process.env.DATA_FILE
  process.env.DATA_FILE = jsonFile
  const json = new JsonFileBackend()
  json.save(sample)
  const fromJson = json.load()
  if (prev === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = prev

  assert.deepStrictEqual(fromSqlite, fromJson, 'the two backends rehydrate the same state')
  assert.deepStrictEqual(fromSqlite, canonical)
  cleanup(file)
  try {
    rmSync(jsonFile)
  } catch {
    /* already gone */
  }
})

test('SQLite load returns null for a fresh database (caller seeds fresh)', () => {
  const db = new SqliteBackend(':memory:')
  assert.equal(db.load(), null)
  db.close()
})

test('SQLite load returns null on a version mismatch so an old db cannot crash a new build', () => {
  const db = new SqliteBackend(':memory:')
  db.save({ ...sample, version: STORE_VERSION + 999 })
  assert.equal(db.load(), null)
  db.close()
})

test('SQLite save throws on an uncategorized slice (silent data-loss guard)', () => {
  const db = new SqliteBackend(':memory:')
  const rogue = { ...sample, somethingNew: [1, 2, 3] } as unknown as PersistedState
  assert.throws(() => db.save(rogue), /uncategorized slice/)
  db.close()
})

test('SQLite migrations are idempotent — reopening the same file re-applies cleanly', () => {
  const file = tempDbFile()
  const first = new SqliteBackend(file)
  first.save(sample)
  first.close()

  // Reopening runs the migration runner again; it must skip applied migrations and
  // still load the persisted state.
  const second = new SqliteBackend(file)
  assert.deepStrictEqual(second.load(), canonical, 'state survives a reopen')
  second.close()
  cleanup(file)
})

test('SQLite omits absent optional slices (no phantom keys)', () => {
  const minimal: PersistedState = {
    version: STORE_VERSION,
    sessions: [],
    bindings: [],
    workspaces: [],
    schedules: [],
    recents: sample.recents,
    graph: sample.graph,
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  }
  const db = new SqliteBackend(':memory:')
  db.save(minimal)
  const loaded = db.load()
  assert.ok(loaded)
  assert.ok(!('auditLog' in loaded), 'an absent optional slice is not resurrected')
  assert.ok(!('providers' in loaded), 'an absent optional slice is not resurrected')
  assert.deepStrictEqual(loaded, JSON.parse(JSON.stringify(minimal)))
  db.close()
})
