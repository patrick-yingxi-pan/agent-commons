import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpConnectionRegistry, mcpConnectionCreationId, mcpConnectionEndpoint,
  parseMcpConnectionState, McpConnectionError, MAX_MCP_CONNECTIONS_PER_TENANT,
} from './mcpConnections.ts'
import { MCP_MODERN_VERSION } from './mcpDiscovery.ts'

const id = mcpConnectionCreationId('owner', 'logical-key')
const setup = { id, label: 'Research', endpoint: 'https://mcp.example/tools', authentication: 'device-bearer' as const }
const ref = `MCP_DESKTOP_${'A'.repeat(32)}`
const discovery = { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed' as const,
  tools: [{ name: 'lookup', description: 'Remote description', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }
const fails = (code: McpConnectionError['code']) => (error: unknown) => error instanceof McpConnectionError && error.code === code

test('logical identity is tenant-scoped, stable, bounded and not a raw retry key', () => {
  assert.match(id, /^mcp-connection-[a-f0-9]{32}$/)
  assert.equal(id, mcpConnectionCreationId('owner', 'logical-key'))
  assert.notEqual(id, mcpConnectionCreationId('visitor', 'logical-key'))
  assert.notEqual(mcpConnectionCreationId('a', 'bc'), mcpConnectionCreationId('ab', 'c'))
  assert.throws(() => mcpConnectionCreationId('owner\0other', 'key'), fails('invalid'))
})

test('scope is deployment policy: public HTTPS or explicitly allowed literal loopback only', () => {
  assert.deepEqual(mcpConnectionEndpoint('https://MCP.example:443/tools', false), { endpoint: setup.endpoint, scope: 'public' })
  assert.deepEqual(mcpConnectionEndpoint('http://127.0.0.1:8000/mcp', true), { endpoint: 'http://127.0.0.1:8000/mcp', scope: 'loopback' })
  for (const endpoint of ['http://127.0.0.1/mcp', 'http://mcp.example/mcp', 'https://user:password@mcp.example', 'https://mcp.example/#token', 'https://10.0.0.1/mcp']) {
    assert.throws(() => mcpConnectionEndpoint(endpoint, false), fails('invalid'))
  }
  for (const endpoint of ['http://localhost:8000', 'http://127.1', 'https://10.0.0.1/mcp']) {
    assert.throws(() => mcpConnectionEndpoint(endpoint, true), fails('invalid'))
  }
})

test('creation saves no authority until inspection; exact replay is current truth and changed intent conflicts', () => {
  const registry = createMcpConnectionRegistry()
  const { connection, created } = registry.create(setup, 'owner')
  assert.equal(created, true)
  assert.equal(connection.status, 'unverified')
  assert.equal(connection.execution, 'unavailable')
  assert.deepEqual(connection.tools, [])
  assert.equal(registry.savedContexts('owner')[0].status, 'needs-auth')
  assert.equal(registry.create(setup, 'owner').created, false)
  assert.throws(() => registry.create({ ...setup, endpoint: 'https://other.example/mcp' }, 'owner'), fails('conflict'))
  const inspected = registry.commitInspection(id, 'owner', 0, discovery, 123, ref)
  assert.equal(inspected.status, 'connected')
  assert.equal(inspected.revision, 1)
  assert.equal(inspected.execution, 'unavailable')
  assert.deepEqual(registry.create(setup, 'owner').connection, inspected)
})

test('owner/visitor/foreign projections are isolated, detached and secret-free', () => {
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  registry.commitInspection(id, 'owner', 0, discovery, 123, ref)
  for (const tenant of ['visitor', 'foreign']) {
    assert.equal(registry.view(id, tenant), undefined)
    assert.equal(registry.privateConnection(id, tenant), undefined)
    assert.deepEqual(registry.list(tenant), [])
    assert.deepEqual(registry.savedContexts(tenant), [])
    assert.throws(() => registry.disconnect(id, tenant, 1), fails('missing'))
    assert.throws(() => registry.remove(id, tenant, 1), fails('missing'))
  }
  for (const projection of [registry.view(id, 'owner'), registry.list('owner'), registry.savedContexts('owner')]) {
    const encoded = JSON.stringify(projection)
    assert.doesNotMatch(encoded, /mcp\.example|MCP_DESKTOP|tenantId|credentialReference|endpoint/)
  }
  const view = registry.view(id, 'owner')!
  view.tools[0].inputSchema.type = 'string'
  assert.equal(registry.view(id, 'owner')!.tools[0].inputSchema.type, 'object')
  const privateCopy = registry.privateConnection(id, 'owner')!
  privateCopy.endpoint = 'https://other.example'
  assert.equal(registry.privateConnection(id, 'owner')!.endpoint, setup.endpoint)
  registry.create({ ...setup, label: 'Same id, different owner' }, 'visitor')
  assert.equal(registry.view(id, 'visitor')!.status, 'unverified')
  assert.equal(registry.view(id, 'owner')!.status, 'connected')
})

test('disconnect invalidates pending discovery, revokes its binding and does not re-enable on replay', () => {
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  registry.disconnect(id, 'owner', 0)
  assert.throws(() => registry.commitInspection(id, 'owner', 0, discovery, 100, ref), fails('conflict'))
  registry.commitInspection(id, 'owner', 1, discovery, 123, ref)
  assert.deepEqual(registry.credentialBindings(), [{ reference: ref, binding: { tenantId: 'owner', connectionId: id, endpoint: setup.endpoint } }])
  const disconnected = registry.disconnect(id, 'owner', 2)
  assert.equal(disconnected.status, 'disconnected')
  assert.equal(disconnected.revision, 3)
  assert.deepEqual(registry.credentialBindings(), [])
  assert.equal(registry.privateConnection(id, 'owner')!.credentialReference, undefined)
  assert.throws(() => registry.commitInspection(id, 'owner', 2, discovery, 200, ref), fails('conflict'))
  assert.throws(() => registry.disconnect(id, 'owner', 2), fails('conflict'))
  assert.equal(registry.create(setup, 'owner').connection.status, 'disconnected')
})

test('removal survives restart, cannot resurrect, and rejects a late probe', () => {
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  assert.throws(() => registry.remove(id, 'owner', 2), fails('conflict'))
  assert.equal(registry.remove(id, 'owner', 0), true)
  const restarted = createMcpConnectionRegistry()
  restarted.rehydrate(registry.snapshot())
  assert.equal(restarted.remove(id, 'owner', 0), false)
  assert.equal(restarted.view(id, 'owner'), undefined)
  assert.throws(() => restarted.commitInspection(id, 'owner', 0, discovery, 100, ref), fails('missing'))
  assert.throws(() => restarted.create(setup, 'owner'), fails('retired'))
  assert.throws(() => restarted.remove(id, 'foreign', 0), fails('missing'))
})

test('inspection commits one bounded catalog and rejects malformed credentials or metadata atomically', () => {
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  const before = registry.snapshot()
  for (const credential of [undefined, 'raw-token', `PROVIDER_DESKTOP_${'A'.repeat(32)}`]) {
    assert.throws(() => registry.commitInspection(id, 'owner', 0, discovery, 123, credential), fails('invalid'))
  }
  for (const catalog of [
    { ...discovery, protocolVersion: '2099-01-01' },
    { ...discovery, tools: [discovery.tools[0], discovery.tools[0]] },
    { ...discovery, tools: [{ name: 'lookup', inputSchema: { type: 'string' } }] },
    { ...discovery, tools: Array.from({ length: 129 }, (_, i) => ({ ...discovery.tools[0], name: `tool${i}` })) },
  ]) assert.throws(() => registry.commitInspection(id, 'owner', 0, catalog, 123, ref))
  assert.deepEqual(registry.snapshot(), before)
  registry.commitInspection(id, 'owner', 0, discovery, 123, ref)
  const fresh = createMcpConnectionRegistry()
  fresh.rehydrate(registry.snapshot())
  assert.deepEqual(fresh.snapshot(), registry.snapshot())
  const anonymous = createMcpConnectionRegistry()
  anonymous.create({ ...setup, authentication: 'none' }, 'owner')
  assert.throws(() => anonymous.commitInspection(id, 'owner', 0, discovery, 123, ref), fails('invalid'))
  assert.equal(anonymous.commitInspection(id, 'owner', 0, discovery, 123).status, 'connected')
})

test('credential references are globally unique and duplicate inspection leaves the prior row untouched', () => {
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  const foreignId = mcpConnectionCreationId('visitor', 'same-reference')
  registry.create({ ...setup, id: foreignId, label: 'Visitor server' }, 'visitor')
  registry.commitInspection(id, 'owner', 0, discovery, 123, ref)
  const before = registry.snapshot()
  assert.throws(
    () => parseMcpConnectionState({
      ...before,
      connections: [...before.connections, { ...before.connections[0], tenantId: 'visitor', id: foreignId }],
    }),
    fails('invalid'),
  )
  assert.throws(
    () => registry.commitInspection(foreignId, 'visitor', 0, { ...discovery, tools: [{ name: 'different', inputSchema: { type: 'object' } }] }, 456, ref),
    fails('conflict'),
  )
  assert.deepEqual(registry.snapshot(), before)
})

test('only absent old storage initializes empty; present invalid state is never partially installed', () => {
  assert.deepEqual(parseMcpConnectionState(undefined), { connections: [], retired: [] })
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  registry.commitInspection(id, 'owner', 0, discovery, 123, ref)
  const valid = registry.snapshot()
  for (const invalid of [null, {}, [], { ...valid, extra: 'token' },
    { ...valid, connections: [...valid.connections, valid.connections[0]] },
    { ...valid, retired: [{ tenantId: 'owner', id }] },
    ...[
      { tenantId: '' }, { endpoint: 'https://user:token@mcp.example/' }, { secret: 'raw token' },
      { revision: -1 }, { connected: false }, { credentialReference: 'raw' }, { inspection: null },
      { authentication: 'none' }, { id: 'fixture-server' },
    ].map(patch => ({ ...valid, connections: [{ ...valid.connections[0], ...patch }] })),
  ]) {
    assert.throws(() => registry.rehydrate(invalid))
    assert.deepEqual(registry.snapshot(), valid)
  }
  registry.rehydrate(undefined)
  assert.deepEqual(registry.list('owner'), [])
})

test('snapshot admission rejects boxed and array enum values without coercion', () => {
  const registry = createMcpConnectionRegistry()
  registry.create(setup, 'owner')
  registry.commitInspection(id, 'owner', 0, discovery, 123, ref)
  const valid = registry.snapshot()
  const invalidEntries = [
    { authentication: ['device-bearer'] },
    { authentication: new String('device-bearer') },
    { inspection: { ...valid.connections[0]!.inspection!, cleanup: ['released'] } },
    { inspection: { ...valid.connections[0]!.inspection!, cleanup: new String('released') } },
  ]
  for (const patch of invalidEntries) {
    assert.throws(() => registry.rehydrate({
      ...valid,
      connections: [{ ...valid.connections[0]!, ...patch }],
    }), fails('invalid'))
    assert.deepEqual(registry.snapshot(), valid)
  }
})

test('runtime creation rejects non-string ids before regex admission', () => {
  const registry = createMcpConnectionRegistry()
  assert.throws(() => registry.create({ ...setup, id: [id] } as never, 'owner'), fails('invalid'))
  assert.deepEqual(registry.snapshot(), { connections: [], retired: [] })
})

test('connection capacity is per tenant and rejected creation does not evict saved state', () => {
  const registry = createMcpConnectionRegistry()
  for (let i = 0; i < MAX_MCP_CONNECTIONS_PER_TENANT; i++) {
    registry.create({ ...setup, id: mcpConnectionCreationId('owner', String(i)) }, 'owner')
  }
  assert.throws(() => registry.create(setup, 'owner'), fails('capacity'))
  assert.equal(registry.list('owner').length, MAX_MCP_CONNECTIONS_PER_TENANT)
  assert.equal(registry.create(setup, 'foreign').created, true)
})
