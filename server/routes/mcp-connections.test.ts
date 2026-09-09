import { after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { call } from '../testkit/http.ts'
import {
  configureMcpRuntime,
  mcpRuntimeCapabilities,
} from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpDiscovery.ts'
import { store } from '../store/index.ts'

const suffix = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
const owner = `mcp-route-owner-${suffix}`
const foreign = `mcp-route-foreign-${suffix}`
const publicEndpoint = 'https://mcp.example.test/tools'
const defaultRuntime = { deviceBearerAvailable: false, allowLoopback: false }

afterEach(() => {
  configureMcpRuntime(defaultRuntime)
})

after(() => {
  configureMcpRuntime(defaultRuntime)
})

function auth(tenantId: string) {
  return { 'x-tenant-id': tenantId }
}

const sessionCookie = (response: { headers: Record<string, string> }): string => {
  const token = response.headers['set-cookie']?.match(/uw_session=([^;,]+)/)?.[1] ?? ''
  return `uw_session=${token}`
}

function createBody(creationId: string, endpoint = publicEndpoint, authentication: 'none' | 'device-bearer' = 'none') {
  return { creationId, label: 'Route test MCP', endpoint, authentication }
}

function inspectionBody(operationId = 'route-inspection-1', expectedRevision = 0) {
  return { operationId, expectedRevision }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function rpcResult(id: unknown, result: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, result })
}

test('list/create are tenant-scoped and foreign detail reads are existence-hidden', async () => {
  configureMcpRuntime(defaultRuntime)
  const before = await call('GET', '/mcp-connections', undefined, auth(owner))
  assert.equal(before.status, 200)
  assert.deepEqual(before.json.connections, [])
  assert.deepEqual(before.json.capabilities, {
    deviceBearerCredentials: false,
    loopbackConnections: false,
    credentialCleanupPending: false,
  })

  const created = await call('POST', '/mcp-connections', createBody('owner-list'), auth(owner))
  assert.equal(created.status, 200)
  assert.equal(created.json.created, true)
  const connection = created.json.connection
  assert.equal(connection.authentication, 'none')
  assert.equal(connection.status, 'unverified')
  assert.equal(connection.execution, 'unavailable')
  assert.equal(connection.endpoint, undefined)
  assert.equal(connection.tenantId, undefined)

  const ownDetail = await call('GET', `/mcp-connections/${connection.id}`, undefined, auth(owner))
  assert.equal(ownDetail.status, 200)
  assert.equal(ownDetail.json.id, connection.id)
  const foreignDetail = await call('GET', `/mcp-connections/${connection.id}`, undefined, auth(foreign))
  assert.equal(foreignDetail.status, 404)
  assert.equal(foreignDetail.json.error.code, 'not_found')

  const ownList = await call('GET', '/mcp-connections', undefined, auth(owner))
  const foreignList = await call('GET', '/mcp-connections', undefined, auth(foreign))
  assert.equal(ownList.json.connections.some((row: { id: string }) => row.id === connection.id), true)
  assert.equal(foreignList.json.connections.some((row: { id: string }) => row.id === connection.id), false)
})

test('a stale browser account source refuses every private connection ceremony before effects', async () => {
  let credentialResolutions = 0
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: true,
    resolveCredential: async () => { credentialResolutions += 1; return 'must-not-be-resolved' },
    synchronizeBindings: async () => ({ available: true }),
  })

  const maya = await call('POST', '/auth/login', {
    email: 'maya@growthworks.example', password: 'maya-demo-password',
  })
  assert.equal(maya.status, 200)
  const cookie = sessionCookie(maya)
  const tenantId = 'tenant-growthworks'
  const created = await call('POST', '/mcp-connections', createBody(
    `stale-source-existing-${suffix}`, 'http://127.0.0.1:9/mcp', 'device-bearer',
  ), { cookie })
  assert.equal(created.status, 200)
  const id = created.json.connection.id
  const before = store.mcpConnections(tenantId)
  const events: unknown[] = []
  const unsubscribe = store.subscribe(event => events.push(event))
  const stale = { cookie, 'x-account-transition-source': 'session:user-ada' }

  const attempts = [
    call('POST', '/mcp-connections', createBody(`stale-source-new-${suffix}`), stale),
    call('POST', `/mcp-connections/${id}/inspect`, {
      ...inspectionBody(`stale-source-inspect-${suffix}`), credentialReference: `MCP_DESKTOP_${'A'.repeat(32)}`,
    }, stale),
    call('POST', `/mcp-connections/${id}/disconnect`, { expectedRevision: 0 }, stale),
    call('DELETE', `/mcp-connections/${id}`, { expectedRevision: 0 }, stale),
    call('POST', `/mcp-connections/${id}/credential-cleanup`, {}, stale),
    call('GET', `/mcp-connections/${id}/credential-binding`, undefined, stale),
  ]
  const rejected = await Promise.all(attempts)
  unsubscribe()

  assert.deepEqual(rejected.map(response => response.status), [409, 409, 409, 409, 409, 409])
  assert.deepEqual(store.mcpConnections(tenantId), before, 'no row or revision changes under the cookie-selected account')
  assert.equal(credentialResolutions, 0, 'inspection is refused before credential or endpoint I/O')
  assert.deepEqual(events, [], 'no private ceremony publishes an event')
})

