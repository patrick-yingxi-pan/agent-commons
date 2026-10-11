import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Session } from '../../contract/index.ts'
import { mcpConnectionCreationId } from '../mcpConnections.ts'
import { closePersistence, STORE_VERSION, type PersistedState } from './persist.ts'
import { hasCorePersistedShape } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-mcp-oauth-activity-'))
const jsonPath = join(root, 'json', 'store.json')
const sqlitePath = join(root, 'sqlite', 'store.db')
const priorDataFile = process.env.DATA_FILE

function baseline(session: Session, ownerUserId: string, tenantId: string, id: string): PersistedState {
  const activity = session.messages![0]!.toolActivities![0]!
  return {
    version: STORE_VERSION, initialWorld: 'clean', sessions: [session], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    savedContexts: [],
    mcpConnections: { connections: [], retired: [{ tenantId, id, ownerUserId }] },
    mcpActivityAuthorities: [{ sessionId: session.id, activityId: activity.id, connectionId: id, tenantId, ownerUserId }],
    seq: { session: 1, message: 1, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  }
}

after(() => {
  closePersistence()
  if (priorDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = priorDataFile
  rmSync(root, { recursive: true, force: true })
})

test('private OAuth activity owners survive JSON and SQLite round trips, including retired connections', () => {
  process.env.DATA_FILE = jsonPath
  const tenantId = 'tenant-oauth'
  const ownerUserId = 'user-owner'
  const id = mcpConnectionCreationId(tenantId, 'historical-oauth', ownerUserId)
  const session: Session = {
    id: 'session-oauth-history', tenantId, title: 'History', preview: '',
    messages: [{ id: 'message-oauth-history', role: 'assistant', content: '', toolActivities: [{
      id: 'activity-oauth-history', tool: 'mcp__remote__lookup', connector: 'Remote', connectorId: id,
      kind: 'action', status: 'proposed', summary: 'Review', input: {},
      mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash: 'a'.repeat(64) },
    }] }],
  }
  const state = baseline(session, ownerUserId, tenantId, id)
  mkdirSync(join(root, 'json'), { recursive: true })
  const json = new JsonFileBackend()
  json.save(state)
  assert.deepEqual(json.load()?.mcpActivityAuthorities, state.mcpActivityAuthorities)
  assert.equal(hasCorePersistedShape(json.load()), true)

  mkdirSync(join(root, 'sqlite'), { recursive: true })
  const sqlite = new SqliteBackend(sqlitePath)
  sqlite.save(state)
  assert.deepEqual(sqlite.load()?.mcpActivityAuthorities, state.mcpActivityAuthorities)
  sqlite.close()
})

test('missing, wrong-owner and orphan OAuth activity authority refuse JSON startup without rewriting bytes', () => {
  process.env.DATA_FILE = jsonPath
  mkdirSync(join(root, 'json'), { recursive: true })
  const tenantId = 'tenant-oauth'
  const ownerUserId = 'user-owner'
  const id = mcpConnectionCreationId(tenantId, 'invalid-oauth', ownerUserId)
  const session: Session = {
    id: 'session-invalid-oauth', tenantId, title: 'History', preview: '',
    messages: [{ id: 'message-invalid-oauth', role: 'assistant', content: '', toolActivities: [{
      id: 'activity-invalid-oauth', tool: 'mcp__remote__lookup', connector: 'Remote', connectorId: id,
      kind: 'action', status: 'proposed', summary: 'Review', input: {},
      mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash: 'a'.repeat(64) },
    }] }],
  }
  const backend = new JsonFileBackend()
  const good = baseline(session, ownerUserId, tenantId, id)
  for (const invalid of [
    { ...good, mcpActivityAuthorities: [] },
    { ...good, mcpActivityAuthorities: [{ ...good.mcpActivityAuthorities![0], ownerUserId: 'user-other' }] },
    { ...good, mcpActivityAuthorities: [{ ...good.mcpActivityAuthorities![0], activityId: 'missing' }] },
  ]) {
    assert.equal(hasCorePersistedShape(invalid as PersistedState), false)
    writeFileSync(jsonPath, JSON.stringify(invalid))
    const bytes = readFileSync(jsonPath, 'utf8')
    assert.throws(() => backend.load(), /unreadable or incompatible/)
    assert.equal(readFileSync(jsonPath, 'utf8'), bytes, 'startup refuses rather than replacing uncertain authority')
  }
})
