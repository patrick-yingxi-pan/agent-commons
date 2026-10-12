import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docBlockId } from '../server/documentIdentity.ts'
import { STORE_VERSION } from '../server/persistence/format.ts'
import {
  expectedMigratedDocumentRows,
  readDocumentSmokeRows,
  stageLegacyDocumentMigration,
} from './artifactDocumentMigrationFixture.mjs'

const artifactId = 'artifact-doc-smoke'
const discussionId = 'discussion-doc-smoke'
const profilePrefix = 'agent-commons-artifact-history-smoke-'

function body(revision, text, ids = true) {
  return {
    type: 'doc', revision, title: 'Migration smoke',
    blocks: [{ ...(ids ? { id: docBlockId(artifactId, revision, 0) } : {}), p: text }],
  }
}

function initialRows() {
  const original = body(0, 'Original text')
  const edited = body(1, 'Edited text')
  const restored = { ...body(2, 'Original text'), blocks: structuredClone(original.blocks) }
  return {
    body: restored,
    history: [
      { revision: 0, reason: 'edit', body: { type: 'doc', title: original.title, blocks: structuredClone(original.blocks) } },
      { revision: 1, reason: 'edit', body: { type: 'doc', title: edited.title, blocks: structuredClone(edited.blocks) } },
      { revision: 2, reason: 'restore', restoredFromRevision: 0, body: { type: 'doc', title: restored.title, blocks: structuredClone(restored.blocks) } },
    ],
    discussion: {
      id: discussionId,
      anchor: { ref: { kind: 'artifact', id: artifactId }, locus: { kind: 'artifact-block', blockId: original.blocks[0].id } },
      state: 'open', stateRevision: 0, openedBy: 'Owner', openedAt: 123,
      posts: [{ id: 'post-one', body: 'Keep this discussion untouched.' }],
    },
  }
}

async function withProfile(run) {
  const profile = await mkdtemp(join(tmpdir(), `${profilePrefix}test-`))
  const database = new DatabaseSync(join(profile, 'store.db'))
  try {
    database.exec(`
      CREATE TABLE kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE entities (slice TEXT NOT NULL, idx INTEGER NOT NULL, entity_id TEXT, json TEXT NOT NULL, PRIMARY KEY (slice, idx));
      CREATE INDEX entities_by_id ON entities (slice, entity_id);
      CREATE TABLE map_entries (slice TEXT NOT NULL, key TEXT NOT NULL, ord INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (slice, key));
    `)
    const rows = initialRows()
    database.prepare('INSERT INTO kv (key, json) VALUES (?, ?)').run('version', String(STORE_VERSION))
    database.prepare('INSERT INTO kv (key, json) VALUES (?, ?)').run('graph', JSON.stringify({ keep: 'graph' }))
    // Deliberately opaque, fixture-only sentinels: staging must preserve these
    // v7-owned slices byte-for-byte without claiming to construct a valid ledger.
    database.prepare('INSERT INTO kv (key, json) VALUES (?, ?)')
      .run('commissionMcp', JSON.stringify({ sentinel: 'v7-commissionMcp-preserve' }))
    const insertMap = database.prepare('INSERT INTO map_entries (slice, key, ord, json) VALUES (?, ?, ?, ?)')
    insertMap.run('artifactBodies', artifactId, 0, JSON.stringify(rows.body))
    insertMap.run('artifactBodies', 'unrelated-artifact', 1, JSON.stringify({ type: 'doc', blocks: [{ id: 'leave-me', p: 'unrelated' }] }))
    insertMap.run('artifactHistory', artifactId, 0, JSON.stringify(rows.history))
    insertMap.run('artifactHistory', 'unrelated-artifact', 1, JSON.stringify([{ revision: 0, body: { type: 'doc', blocks: [{ id: 'history-id', p: 'unrelated' }] } }]))
    insertMap.run('artifactHistoryRestoreReceipts', 'receipt-key', 0, JSON.stringify({ artifactId, receipt: 'preserve' }))
    const insertEntity = database.prepare('INSERT INTO entities (slice, idx, entity_id, json) VALUES (?, ?, ?, ?)')
    insertEntity.run('discussions', 0, discussionId, JSON.stringify(rows.discussion))
    insertEntity.run('discussions', 1, 'unrelated-discussion', JSON.stringify({ id: 'unrelated-discussion', anchor: { ref: { kind: 'project', id: 'p' } } }))
    insertEntity.run('usageReservations', 0, 'v7-usage-preserve', JSON.stringify({ sentinel: 'v7-usageReservations-preserve' }))
    database.close()
    await run(profile, rows)
  } finally {
    try { database.close() } catch { /* already closed */ }
    await rm(profile, { recursive: true, force: true })
  }
}

function readAll(profile) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    return {
      kv: database.prepare('SELECT key, json FROM kv ORDER BY key').all(),
      entities: database.prepare('SELECT slice, idx, entity_id, json FROM entities ORDER BY slice, idx').all(),
      mapEntries: database.prepare('SELECT slice, key, ord, json FROM map_entries ORDER BY slice, key').all(),
    }
  } finally { database.close() }
}

