import { createHash } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpConnectionRegistry, mcpConnectionCreationId, McpConnectionError, parseMcpConnectionState,
} from './mcpConnections.ts'
import { MCP_MODERN_VERSION } from './mcpDiscovery.ts'

const tenant = 'tenant-shared'
const alice = 'alice@example.test'
const bob = 'bob@example.test'
const endpoint = 'https://mcp.example.test/tools'
const ref = `MCP_DESKTOP_${'B'.repeat(32)}`
const discovery = { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed' as const,
  tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] }
const id = (key: string, owner: string) => mcpConnectionCreationId(tenant, key, owner)
const setup = (key: string, owner: string, overrides: Record<string, unknown> = {}) => ({
  id: id(key, owner), label: 'Private endpoint', endpoint, authentication: 'device-oauth' as const, ...overrides,
})
const fails = (code: McpConnectionError['code']) => (error: unknown) => error instanceof McpConnectionError && error.code === code

test('OAuth creation identity is owner-domain-separated while legacy identity bytes remain unchanged', () => {
  const legacy = mcpConnectionCreationId('owner', 'logical-key')
  const original = createHash('sha256').update(JSON.stringify(['owner', 'logical-key'])).digest('hex').slice(0, 32)
  assert.equal(legacy, `mcp-connection-${original}`)
  assert.equal(mcpConnectionCreationId(tenant, 'shared-key', alice), id('shared-key', alice))
  assert.notEqual(id('shared-key', alice), id('shared-key', bob))
  assert.notEqual(id('shared-key', alice), mcpConnectionCreationId(tenant, 'shared-key'))
  for (const owner of ['', '  ', '\u00e9', 'owner\n', 'x'.repeat(201)]) {
    assert.throws(() => mcpConnectionCreationId(tenant, 'shared-key', owner), fails('invalid'))
  }
})

test('OAuth rows are private to the trusted owner across reads and mutations, without changing legacy visibility', () => {
  const registry = createMcpConnectionRegistry()
  const aliceSetup = setup('same-logical-key', alice, { ownerUserId: 'caller-cannot-choose-this' })
  const bobSetup = setup('same-logical-key', bob)
  const createdAlice = registry.create(aliceSetup, tenant, true, alice)
  const createdBob = registry.create(bobSetup, tenant, true, bob)
  assert.equal(createdAlice.created, true)
  assert.equal(createdBob.created, true)
  assert.notEqual(createdAlice.connection.id, createdBob.connection.id)
  assert.equal(registry.privateConnection(createdAlice.connection.id, tenant, alice)!.ownerUserId, alice,
    'the owner is server-stamped, never copied from caller setup')

  assert.equal(registry.privateConnection(createdAlice.connection.id, tenant), undefined)
  assert.equal(registry.privateConnection(createdAlice.connection.id, tenant, bob), undefined)
  assert.equal(registry.view(createdAlice.connection.id, tenant), undefined)
  assert.equal(registry.view(createdAlice.connection.id, tenant, bob), undefined)
  assert.deepEqual(registry.list(tenant), [])
  assert.deepEqual(registry.list(tenant, bob).map(row => row.id), [createdBob.connection.id])
  assert.deepEqual(registry.savedContexts(tenant), [])
  assert.deepEqual(registry.savedContexts(tenant, bob).map(row => row.id), [createdBob.connection.id])
  assert.equal(registry.view(createdAlice.connection.id, tenant, alice)!.id, createdAlice.connection.id)

  const before = registry.snapshot()
  assert.throws(() => registry.create({ ...aliceSetup, label: 'Different' }, tenant, false, bob), fails('missing'),
    'replay cannot disclose another owner’s current row as a conflict')
  assert.deepEqual(registry.snapshot(), before)

  const legacyId = mcpConnectionCreationId(tenant, 'legacy')
  registry.create({ id: legacyId, label: 'Legacy', endpoint, authentication: 'none' }, tenant)
  assert.equal(registry.view(legacyId, tenant)!.id, legacyId)
  assert.equal(registry.view(legacyId, tenant, bob)!.id, legacyId)
  assert.equal(registry.privateConnection(legacyId, tenant)!.ownerUserId, undefined)
})

test('OAuth admission requires a trusted valid owner and public HTTPS even when loopback is otherwise enabled', () => {
  const registry = createMcpConnectionRegistry()
  const valid = setup('valid', alice)
  assert.throws(() => registry.create(valid, tenant), fails('invalid'))
  for (const owner of ['', ' ', 'x'.repeat(201), 'n\u00e9', 'line\nbreak']) {
    assert.throws(() => registry.create(valid, tenant, false, owner), fails('invalid'))
  }
  assert.throws(() => registry.create(setup('loopback', alice, { endpoint: 'http://127.0.0.1:8000/mcp' }), tenant, true, alice), fails('invalid'))
  assert.throws(() => registry.create(setup('private-ip', alice, { endpoint: 'https://10.0.0.1/mcp' }), tenant, true, alice), fails('invalid'))
  assert.deepEqual(registry.snapshot(), { connections: [], retired: [] })
})

