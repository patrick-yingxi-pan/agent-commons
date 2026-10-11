import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mcpConnectionCreationId } from '../mcpConnections.ts'
import { closePersistence, STORE_VERSION, type PersistedState } from './persist.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-mcp-oauth-owner-'))
const jsonPath = join(root, 'json', 'store.json')
const sqlitePath = join(root, 'sqlite', 'store.db')
const priorDataFile = process.env.DATA_FILE

function baseline(): PersistedState {
  return {
    version: STORE_VERSION, initialWorld: 'clean', sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    savedContexts: [], mcpConnections: { connections: [], retired: [] },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  }
}

function oauthState() {
  const ownerUserId = 'user-oauth-owner'
  const tenantId = 'tenant-shared-org'
  const id = mcpConnectionCreationId(tenantId, 'oauth-fixture', ownerUserId)
  return {
    connections: [{ tenantId, ownerUserId, id, label: 'Private account', endpoint: 'https://mcp.example.test/rpc',
      authentication: 'device-oauth' as const, revision: 2, connected: false }],
    retired: [{ tenantId, id: mcpConnectionCreationId(tenantId, 'retired-oauth', ownerUserId), ownerUserId }],
  }
}

after(() => {
  closePersistence()
  if (priorDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = priorDataFile
  rmSync(root, { recursive: true, force: true })
})

test('OAuth owner and owner-bound retirement tombstone round-trip through JSON and SQLite', () => {
  mkdirSync(join(root, 'json'), { recursive: true })
  process.env.DATA_FILE = jsonPath
  mkdirSync(join(root, 'sqlite'), { recursive: true })
  const state = { ...baseline(), mcpConnections: oauthState() }
  const json = new JsonFileBackend()
  json.save(state)
  assert.deepEqual(json.load()?.mcpConnections, state.mcpConnections)

  const sqlite = new SqliteBackend(sqlitePath)
  sqlite.save(state)
  assert.deepEqual(sqlite.load()?.mcpConnections, state.mcpConnections)
  sqlite.close()
})

test('OAuth rows missing or malformed owner fail closed without rewriting the snapshot; legacy non-OAuth rows remain valid', () => {
  mkdirSync(join(root, 'json'), { recursive: true })
  const backend = new JsonFileBackend()
  const good = { ...baseline(), mcpConnections: oauthState() }
  const missingOwner = structuredClone(good)
  delete (missingOwner.mcpConnections!.connections[0] as { ownerUserId?: string }).ownerUserId
  writeFileSync(jsonPath, JSON.stringify(missingOwner))
  assert.throws(() => backend.load(), /unreadable or incompatible/)
  assert.deepEqual(JSON.parse(readFileSync(jsonPath, 'utf8')), missingOwner, 'rejected state is not replaced with empty/default data')

  const malformedOwner = structuredClone(good)
  ;(malformedOwner.mcpConnections!.connections[0] as { ownerUserId?: string }).ownerUserId = '   '
  writeFileSync(jsonPath, JSON.stringify(malformedOwner))
  assert.throws(() => backend.load(), /unreadable or incompatible/)
  assert.deepEqual(JSON.parse(readFileSync(jsonPath, 'utf8')), malformedOwner)

  const legacy = { ...baseline(), mcpConnections: {
    connections: [{ tenantId: 'tenant-legacy', id: mcpConnectionCreationId('tenant-legacy', 'old'),
      label: 'Legacy bearer', endpoint: 'https://mcp.example.test/rpc', authentication: 'device-bearer' as const,
      revision: 0, connected: false }], retired: [],
  } }
  writeFileSync(jsonPath, JSON.stringify(legacy))
  assert.deepEqual(backend.load()?.mcpConnections, legacy.mcpConnections, 'old rows without an owner remain readable')
})