test('route normalizers reject unknown fields, whitespace keys, raw URL credentials, fragments, and malformed lifecycle bodies', async () => {
  configureMcpRuntime(defaultRuntime)
  const valid = createBody('strict-valid')
  const invalidCreates = [
    { ...valid, extra: true },
    { ...valid, creationId: '   ' },
    { ...valid, endpoint: 'https://user:secret@mcp.example.test/tools' },
    { ...valid, endpoint: 'https://mcp.example.test/tools#secret' },
    { ...valid, endpoint: 'http://127.0.0.1:9/mcp' },
    [],
    null,
  ]
  const beforeCount = (await call('GET', '/mcp-connections', undefined, auth(owner))).json.connections.length
  for (const body of invalidCreates) {
    const response = await call('POST', '/mcp-connections', body, auth(owner))
    assert.equal(response.status, 400)
    assert.equal(response.json.error.code, 'bad_request')
    assert.doesNotMatch(JSON.stringify(response.json), /secret|mcp\.example/)
  }

  const created = await call('POST', '/mcp-connections', valid, auth(owner))
  assert.equal(created.status, 200)
  const id = created.json.connection.id
  const invalidInspections = [
    { ...inspectionBody(), unexpected: true },
    { ...inspectionBody(), operationId: '   ' },
    { ...inspectionBody(), credentialReference: 'PROVIDER_DESKTOP_bad' },
    [],
    null,
  ]
  for (const body of invalidInspections) {
    const response = await call('POST', `/mcp-connections/${id}/inspect`, body, auth(owner))
    assert.equal(response.status, 400)
    assert.equal(response.json.error.code, 'bad_request')
  }
  for (const method of ['POST', 'DELETE'] as const) {
    const path = method === 'POST' ? `/mcp-connections/${id}/disconnect` : `/mcp-connections/${id}`
    const response = await call(method, path, { expectedRevision: 0, extra: true }, auth(owner))
    assert.equal(response.status, 400)
    assert.equal(response.json.error.code, 'bad_request')
  }
  const after = await call('GET', '/mcp-connections', undefined, auth(owner))
  assert.equal(after.json.connections.length, beforeCount + 1, 'invalid bodies never create or mutate a row')
})

test('default runtime is public-only and refuses device credentials and loopback admission', async () => {
  configureMcpRuntime(defaultRuntime)
  assert.deepEqual(mcpRuntimeCapabilities(), {
    deviceBearerCredentials: false,
    loopbackConnections: false,
    credentialCleanupPending: false,
  })
  const loopback = await call('POST', '/mcp-connections', createBody('default-loopback', 'http://127.0.0.1:9/mcp'), auth(owner))
  assert.equal(loopback.status, 400)
  assert.equal(loopback.json.error.code, 'bad_request')
  const secure = await call('POST', '/mcp-connections', createBody('default-secure', publicEndpoint, 'device-bearer'), auth(owner))
  assert.equal(secure.status, 409)
  assert.equal(secure.json.error.code, 'capability_unavailable')
  const publicConnection = await call('POST', '/mcp-connections', createBody('default-public'), auth(owner))
  assert.equal(publicConnection.status, 200)
})

