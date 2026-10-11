import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { mcpConnectionCreationId, mcpStdioConnectionCreationId, McpConnectionError } from '../mcpConnections.ts'
import { store } from '../store/index.ts'
import { closePersistence, STORE_VERSION, type PersistedState } from './persist.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'agent-commons-mcp-connections-'))
const JSON_PATH = join(ROOT, 'json', 'store.json')
const SQLITE_PATH = join(ROOT, 'sqlite', 'store.db')
const previousBackend = process.env.PERSIST_BACKEND
const previousDataFile = process.env.DATA_FILE
const previousDatabasePath = process.env.DATABASE_PATH

function baseline(): PersistedState {
  return {
    version: STORE_VERSION,
    initialWorld: 'clean',
    sessions: [],
    bindings: [],
    workspaces: [],
    schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    savedContexts: [],
    mcpConnections: { connections: [], retired: [] },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  }
}

function connectionState() {
  const id = mcpConnectionCreationId('tenant-alpha', 'primary')
  const stdioId = mcpStdioConnectionCreationId('tenant-alpha', 'local-primary', 'user-alpha')
  return {
    connections: [{
      tenantId: 'tenant-alpha', id, label: 'Metrics', endpoint: 'https://8.8.8.8/mcp',
      authentication: 'none' as const, revision: 3, connected: true,
      inspection: {
        protocolVersion: '2026-07-28', cleanup: 'not-needed' as const, inspectedAt: 123,
        tools: [{ name: 'metrics.read', inputSchema: { type: 'object' as const } }],
      },
    }, {
      transport: 'stdio' as const, tenantId: 'tenant-alpha', ownerUserId: 'user-alpha', id: stdioId,
      label: 'Local tool', revision: 2, connected: true, grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
      inspection: {
        protocolVersion: '2026-07-28', cleanup: 'released' as const, inspectedAt: 456,
        tools: [{ name: 'local.read', inputSchema: { type: 'object' as const } }],
      },
    }],
    retired: [],
  }
}