test('inspection, disconnect, and removal require matching OAuth actor and retired replay keeps its owner private', () => {
  const registry = createMcpConnectionRegistry()
  const created = registry.create(setup('lifecycle', alice), tenant, false, alice).connection
  assert.throws(() => registry.commitInspection(created.id, tenant, 0, discovery, 123, ref), fails('missing'))
  assert.throws(() => registry.commitInspection(created.id, tenant, 0, discovery, 123, ref, undefined, bob), fails('missing'))
  const inspected = registry.commitInspection(created.id, tenant, 0, discovery, 123, ref, undefined, alice)
  assert.equal(inspected.status, 'connected')
  assert.deepEqual(registry.credentialBindings(), [{ reference: ref,
    binding: { tenantId: tenant, connectionId: created.id, endpoint } }])

  assert.throws(() => registry.disconnect(created.id, tenant, 1), fails('missing'))
  assert.throws(() => registry.disconnect(created.id, tenant, 1, bob), fails('missing'))
  const disconnected = registry.disconnect(created.id, tenant, 1, alice)
  assert.equal(disconnected.status, 'disconnected')
  assert.deepEqual(registry.credentialBindings(), [])

  assert.throws(() => registry.remove(created.id, tenant, 2), fails('missing'))
  assert.throws(() => registry.remove(created.id, tenant, 2, bob), fails('missing'))
  assert.equal(registry.remove(created.id, tenant, 2, alice), true)
  const saved = registry.snapshot()
  assert.deepEqual(saved.retired, [{ tenantId: tenant, id: created.id, ownerUserId: alice }])
  assert.equal(JSON.stringify(registry.list(tenant, alice)).includes(alice), false)

  const restarted = createMcpConnectionRegistry()
  restarted.rehydrate(saved)
  assert.throws(() => restarted.remove(created.id, tenant, 0), fails('missing'))
  assert.throws(() => restarted.remove(created.id, tenant, 0, bob), fails('missing'))
  assert.equal(restarted.remove(created.id, tenant, 0, alice), false)
  assert.throws(() => restarted.create(setup('lifecycle', alice), tenant, false, bob), fails('missing'))
  assert.throws(() => restarted.create(setup('lifecycle', alice), tenant, false, alice), fails('retired'))
})

test('snapshot roundtrip retains private OAuth owner and rejects absent, malformed, or legacy owner fields atomically', () => {
  const registry = createMcpConnectionRegistry()
  const oauth = registry.create(setup('snapshot', alice), tenant, false, alice).connection
  const legacyId = mcpConnectionCreationId(tenant, 'legacy-snapshot')
  registry.create({ id: legacyId, label: 'Legacy', endpoint, authentication: 'none' }, tenant)
  const saved = registry.snapshot()
  assert.equal(saved.connections.find(row => row.id === oauth.id)!.ownerUserId, alice)
  assert.equal(Object.hasOwn(saved.connections.find(row => row.id === legacyId)!, 'ownerUserId'), false)

  const restarted = createMcpConnectionRegistry()
  restarted.rehydrate(saved)
  assert.deepEqual(restarted.snapshot(), saved)
  for (const patch of [
    { ownerUserId: undefined }, { ownerUserId: '' }, { ownerUserId: 'n\u00e9' }, { ownerUserId: 'x'.repeat(201) },
  ]) {
    const invalid = structuredClone(saved)
    Object.assign(invalid.connections.find(row => row.id === oauth.id)!, patch)
    assert.throws(() => restarted.rehydrate(invalid), fails('invalid'))
    assert.deepEqual(restarted.snapshot(), saved)
  }
  const legacyWithOwner = structuredClone(saved)
  Object.assign(legacyWithOwner.connections.find(row => row.id === legacyId)!, { ownerUserId: alice })
  assert.throws(() => restarted.rehydrate(legacyWithOwner), fails('invalid'))
  assert.deepEqual(restarted.snapshot(), saved)

  const missingOwner = structuredClone(saved)
  delete (missingOwner.connections.find(row => row.id === oauth.id)! as Record<string, unknown>).ownerUserId
  assert.throws(() => parseMcpConnectionState(missingOwner), fails('invalid'))
  const malformedRetired = { ...saved, retired: [{ tenantId: tenant, id: oauth.id, ownerUserId: 'n\u00e9' }] }
  assert.throws(() => parseMcpConnectionState(malformedRetired), fails('invalid'))
})