test('credential binding is an owner-only, no-store ceremony and never an ordinary public projection', async () => {
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'test-only-unused-secret',
    synchronizeBindings: async () => ({ available: true }),
  })
  const headers = auth(`${owner}-binding`)
  const created = await call('POST', '/mcp-connections', createBody('binding-secure', publicEndpoint, 'device-bearer'), headers)
  assert.equal(created.status, 200)
  const id = created.json.connection.id
  const ordinary = await call('GET', `/mcp-connections/${id}`, undefined, headers)
  assert.equal(ordinary.status, 200)
  assert.equal(ordinary.json.endpoint, undefined)
  assert.equal(ordinary.json.credentialReference, undefined)

  const binding = await call('GET', `/mcp-connections/${id}/credential-binding`, undefined, headers)
  assert.equal(binding.status, 200)
  assert.equal(binding.headers['cache-control'], 'no-store')
  assert.deepEqual(binding.json, {
    binding: { tenantId: `${owner}-binding`, connectionId: id, endpoint: publicEndpoint },
  })
  const foreignBinding = await call('GET', `/mcp-connections/${id}/credential-binding`, undefined, auth(`${foreign}-binding`))
  assert.equal(foreignBinding.status, 404)

  const publicCreated = await call('POST', '/mcp-connections', createBody('binding-public'), headers)
  assert.equal(publicCreated.status, 200)
  const nonSecure = await call('GET', `/mcp-connections/${publicCreated.json.connection.id}/credential-binding`, undefined, headers)
  assert.equal(nonSecure.status, 400)
  assert.equal(nonSecure.json.error.code, 'bad_request')

  configureMcpRuntime(defaultRuntime)
  const unavailable = await call('GET', `/mcp-connections/${id}/credential-binding`, undefined, headers)
  assert.equal(unavailable.status, 409)
  assert.equal(unavailable.json.error.code, 'capability_unavailable')
})

test('legacy saved-context routes refuse reserved external MCP identities', async () => {
  configureMcpRuntime(defaultRuntime)
  const reserved = `mcp-connection-legacy-route-${suffix}`
  const context = {
    id: reserved,
    label: 'Legacy MCP attempt',
    kind: 'connector',
    status: 'connected',
    detail: 'reserved identity mutation probe',
    lastUsedAt: null,
    sessions: 0,
  }
  const added = await call('POST', '/saved-contexts', { context }, auth(owner))
  assert.equal(added.status, 400)
  assert.equal(added.json.error.code, 'bad_request')
  const patched = await call('PATCH', `/saved-contexts/${reserved}`, { status: 'needs-auth' }, auth(owner))
  assert.equal(patched.status, 400)
  assert.equal(patched.json.error.code, 'bad_request')
  const removed = await call('DELETE', `/saved-contexts/${reserved}`, {}, auth(owner))
  assert.equal(removed.status, 400)
  assert.equal(removed.json.error.code, 'bad_request')
})

test('loopback lifecycle creates, inspects through the real transport, disconnects, and removes', async (t) => {
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  const methods: string[] = []
  const peer = createServer(async (req, res) => {
    const body = await readJson(req)
    methods.push(String(body.method))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (body.method === 'server/discover') {
      res.end(rpcResult(body.id, { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }))
      return
    }
    assert.equal(body.method, 'tools/list')
    res.end(rpcResult(body.id, { tools: [{ name: 'route_tool', inputSchema: { type: 'object' } }] }))
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    peer.closeAllConnections()
    await new Promise<void>(resolve => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const endpoint = `http://127.0.0.1:${address.port}/mcp`
  const headers = auth(`${owner}-loopback`)
  const created = await call('POST', '/mcp-connections', createBody('loopback-lifecycle', endpoint), headers)
  assert.equal(created.status, 200)
  const id = created.json.connection.id
  const inspected = await call('POST', `/mcp-connections/${id}/inspect`, inspectionBody('loopback-operation'), headers)
  assert.equal(inspected.status, 200)
  assert.equal(inspected.json.connection.status, 'connected')
  assert.equal(inspected.json.connection.revision, 1)
  assert.equal(inspected.json.connection.tools[0].name, 'route_tool')
  assert.equal(inspected.json.credentialCleanup, 'complete')
  assert.deepEqual(methods, ['server/discover', 'tools/list'])

  const disconnected = await call('POST', `/mcp-connections/${id}/disconnect`, { expectedRevision: 1 }, headers)
  assert.equal(disconnected.status, 200)
  assert.equal(disconnected.json.connection.status, 'disconnected')
  assert.equal(disconnected.json.connection.revision, 2)
  const removed = await call('DELETE', `/mcp-connections/${id}`, { expectedRevision: 2 }, headers)
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.json, { removed: true, credentialCleanup: 'complete' })
  assert.equal((await call('GET', `/mcp-connections/${id}`, undefined, headers)).status, 404)
})