test('stages only the captured Document and Discussion rows at the current version and preserves restore lineage', async () => {
  await withProfile(async (profile, rows) => {
    const captured = readDocumentSmokeRows(profile, { artifactId, discussionId })
    assert.deepEqual(captured, rows)
    const before = readAll(profile)
    const legacy = stageLegacyDocumentMigration(profile, { artifactId, discussionId, ...captured })
    const after = readAll(profile)

    assert.equal(JSON.parse(after.kv.find(row => row.key === 'version').json), 5)
    assert.deepEqual(legacy.body.blocks, [{ p: 'Original text' }])
    assert.deepEqual(legacy.history.map(version => version.body.blocks), [
      [{ p: 'Original text' }], [{ p: 'Edited text' }], [{ p: 'Original text' }],
    ])
    assert.deepEqual(legacy.discussion.anchor.locus, { kind: 'artifact-block', block: 0 })
    assert.deepEqual(legacy.discussion.posts, rows.discussion.posts)

    const expected = expectedMigratedDocumentRows(legacy, artifactId)
    const migratedIds = expected.history.map(version => version.body.blocks[0].id)
    assert.equal(migratedIds[0], docBlockId(artifactId, 0, 0))
    assert.equal(migratedIds[1], docBlockId(artifactId, 1, 0))
    assert.equal(migratedIds[2], migratedIds[0], 'restore reuses its source version block identity')
    assert.equal(expected.body.blocks[0].id, migratedIds[0], 'current body uses the latest restored history IDs')
    assert.deepEqual(expected.discussion.anchor.locus, legacy.discussion.anchor.locus,
      'numeric legacy discussion loci are not rewritten by the current migration')

    const expectedOtherEntities = before.entities.filter(row => row.entity_id !== discussionId)
    const actualOtherEntities = after.entities.filter(row => row.entity_id !== discussionId)
    assert.deepEqual(actualOtherEntities, expectedOtherEntities)
    for (const key of ['unrelated-artifact', 'receipt-key']) {
      assert.deepEqual(after.mapEntries.filter(row => row.key === key), before.mapEntries.filter(row => row.key === key))
    }
    assert.deepEqual(after.kv.filter(row => row.key !== 'version'), before.kv.filter(row => row.key !== 'version'))
    assert.deepEqual(after.kv.find(row => row.key === 'commissionMcp'),
      before.kv.find(row => row.key === 'commissionMcp'), 'v7 Commission claims are untouched by Document staging')
    assert.deepEqual(after.entities.find(row => row.slice === 'usageReservations'),
      before.entities.find(row => row.slice === 'usageReservations'), 'v7 usage reservations are untouched by Document staging')
    assert.equal(after.entities.find(row => row.entity_id === discussionId).json, JSON.stringify(legacy.discussion))
    assert.ok(before.mapEntries.some(row => row.slice === 'artifactBodies' && row.key === artifactId))
  })
})

test('refuses stale, future, and invalid store versions before any migration write', async () => {
  await withProfile(async (profile, rows) => {
    const captured = readDocumentSmokeRows(profile, { artifactId, discussionId })
    const versions = [
      { encoded: String(STORE_VERSION - 1), label: 'stale' },
      { encoded: String(STORE_VERSION + 1), label: 'future' },
      { encoded: JSON.stringify(String(STORE_VERSION)), label: 'string version' },
      { encoded: 'null', label: 'null version' },
      { encoded: 'not-json', label: 'invalid JSON version' },
    ]
    const database = new DatabaseSync(join(profile, 'store.db'))
    try {
      for (const version of versions) {
        database.prepare('UPDATE kv SET json = ? WHERE key = ?').run(version.encoded, 'version')
        const before = readAll(profile)
        assert.throws(() => stageLegacyDocumentMigration(profile, {
          artifactId, discussionId, ...captured,
        }), undefined, `${version.label} store version is refused`)
        assert.deepEqual(readAll(profile), before, `${version.label} refusal leaves every SQLite row untouched`)
      }
    } finally {
      database.close()
    }
    assert.equal(rows.body.type, 'doc')
  })
})

test('refuses a current/history mismatch and a stale supplied snapshot without partial writes', async () => {
  await withProfile(async (profile, rows) => {
    const original = readAll(profile)
    const brokenHistory = structuredClone(rows.history)
    brokenHistory[2].body.blocks[0].p = 'does not match current body'
    const mismatch = { ...rows, history: brokenHistory }
    assert.throws(() => stageLegacyDocumentMigration(profile, { artifactId, discussionId, ...mismatch }), /still matches the captured snapshot/)
    assert.deepEqual(readAll(profile), original, 'snapshot mismatch leaves every SQLite row untouched')

    const captured = readDocumentSmokeRows(profile, { artifactId, discussionId })
    const stale = { ...captured, discussion: { ...captured.discussion, openedAt: 999 } }
    assert.throws(() => stageLegacyDocumentMigration(profile, { artifactId, discussionId, ...stale }), /Discussion still matches/)
    assert.deepEqual(readAll(profile), original, 'stale Discussion snapshot leaves every SQLite row untouched')

    const database = new DatabaseSync(join(profile, 'store.db'))
    try {
      const changedBody = structuredClone(rows.body)
      changedBody.blocks[0].p = 'current/history mismatch'
      database.prepare('UPDATE map_entries SET json = ? WHERE slice = ? AND key = ?')
        .run(JSON.stringify(changedBody), 'artifactBodies', artifactId)
    } finally { database.close() }
    const mismatched = readAll(profile)
    const matchingSnapshot = readDocumentSmokeRows(profile, { artifactId, discussionId })
    assert.throws(() => stageLegacyDocumentMigration(profile, {
      artifactId, discussionId, ...matchingSnapshot,
    }), /current body still matches its latest retained version/)
    assert.deepEqual(readAll(profile), mismatched, 'current/history mismatch leaves the database unchanged')
  })
})

test('refuses profiles outside the generated artifact-history smoke namespace', async () => {
  const rows = initialRows()
  assert.throws(() => stageLegacyDocumentMigration('/tmp/not-a-generated-profile', {
    artifactId, discussionId, ...rows,
  }), /profile is generated smoke data/)
})
