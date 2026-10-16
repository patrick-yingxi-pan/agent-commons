/** Tests for the persistence port (server/persistence/) — the JSON and embedded
 *  SQLite backends behind server/persistence/persist.ts. The headline invariant: **both
 *  backends preserve the exact JSON-canonical snapshot**, so swapping
 *  `PERSIST_BACKEND` can never change what the store rehydrates. Plus the SQLite
 *  specifics: fresh-db → null while existing invalid state throws, forward-only
 *  migrations are idempotent, and an uncategorized slice fails loudly.
 *  Everything runs against `:memory:` or a throwaway temp file — never the real store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonFileBackend, SqliteBackend } from './index.ts'
import { STORE_VERSION, type PersistedState } from './persist.ts'
import { hasCorePersistedShape } from './format.ts'
import { readPortableSnapshot, restoreBackendSnapshot, writePortableSnapshot } from './portable.ts'
import { workspaceInputAttachments } from '../../contract/attachmentInput.ts'

// A fully-populated snapshot that exercises every slice kind: singletons (version,
// recents, graph, seq), ordered arrays (sessions, schedules-empty, savedContexts,
// auditLog) and Map-entry slices (bindings, workspaces, nested session preferences,
// tenant recents, the Agent Commons registries, commissionCaps).
const sample: PersistedState = {
  version: STORE_VERSION,
  initialWorld: 'demo',
  sessions: [
    // s1 carries a tenantId — the F2/PD9 isolation key. The byte-for-byte round-trip
    // assertions below therefore also prove tenantId survives persistence on BOTH
    // backends; dropping it on save/load would silently make a created session default-
    // tenant (cross-tenant visible) after a restart.
    { id: 's1', title: 'Hi', caps: ['chat'], preview: 'p', tenantId: 'tenant-a', messages: [{ id: 'm', role: 'user', content: 'x' }] },
    { id: 's2', title: 'Bye', caps: ['chat'], preview: 'q', messages: [] },
  ] as unknown as PersistedState['sessions'],
  bindings: [['s1', [{ id: 'c1', type: 'repo', label: 'r', scope: '*' }]]] as unknown as PersistedState['bindings'],
  workspaces: [['s1', { workspaces: [{
    id: 'Workspace', label: 'Workspace', artifacts: [], folders: [{
      id: 'ui-host::LOCAL_0123456789ABCDEF0123456789ABCDEF', label: 'Local notes', localSnapshot: {
        version: 1, snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        capturedAt: '2026-10-04T12:00:00.000Z', connectionId: 'LOCAL_0123456789ABCDEF0123456789ABCDEF',
        files: [{ name: 'notes.md', sizeBytes: 13, snapshot: { text: 'local durable' } }],
      },
    }],
  }], repos: [], connectors: [], attachments: [{
    id: 'cloud::notes.md', label: 'notes.md', kind: 'file',
    source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
    textSnapshot: {
      version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'notes.md', text: 'durable text',
    },
  }] }]] as unknown as PersistedState['workspaces'],
  sessionPreferences: [['user-a', [['s1', { panelFocus: null }]]]],
  modelPreferences: [['tenant-a', [['user-a', { revision: 1, preferences: { effort: 'High', ultracode: false, fast: true } }]]]],
  schedules: [], // present-but-empty array must round-trip as [], not vanish
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] } as unknown as PersistedState['recents'],
  recentsByTenant: [['tenant-b', { files: [], photos: [], folder: [], repo: ['repo-b'], connector: [], mcp: [] }]],
  graph: {
    sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
    artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
    extraArtifacts: [], extraProjects: [], standingApprovals: {},
  } as unknown as PersistedState['graph'],
  savedContexts: [{ id: 'sc1', type: 'connector', label: 'GitHub', status: 'connected', tenantId: 'tenant-b' }] as unknown as PersistedState['savedContexts'],
  providers: [['provider-x', { id: 'provider-x', label: 'P', modelFamily: 'claude', effortLevels: ['Low'], models: [
    { id: 'adaptive', label: 'Adaptive', capabilities: { thinking: true, adaptiveThinking: true } },
    { id: 'legacy', label: 'Legacy', capabilities: { thinking: true } },
    { id: 'not-adaptive', label: 'Not adaptive', capabilities: { adaptiveThinking: false } },
  ] }]] as unknown as PersistedState['providers'],
  providerConfigs: [['provider-x', { model: 'claude-opus-4-8', replyOutputTokens: 4096 }]] as unknown as PersistedState['providerConfigs'],
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
  assert.equal(hasCorePersistedShape(loaded), true, 'a well-formed served text snapshot remains core-valid')
  assert.deepEqual(loaded?.workspaces?.[0]?.[1].workspaces[0]?.folders?.[0]?.localSnapshot,
    sample.workspaces?.[0]?.[1].workspaces[0]?.folders?.[0]?.localSnapshot,
    'a local folder capture survives the portable store round trip without paths')
  assert.deepEqual(loaded?.workspaces?.[0]?.[1].attachments[0]?.textSnapshot, sample.workspaces?.[0]?.[1].attachments[0]?.textSnapshot)
  // Spell out the isolation-critical bit: a session's tenantId must survive the round-trip.
  assert.equal(loaded?.sessions?.[0]?.tenantId, 'tenant-a', 'a session keeps its tenantId across persistence')
  assert.equal(loaded?.providerConfigs?.[0]?.[1].replyOutputTokens, 4096,
    'the server-only provider output limit survives SQLite storage')
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
  assert.equal(hasCorePersistedShape(fromSqlite), true, 'both backends preserve a valid served snapshot')
  cleanup(file)
  try {
    rmSync(jsonFile)
  } catch {
    /* already gone */
  }
})

