import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Session } from '../../contract/index.ts'
import { mcpConnectionCreationId, mcpStdioConnectionCreationId } from '../mcpConnections.ts'
import { closePersistence, STORE_VERSION, type PersistedState } from './persist.ts'
import { hasCorePersistedShape } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-mcp-oauth-activity-'))
const jsonPath = join(root, 'json', 'store.json')
const sqlitePath = join(root, 'sqlite', 'store.db')
const priorDataFile = process.env.DATA_FILE

function baseline(session: Session, ownerUserId: string, tenantId: string, id: string): PersistedState {
  const activity = [...(session.messages ?? []), ...(session.compactedMessages ?? [])]
    .flatMap(message => message.toolActivities ?? [])[0]!
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

test('completed stdio activity authority round-trips through JSON and SQLite for live and retired grants in active and compacted history', () => {
  const tenantId = 'tenant-stdio-owner'
  const ownerUserId = 'user-stdio-owner'
  const id = mcpStdioConnectionCreationId(tenantId, 'stdio-activity-history', ownerUserId)
  const activity = {
    id: 'activity-stdio-history', tool: 'mcp__local__lookup', connector: 'Local', connectorId: id,
    kind: 'action' as const, status: 'done' as const, summary: 'Complete', input: {},
    decisionId: `tool-activity-decision-${'c'.repeat(24)}`,
    mcpResult: { resultType: 'complete' as const, content: [{ type: 'text' as const, text: 'stdio result' }], isError: false },
    mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash: 'b'.repeat(64) },
  }
  mkdirSync(join(root, 'json'), { recursive: true })
  mkdirSync(join(root, 'sqlite'), { recursive: true })
  for (const connectionState of ['live', 'retired'] as const) {
    for (const history of ['active', 'compacted'] as const) {
      const session: Session = {
        id: `session-stdio-${connectionState}-${history}`, tenantId: 'shared-session-tenant', title: 'History', preview: '',
        messages: history === 'active' ? [{ id: 'message-stdio-history', role: 'assistant', content: '', toolActivities: [activity] }] : [],
        ...(history === 'compacted' ? { compactedMessages: [{ id: 'message-stdio-history', role: 'assistant', content: '', toolActivities: [activity] }] } : {}),
      }
      const authority = { sessionId: session.id, activityId: activity.id, connectionId: id, tenantId, ownerUserId }
      const base = baseline(session, ownerUserId, tenantId, id)
      const state: PersistedState = {
        ...base,
        mcpConnections: connectionState === 'live' ? {
          connections: [{ transport: 'stdio', tenantId, ownerUserId, id, label: 'Local', revision: 1,
            connected: true, grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
            inspection: { protocolVersion: '2025-11-25', cleanup: 'released', inspectedAt: 1, tools: [] } }], retired: [],
        } : { connections: [], retired: [{ transport: 'stdio', tenantId, id, ownerUserId }] },
        mcpActivityAuthorities: [authority],
      }
      assert.equal(hasCorePersistedShape(state), true, `${connectionState} person-owned ${history} history should be admitted`)
      const json = new JsonFileBackend()
      json.save(state)
      assert.deepEqual(json.load()?.mcpActivityAuthorities, [authority], `JSON ${connectionState} ${history} authority`)
      assert.deepEqual(json.load()?.sessions[0]?.[history === 'active' ? 'messages' : 'compactedMessages'],
        session[history === 'active' ? 'messages' : 'compactedMessages'], `JSON ${connectionState} ${history} transcript`)

      const path = join(root, 'sqlite', `${connectionState}-${history}.db`)
      const sqlite = new SqliteBackend(path)
      sqlite.save(state)
      assert.deepEqual(sqlite.load()?.mcpActivityAuthorities, [authority], `SQLite ${connectionState} ${history} authority`)
      assert.deepEqual(sqlite.load()?.sessions[0]?.[history === 'active' ? 'messages' : 'compactedMessages'],
        session[history === 'active' ? 'messages' : 'compactedMessages'], `SQLite ${connectionState} ${history} transcript`)
      sqlite.close()
    }
  }
})