after(() => {
  closePersistence()
  if (previousBackend === undefined) delete process.env.PERSIST_BACKEND
  else process.env.PERSIST_BACKEND = previousBackend
  if (previousDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = previousDataFile
  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = previousDatabasePath
  rmSync(ROOT, { recursive: true, force: true })
})

test('the MCP registry round-trips through real JSON and SQLite store paths', () => {
  mkdirSync(dirname(JSON_PATH), { recursive: true })
  mkdirSync(dirname(SQLITE_PATH), { recursive: true })
  const state = { ...baseline(), mcpConnections: connectionState() }

  const json = new JsonFileBackend()
  process.env.DATA_FILE = JSON_PATH
  json.save(state)
  assert.deepEqual(json.load()?.mcpConnections, state.mcpConnections)
  assert.equal(Object.hasOwn(json.load()!.mcpConnections!.connections[0]!, 'transport'), false,
    'legacy HTTP rows retain their absence-as-HTTP encoding')
  assert.equal(json.load()?.mcpConnections?.connections[1]?.transport, 'stdio')
  assert.equal(json.load()?.mcpConnections?.connections[1]?.grantReference, `MCP_STDIO_${'A'.repeat(32)}`)

  const sqlite = new SqliteBackend(SQLITE_PATH)
  sqlite.save(state)
  assert.deepEqual(sqlite.load()?.mcpConnections, state.mcpConnections)
  sqlite.close()
})

test('absent MCP state is empty while a present malformed slice fails startup admission', () => {
  mkdirSync(dirname(JSON_PATH), { recursive: true })
  process.env.DATA_FILE = JSON_PATH
  const old = baseline()
  delete old.mcpConnections
  const json = new JsonFileBackend()
  json.save(old)
  assert.equal(json.load()?.mcpConnections, undefined)

  const malformed = { ...baseline(), mcpConnections: { connections: [{ id: 'mcp-connection-bad', tenantId: 'tenant-alpha' }], retired: [] } }
  writeFileSync(JSON_PATH, JSON.stringify(malformed))
  assert.throws(() => json.load(), /unreadable or incompatible/)
  assert.deepEqual(JSON.parse(readFileSync(JSON_PATH, 'utf8')), malformed)

  const lostCredentialReference = {
    ...baseline(),
    mcpConnections: {
      connections: [{
        tenantId: 'tenant-alpha', id: mcpConnectionCreationId('tenant-alpha', 'lost-secret'), label: 'Lost secret',
        endpoint: 'https://8.8.8.8/mcp', authentication: 'device-bearer', revision: 1, connected: true,
        inspection: { protocolVersion: '2026-07-28', cleanup: 'not-needed', inspectedAt: 1, tools: [] },
      }],
      retired: [],
    },
  }
  writeFileSync(JSON_PATH, JSON.stringify(lostCredentialReference))
  assert.throws(() => json.load(), /unreadable or incompatible/, 'a connected device credential cannot rehydrate without its reference')
})

test('saved-context projection drops reserved MCP ids from the connector quick list', () => {
  const file = join(ROOT, 'reserved-context', 'store.json')
  mkdirSync(dirname(file), { recursive: true })
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = file
  const reserved = {
    id: 'mcp-connection-legacy-connector', label: 'Legacy MCP row', kind: 'connector' as const,
    status: 'connected' as const, detail: 'legacy', lastUsedAt: null, sessions: 0,
    tenantId: 'tenant-alpha',
  }
  const ordinary = {
    id: 'ordinary-connector', label: 'Ordinary connector', kind: 'connector' as const,
    status: 'connected' as const, detail: 'ordinary', lastUsedAt: null, sessions: 0,
    tenantId: 'tenant-alpha',
  }
  writeFileSync(file, JSON.stringify({ ...baseline(), savedContexts: [reserved, ordinary] }))
  store.initPersistence()
  const projection = store.savedContexts('tenant-alpha')
  assert.deepEqual(projection.contexts.map((context) => context.id), ['ordinary-connector'])
  assert.deepEqual(projection.connectedConnectorIds, ['ordinary-connector'])
  closePersistence()
})

test('store MCP transitions persist before acknowledgement and stay tenant-private', () => {
  mkdirSync(dirname(JSON_PATH), { recursive: true })
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = JSON_PATH
  const initial = baseline()
  writeFileSync(JSON_PATH, JSON.stringify(initial))
  store.initPersistence()

  const id = mcpConnectionCreationId('tenant-alpha', 'primary')
  const events: Array<{ type: string; id?: string; status?: string; tenantId?: string }> = []
  let durableAtEvent = false
  const unsubscribe = store.subscribe((event) => {
    if (event.type === 'savedcontext.changed' || event.type === 'connector.status') {
      events.push(event)
      if (event.id === id) {
        const saved = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as PersistedState
        durableAtEvent = saved.mcpConnections?.connections.some((connection) => connection.id === id) === true
      }
    }
  })
  const created = store.createMcpConnection({
    id, label: 'Metrics', endpoint: 'https://8.8.8.8/mcp', authentication: 'none',
  }, 'tenant-alpha')
  assert.equal(created.created, true)
  assert.equal(store.mcpConnections('tenant-beta').length, 0)
  assert.equal(store.mcpConnection(id, 'tenant-beta'), undefined)
  assert.equal(store.savedContexts('tenant-beta').contexts.some((context) => context.id === id), false)
  assert.equal('endpoint' in created.connection, false)
  assert.equal('credentialReference' in created.connection, false)
  assert.equal(durableAtEvent, true, 'the setup event is published only after persistence')
  assert.equal(events[0]?.type, 'savedcontext.changed')
  assert.equal(store.eventVisibleToTenant(events[0] as never, 'tenant-alpha'), true)
  assert.equal(store.eventVisibleToTenant(events[0] as never, 'tenant-beta'), false)

  const secureId = mcpConnectionCreationId('tenant-alpha', 'secure')
  const secretReference = `MCP_DESKTOP_${'A'.repeat(32)}`
  store.createMcpConnection({
    id: secureId, label: 'Secure metrics', endpoint: 'https://1.1.1.1/mcp', authentication: 'device-bearer',
  }, 'tenant-alpha')
  store.commitMcpInspection(secureId, 'tenant-alpha', 0, {
    protocolVersion: '2026-07-28', cleanup: 'not-needed', inspectedAt: 0,
    tools: [{ name: 'metrics.read', inputSchema: { type: 'object' } }],
  }, 456, secretReference)
  assert.deepEqual(store.mcpCredentialBindings(), [{
    reference: secretReference,
    binding: { tenantId: 'tenant-alpha', connectionId: secureId, endpoint: 'https://1.1.1.1/mcp' },
  }])
  store.addSavedContext({
    id: 'fixture-connector', label: 'Fixture connector', kind: 'connector', status: 'connected',
    detail: 'fixture', lastUsedAt: null, sessions: 0,
  }, 'tenant-alpha')
  const mergedAfterFixtureStatus = store.setConnectorStatus('fixture-connector', 'needs-auth', 'tenant-alpha')
  assert.equal(mergedAfterFixtureStatus?.contexts.some((context) => context.id === secureId), true)

  const raw = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as PersistedState
  assert.equal(raw.mcpConnections?.connections.length, 2)
  assert.equal(raw.savedContexts?.some((context) => context.id === id), false)

  const inspected = store.commitMcpInspection(id, 'tenant-alpha', 0, {
    protocolVersion: '2026-07-28', cleanup: 'not-needed', inspectedAt: 0,
    tools: [{ name: 'metrics.read', inputSchema: { type: 'object' } }],
  }, 123)
  assert.equal(inspected.status, 'connected')
  assert.equal(store.savedContexts('tenant-alpha').connectedMcpIds.includes(id), true)
  store.disconnectMcpConnection(id, 'tenant-alpha', 1)
  assert.equal(store.mcpConnection(id, 'tenant-alpha')?.status, 'disconnected')
  assert.equal(store.removeMcpConnection(id, 'tenant-alpha', 2), true)
  assert.equal(store.mcpConnection(id, 'tenant-alpha'), undefined)
  assert.throws(
    () => store.createMcpConnection({ id, label: 'Metrics', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, 'tenant-alpha'),
    (error: unknown) => error instanceof McpConnectionError && error.code === 'retired',
  )
  closePersistence()
  store.initPersistence()
  assert.equal(store.mcpConnections('tenant-alpha').length, 1, 'restart retains the surviving private MCP row')
  assert.deepEqual(store.privateMcpConnection(secureId, 'tenant-alpha'), {
    tenantId: 'tenant-alpha', id: secureId, label: 'Secure metrics', endpoint: 'https://1.1.1.1/mcp',
    authentication: 'device-bearer', credentialReference: secretReference, revision: 1, connected: true,
    inspection: {
      protocolVersion: '2026-07-28', cleanup: 'not-needed', inspectedAt: 456,
      tools: [{ name: 'metrics.read', inputSchema: { type: 'object' } }],
    },
  })
  assert.equal(store.mcpCredentialBindings().length, 1, 'restart retains the credential binding without exposing it publicly')
  assert.throws(
    () => store.createMcpConnection({ id, label: 'Metrics', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, 'tenant-alpha'),
    (error: unknown) => error instanceof McpConnectionError && error.code === 'retired',
  )
  assert.throws(
    () => store.addSavedContext({ id, label: 'forged', kind: 'mcp', status: 'connected', detail: 'forged', lastUsedAt: null, sessions: 0 }, 'tenant-alpha'),
    (error: unknown) => error instanceof McpConnectionError && error.code === 'invalid',
  )
  assert.throws(() => store.setConnectorStatus(id, 'connected', 'tenant-alpha'), McpConnectionError)
  assert.throws(() => store.removeSavedContext(id, 'tenant-alpha'), McpConnectionError)
  unsubscribe()
})

test('a failed MCP persistence commit publishes no event and writes no acknowledgement', () => {
  const file = join(ROOT, 'failure', 'store.json')
  const blocked = join(ROOT, 'failure', 'blocked')
  const storeUrl = pathToFileURL(join(process.cwd(), 'server/store/index.ts')).href
  const identityUrl = pathToFileURL(join(process.cwd(), 'server/mcpConnections.ts')).href
  const childScript = `
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
    import { store } from ${JSON.stringify(storeUrl)}
    import { mcpConnectionCreationId } from ${JSON.stringify(identityUrl)}
    const file = ${JSON.stringify(file)}
    const blocked = ${JSON.stringify(blocked)}
    const state = ${JSON.stringify(baseline())}
    process.env.PERSIST_BACKEND = 'json'
    process.env.DATA_FILE = file
    mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
    writeFileSync(file, JSON.stringify(state))
    store.initPersistence()
    const id = mcpConnectionCreationId('tenant-alpha', 'failed-write')
    let event = false
    store.subscribe((next) => { if (next.type === 'savedcontext.changed' && next.id === id) event = true })
    mkdirSync(blocked, { recursive: true })
    process.env.DATA_FILE = blocked
    let failed = false
    try {
      store.createMcpConnection({ id, label: 'Should not ack', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, 'tenant-alpha')
    } catch {
      failed = true
    }
    process.env.DATA_FILE = file
    const durable = JSON.parse(readFileSync(file, 'utf8'))
    if (!failed || event || durable.mcpConnections.connections.some((row) => row.id === id)) process.exitCode = 1
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: process.cwd(), encoding: 'utf8',
  })
  assert.equal(child.status, 0, child.stderr || child.stdout)
})