test('persisted served snapshots fail admission when malformed or detached from their exact source path', () => {
  const valid = JSON.parse(JSON.stringify(sample)) as PersistedState
  const attachment = valid.workspaces[0]![1].attachments[0]!
  assert.equal(hasCorePersistedShape(valid), true)

  const malformed = JSON.parse(JSON.stringify(valid)) as PersistedState
  ;(malformed.workspaces[0]![1].attachments[0]!.textSnapshot as any).snapshotId = 'not-a-uuid'
  assert.equal(hasCorePersistedShape(malformed), false)

  const mismatchedPath = JSON.parse(JSON.stringify(valid)) as PersistedState
  mismatchedPath.workspaces[0]![1].attachments[0]!.id = 'cloud::other.md'
  assert.equal(hasCorePersistedShape(mismatchedPath), false)
  assert.equal(attachment.textSnapshot?.text, 'durable text', 'validation leaves the canonical fixture unchanged')
})

test('provider reply output limits are optional for legacy configs but strict when present', () => {
  const valid = JSON.parse(JSON.stringify(sample)) as PersistedState
  assert.equal(hasCorePersistedShape(valid), true)

  const legacy = JSON.parse(JSON.stringify(valid)) as PersistedState
  delete (legacy.providerConfigs![0]![1] as { replyOutputTokens?: number }).replyOutputTokens
  assert.equal(hasCorePersistedShape(legacy), true, 'legacy provider configs may omit the new limit')

  for (const invalidLimit of [null, 127, 128.5, 65_537, '4096']) {
    const malformed = JSON.parse(JSON.stringify(valid)) as PersistedState
    ;(malformed.providerConfigs![0]![1] as { replyOutputTokens?: unknown }).replyOutputTokens = invalidLimit
    assert.equal(hasCorePersistedShape(malformed), false, `invalid persisted limit ${String(invalidLimit)} refuses admission`)
  }

  for (const malformedRows of [
    [['provider-x', { replyOutputTokens: null }, 'extra']],
    [['provider-x', null]],
    [['provider-x', 17]],
    [['provider-x']],
    [[17, {}]],
  ]) {
    const malformed = JSON.parse(JSON.stringify(valid)) as PersistedState
    malformed.providerConfigs = malformedRows as unknown as PersistedState['providerConfigs']
    assert.equal(hasCorePersistedShape(malformed), false, 'malformed provider config map rows refuse admission')
  }
})

