/** Test-only SQLite fixture for the v5 → current native Document migration smoke.
 *  The caller owns the stopped-app and unreachable-service preconditions. This helper
 *  grants no production authority and only edits the selected Artifact/Discussion.
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { basename, join } from 'node:path'
import { docBlockId } from '../server/documentIdentity.ts'
import { STORE_VERSION } from '../server/persistence/format.ts'

const PROFILE_PREFIX = 'agent-commons-artifact-history-smoke-'

function readJsonRow(database, sql, ...params) {
  const row = database.prepare(sql).get(...params)
  assert.ok(row, 'native Document migration fixture row exists')
  return JSON.parse(String(row.json))
}

function versionedBody(artifactId, body, revision) {
  if (body?.type !== 'doc') return structuredClone(body)
  assert.ok(Array.isArray(body.blocks), 'native Document body has blocks')
  return {
    ...structuredClone(body),
    blocks: body.blocks.map((block, index) => ({ ...structuredClone(block), id: docBlockId(artifactId, revision, index) })),
  }
}

/** Read the exact persisted rows used as the smoke's compare-before-write snapshot. */
export function readDocumentSmokeRows(profile, { artifactId, discussionId }) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const body = readJsonRow(database,
      'SELECT json FROM map_entries WHERE slice = ? AND key = ?', 'artifactBodies', artifactId)
    const history = readJsonRow(database,
      'SELECT json FROM map_entries WHERE slice = ? AND key = ?', 'artifactHistory', artifactId)
    const rows = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?')
      .all('discussions', discussionId)
    assert.equal(rows.length, 1, 'native Document migration fixture has exactly one matching Discussion')
    return { body, history, discussion: JSON.parse(String(rows[0].json)) }
  } finally {
    database.close()
  }
}

/**
 * Restore this smoke profile to the exact v5 pre-migration snapshot. The supplied
 * rows are an optimistic snapshot, so any drift refuses before the transaction.
 */
export function stageLegacyDocumentMigration(profile, fixture) {
  assert.equal(typeof profile, 'string', 'native Document migration profile is a path')
  assert.ok(basename(profile).startsWith(PROFILE_PREFIX), 'native Document migration profile is generated smoke data')
  assert.ok(fixture && typeof fixture === 'object', 'native Document migration fixture is supplied')
  const { artifactId, discussionId, body, history, discussion } = fixture
  assert.ok(typeof artifactId === 'string' && artifactId.length > 0, 'native Document migration Artifact id is supplied')
  assert.ok(typeof discussionId === 'string' && discussionId.length > 0, 'native Document migration Discussion id is supplied')

  const database = new DatabaseSync(join(profile, 'store.db'))
  try {
    const current = readJsonRow(database,
      'SELECT json FROM map_entries WHERE slice = ? AND key = ?', 'artifactBodies', artifactId)
    const retained = readJsonRow(database,
      'SELECT json FROM map_entries WHERE slice = ? AND key = ?', 'artifactHistory', artifactId)
    const discussionRows = database.prepare('SELECT idx, json FROM entities WHERE slice = ? AND entity_id = ?')
      .all('discussions', discussionId)
    assert.equal(discussionRows.length, 1, 'native Document migration fixture has exactly one matching Discussion')
    const currentDiscussion = JSON.parse(String(discussionRows[0].json))
    assert.deepEqual(current, body, 'native Document current body still matches the captured snapshot')
    assert.deepEqual(retained, history, 'native Document history still matches the captured snapshot')
    assert.deepEqual(currentDiscussion, discussion, 'native Document Discussion still matches the captured snapshot')
    assert.equal(readJsonRow(database, 'SELECT json FROM kv WHERE key = ?', 'version'), STORE_VERSION,
      `native Document smoke starts from a current v${STORE_VERSION} store`)
    assert.equal(current?.type, 'doc', 'native Document migration fixture targets a Document')
    assert.ok(Array.isArray(retained) && retained.length > 0, 'native Document has retained history')
    const latest = retained.at(-1)
    assert.ok(latest?.body?.type === 'doc', 'native Document latest retained version is a Document')
    const currentWithoutRevision = structuredClone(current)
    delete currentWithoutRevision.revision
    assert.equal(current.revision ?? 0, latest.revision, 'native Document current and latest history revisions agree')
    assert.deepEqual(currentWithoutRevision, latest.body,
      'native Document current body still matches its latest retained version')
    assert.equal(currentDiscussion.anchor?.ref?.kind, 'artifact', 'native Discussion points to an Artifact')
    assert.equal(currentDiscussion.anchor.ref.id, artifactId, 'native Discussion points to this Artifact')
    assert.equal(currentDiscussion.anchor.locus?.kind, 'artifact-block', 'native Discussion has a block locus')
    assert.equal(typeof currentDiscussion.anchor.locus.blockId, 'string', 'native Discussion uses a stable block identity')

    const legacy = structuredClone({ body: current, history: retained, discussion: currentDiscussion })
    for (const version of legacy.history) {
      if (version.body?.type !== 'doc') continue
      assert.ok(Array.isArray(version.body.blocks), 'retained Document revision has blocks')
      for (const block of version.body.blocks) delete block.id
    }
    for (const block of legacy.body.blocks) delete block.id
    legacy.discussion.anchor.locus = { kind: 'artifact-block', block: 0 }

    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('UPDATE map_entries SET json = ? WHERE slice = ? AND key = ?')
        .run(JSON.stringify(legacy.body), 'artifactBodies', artifactId)
      database.prepare('UPDATE map_entries SET json = ? WHERE slice = ? AND key = ?')
        .run(JSON.stringify(legacy.history), 'artifactHistory', artifactId)
      database.prepare('UPDATE entities SET json = ? WHERE slice = ? AND idx = ?')
        .run(JSON.stringify(legacy.discussion), 'discussions', Number(discussionRows[0].idx))
      database.prepare('UPDATE kv SET json = ? WHERE key = ?').run('5', 'version')
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return legacy
  } finally {
    database.close()
  }
}

/** Exact current rows expected after startup migrates the returned legacy snapshot. */
export function expectedMigratedDocumentRows(legacyRows, artifactId) {
  const history = []
  for (const version of legacyRows.history) {
    if (version.body?.type !== 'doc') {
      history.push(structuredClone(version))
      continue
    }
    if (version.reason === 'restore') {
      const source = history.find(candidate => candidate.revision === version.restoredFromRevision)
      assert.ok(source, 'Document restore history references an earlier retained source')
      history.push({ ...structuredClone(version), body: structuredClone(source.body) })
      continue
    }
    history.push({
      ...structuredClone(version),
      body: versionedBody(artifactId, version.body, version.revision),
    })
  }
  const latest = history.at(-1)
  assert.ok(latest, 'native Document migration expected history is non-empty')
  const body = legacyRows.body?.type === 'doc' && latest.body?.type === 'doc'
    ? { ...structuredClone(legacyRows.body), blocks: structuredClone(latest.body.blocks) }
    : structuredClone(legacyRows.body)
  return { body, history, discussion: structuredClone(legacyRows.discussion) }
}
