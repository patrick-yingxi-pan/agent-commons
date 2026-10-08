import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { artifactContextId, buildArtifactSnapshot } from '../../contract/artifactSnapshot.ts'
import { STORE_VERSION, hasCorePersistedShape, type PersistedState } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'
import { readPortableSnapshot, writePortableSnapshot } from './portable.ts'

function attachment() {
  const snapshot = buildArtifactSnapshot({
    artifactId: 'persisted-artifact', title: 'Persisted', artifactKind: 'doc',
    body: { type: 'doc', title: 'Persisted', revision: 3, blocks: [{ id: 'persisted-block', p: 'Saved body' }] },
  }, '12345678-1234-4123-8123-123456789012', '2026-10-08T00:00:00.000Z')
  assert.ok(snapshot)
  return { id: artifactContextId(snapshot.artifactId), label: snapshot.title, kind: 'artifact', artifactSnapshot: snapshot }
}

function state(): PersistedState {
  return {
    version: STORE_VERSION,
    initialWorld: 'demo',
    sessions: [], bindings: [],
    workspaces: [['session-1', { workspaces: [], repos: [], connectors: [], attachments: [attachment()] }]],
    schedules: [], recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  } as PersistedState
}

test('Artifact saved copies are closed persisted workspace data and round-trip identically through JSON and SQLite', () => {
  const original = state()
  assert.equal(hasCorePersistedShape(original), true)
  const tempDir = mkdtempSync(join(tmpdir(), 'artifact-context-snapshot-'))
  const file = join(tempDir, 'store.json')
  const portable = join(tempDir, 'portable.json')
  const priorDataFile = process.env.DATA_FILE
  const json = new JsonFileBackend()
  const sqlite = new SqliteBackend(':memory:')
  try {
    process.env.DATA_FILE = file
    json.save(original)
    sqlite.save(original)
    writePortableSnapshot(portable, original)
    const jsonLoaded = json.load()
    const sqliteLoaded = sqlite.load()
    const portableLoaded = readPortableSnapshot(portable)
    assert.equal(hasCorePersistedShape(jsonLoaded), true)
    assert.equal(hasCorePersistedShape(sqliteLoaded), true)
    assert.equal(hasCorePersistedShape(portableLoaded), true)
    assert.deepEqual(jsonLoaded?.workspaces, original.workspaces)
    assert.deepEqual(sqliteLoaded?.workspaces, original.workspaces)
    assert.deepEqual(portableLoaded.workspaces, original.workspaces)
    assert.deepEqual(sqliteLoaded, jsonLoaded)

    const malformed = JSON.parse(JSON.stringify(original)) as PersistedState
    const invalidCopy = malformed.workspaces![0]![1].attachments[0] as any
    invalidCopy.artifactSnapshot.body.blocks[0].id = 'not a valid id with spaces'
    assert.equal(hasCorePersistedShape(malformed), false, 'bad saved body identity fails before rehydration')

    const pending = JSON.parse(JSON.stringify(original)) as PersistedState
    ;(pending.workspaces![0]![1].attachments[0] as any).artifactCaptureId = '12345678-1234-4123-8123-123456789012'
    assert.equal(hasCorePersistedShape(pending), false, 'a staged request marker is never durable workspace state')
  } finally {
    sqlite.close()
    if (priorDataFile === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = priorDataFile
    rmSync(tempDir, { recursive: true, force: true })
  }
})