test('persisted local folder captures fail admission when their connection binding or file bytes are malformed', () => {
  const valid = JSON.parse(JSON.stringify(sample)) as PersistedState
  assert.equal(hasCorePersistedShape(valid), true)

  const mismatchedConnection = JSON.parse(JSON.stringify(valid)) as PersistedState
  const folder = mismatchedConnection.workspaces[0]![1].workspaces[0]!.folders![0]!
  folder.localSnapshot!.connectionId = 'LOCAL_FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
  assert.equal(hasCorePersistedShape(mismatchedConnection), false)

  const malformedFile = JSON.parse(JSON.stringify(valid)) as PersistedState
  malformedFile.workspaces[0]![1].workspaces[0]!.folders![0]!.localSnapshot!.files[0]!.snapshot = { text: 'unmatched' }
  assert.equal(hasCorePersistedShape(malformedFile), false)
})

test('recursive local folder captures round-trip through JSON, SQLite, and portable snapshots with exact model paths', () => {
  const state = JSON.parse(JSON.stringify(sample)) as PersistedState
  const workspace = state.workspaces[0]![1].workspaces[0]!
  const folder = workspace.folders![0]!
  state.bindings[0]![1].push({
    id: 'ui-host::LOCAL_0123456789ABCDEF0123456789ABCDEF',
    type: 'folder', label: 'Project/', scope: 'LOCAL_0123456789ABCDEF0123456789ABCDEF',
    source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
  })
  folder.label = 'Project/'
  folder.localSnapshot = {
    version: 2,
    scope: 'recursive',
    snapshotId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    capturedAt: '2026-10-04T12:00:00.000Z',
    connectionId: 'LOCAL_0123456789ABCDEF0123456789ABCDEF',
    files: [
      { name: 'src/notes.md', sizeBytes: 5, snapshot: { text: 'first' } },
      { name: 'tests/notes.md', sizeBytes: 6, snapshot: { text: 'second' } },
    ],
  }
  assert.equal(hasCorePersistedShape(state), true)
  const exactCapture = folder.localSnapshot
  const assertModelProjection = (value: PersistedState | null) => {
    const savedWorkspace = value?.workspaces[0]?.[1].workspaces[0]
    assert.deepEqual(savedWorkspace?.folders?.[0]?.localSnapshot, exactCapture)
    const input = workspaceInputAttachments({ attachments: [], workspaces: savedWorkspace ? [savedWorkspace] : [] })
    assert.deepEqual(input.map((item) => [item.id, item.label, item.previewText]), [
      ['ui-host::LOCAL_0123456789ABCDEF0123456789ABCDEF/src/notes.md', 'Project/src/notes.md', 'first'],
      ['ui-host::LOCAL_0123456789ABCDEF0123456789ABCDEF/tests/notes.md', 'Project/tests/notes.md', 'second'],
    ])
  }

  const file = tempDbFile()
  const portableFile = `${file}.portable.json`
  const jsonFile = `${file}.json`
  const priorDataFile = process.env.DATA_FILE
  const sqlite = new SqliteBackend(':memory:')
  try {
    sqlite.save(state)
    assertModelProjection(sqlite.load())
    writePortableSnapshot(portableFile, sqlite.load()!)
    assert.deepEqual(readPortableSnapshot(portableFile).workspaces[0]?.[1].workspaces[0]?.folders?.[0]?.localSnapshot, exactCapture)
    restoreBackendSnapshot(sqlite, portableFile)
    assertModelProjection(sqlite.load())

    process.env.DATA_FILE = jsonFile
    const json = new JsonFileBackend()
    restoreBackendSnapshot(json, portableFile)
    assertModelProjection(json.load())
  } finally {
    sqlite.close()
    if (priorDataFile === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = priorDataFile
    cleanup(file)
    for (const path of [portableFile, jsonFile]) {
      try { rmSync(path) } catch { /* already gone */ }
    }
  }
})

test('SQLite load returns null for a fresh database (caller seeds fresh)', () => {
  const db = new SqliteBackend(':memory:')
  assert.equal(db.load(), null)
  db.close()
})

test('SQLite load refuses an existing version mismatch', () => {
  const db = new SqliteBackend(':memory:')
  db.save({ ...sample, version: STORE_VERSION + 999 })
  assert.throws(() => db.load(), /unsupported|migration path/)
  db.close()
})

test('SQLite load refuses a current-version state missing required core slices', () => {
  const db = new SqliteBackend(':memory:')
  db.save({ version: STORE_VERSION } as PersistedState)
  assert.throws(() => db.load(), /missing required core slices/)
  db.close()
})

test('SQLite distinguishes a newly-created database from an existing manifest-less file', () => {
  const file = tempDbFile()
  const first = new SqliteBackend(file)
  assert.equal(first.load(), null, 'the backend that created the database sees genuine first boot')
  first.close()

  const reopened = new SqliteBackend(file)
  assert.throws(() => reopened.load(), /manifest is missing/, 'an existing unexplained database never reseeds')
  reopened.close()
  cleanup(file)
})

test('SQLite refuses an existing non-application database before adding its schema', () => {
  const file = tempDbFile()
  const bytes = 'not-an-agent-commons-database'
  writeFileSync(file, bytes)
  assert.throws(() => new SqliteBackend(file), /file is not a database|schema marker/)
  assert.equal(readFileSync(file, 'utf8'), bytes, 'startup leaves an unrecognized recovery source intact')
  cleanup(file)
})

test('SQLite refuses first-boot initialization while an orphan recovery companion remains', () => {
  const file = tempDbFile()
  const wal = `${file}-wal`
  const bytes = 'orphaned-recovery-data'
  writeFileSync(wal, bytes)
  assert.throws(() => new SqliteBackend(file), /recovery data remains/)
  assert.equal(existsSync(file), false, 'the missing main database is not recreated')
  assert.equal(readFileSync(wal, 'utf8'), bytes, 'the recovery companion remains intact')
  cleanup(file)
})

test('SQLite save throws on an uncategorized slice (silent data-loss guard)', () => {
  const db = new SqliteBackend(':memory:')
  const rogue = { ...sample, somethingNew: [1, 2, 3] } as unknown as PersistedState
  assert.throws(() => db.save(rogue), /uncategorized slice/)
  db.close()
})

test('both backends throw when a durable write cannot commit', () => {
  const blockedJsonPath = join(tmpdir(), `claude-ui-json-write-blocked-${process.pid}`)
  const previous = process.env.DATA_FILE
  mkdirSync(blockedJsonPath, { recursive: true })
  process.env.DATA_FILE = blockedJsonPath // a directory cannot be replaced by the snapshot file
  try {
    assert.throws(() => new JsonFileBackend().save(sample), 'JSON propagates its atomic replace failure')
  } finally {
    if (previous === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = previous
    rmSync(blockedJsonPath, { recursive: true, force: true })
    rmSync(`${blockedJsonPath}.tmp`, { force: true })
  }

  const closed = new SqliteBackend(':memory:')
  closed.close()
  assert.throws(() => closed.save(sample), 'SQLite propagates a failed transaction after rollback')
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
  assert.ok(!('sessionPreferences' in loaded), 'an absent additive preference slice keeps the legacy default')
  assert.ok(!('modelPreferences' in loaded), 'absent personal model preferences keep their legacy default')
  assert.deepStrictEqual(loaded, JSON.parse(JSON.stringify(minimal)))
  db.close()
})
