import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpConnectionRegistry, McpConnectionError } from './mcpConnections.ts'
import { createMcpConnectionService } from './mcpConnectionService.ts'
import { McpInspectionError } from './mcpConnectionInspector.ts'
import { MCP_MODERN_VERSION, type McpDiscovery } from './mcpDiscovery.ts'

const tenant = 'oauth-service-tenant'
const owner = 'oauth-service-owner'
const other = 'oauth-service-other'
const endpoint = 'https://mcp.example.test/tools'
const reference = `MCP_DESKTOP_${'B'.repeat(32)}`
const catalog: McpDiscovery = {
  protocolVersion: MCP_MODERN_VERSION,
  cleanup: 'not-needed',
  tools: [{ name: 'search', inputSchema: { type: 'object' } }],
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setup({ available = true, resolveOAuthCredential, synchronize, discover, registry: providedRegistry } : {
  available?: boolean
  resolveOAuthCredential?: (reference: string, binding: any, options: any) => Promise<string>
  synchronize?: (bindings: unknown[]) => Promise<'complete' | 'pending'>
  discover?: (endpoint: string, options: any) => Promise<McpDiscovery>
  registry?: ReturnType<typeof createMcpConnectionRegistry>
} = {}) {
  const registry = providedRegistry ?? createMcpConnectionRegistry()
  let ownerVisible = true
  const store = {
    createMcpConnection: registry.create,
    privateMcpConnection: (id: string, tenantId: string, actorUserId?: string) =>
      actorUserId === owner && !ownerVisible ? undefined : registry.privateConnection(id, tenantId, actorUserId),
    mcpConnection: (id: string, tenantId: string, actorUserId?: string) =>
      actorUserId === owner && !ownerVisible ? undefined : registry.view(id, tenantId, actorUserId),
    commitMcpInspection: registry.commitInspection,
    disconnectMcpConnection: registry.disconnect,
    removeMcpConnection: registry.remove,
    mcpCredentialBindings: registry.credentialBindings,
  }
  const service = createMcpConnectionService({
    store,
    configuration: () => ({
      deviceBearerAvailable: false,
      deviceOAuthAvailable: available,
      allowLoopback: false,
      ...(resolveOAuthCredential ? { resolveOAuthCredential } : {}),
    }),
    synchronize: synchronize ?? (async () => 'complete'),
    discover: discover ?? (async () => catalog),
  })
  return { registry, service, setOwnerVisible(value: boolean) { ownerVisible = value } }
}

const request = (creationId = 'primary') => ({ creationId, label: 'Private search', endpoint, authentication: 'device-oauth' as const })
const inspect = (operationId = 'inspect-owner', expectedRevision = 0) => ({ operationId, expectedRevision, credentialReference: reference })
const missing = (error: unknown) => error instanceof McpConnectionError && error.code === 'missing'
const unavailable = (error: unknown) => error instanceof McpInspectionError && error.code === 'credentials_unavailable'

test('OAuth creation retries retain one owner-scoped identity and remain invisible to another actor', () => {
  const { registry, service } = setup()
  const first = service.create(request(), tenant, owner)
  const retry = service.create(request(), tenant, owner)
  assert.equal(first.created, true)
  assert.equal(retry.created, false)
  assert.equal(retry.connection.id, first.connection.id)
  assert.equal(registry.view(first.connection.id, tenant, owner)?.id, first.connection.id)
  assert.equal(registry.view(first.connection.id, tenant, other), undefined)

  const otherActor = service.create(request(), tenant, other)
  assert.notEqual(otherActor.connection.id, first.connection.id)
  assert.equal(registry.privateConnection(otherActor.connection.id, tenant, other)?.ownerUserId, other)
})

test('another actor cannot join an owner inspection while credential resolution is pending', async () => {
  const resolving = deferred<string>()
  const started = deferred<void>()
  const { registry, service } = setup({
    resolveOAuthCredential: async () => { started.resolve(); return resolving.promise },
  })
  const created = service.create(request(), tenant, owner).connection
  const ownerPromise = service.inspect(created.id, tenant, inspect(), owner)
  await started.promise
  await assert.rejects(service.inspect(created.id, tenant, inspect(), other), missing)
  resolving.resolve('native-access-token')
  const result = await ownerPromise
  assert.equal(result.connection.status, 'connected')
  assert.equal(registry.privateConnection(created.id, tenant, owner)?.credentialReference, reference)
})

test('successful owner inspection commits the fresh credential reference under the same actor', async () => {
  let received: unknown
  const { registry, service } = setup({
    resolveOAuthCredential: async (resolvedReference, binding, options) => {
      received = { resolvedReference, binding, isCurrent: options.isCurrent() }
      return 'native-access-token'
    },
  })
  const created = service.create(request(), tenant, owner).connection
  const result = await service.inspect(created.id, tenant, inspect('fresh-reference'), owner)
  assert.deepEqual(received, {
    resolvedReference: reference,
    binding: { tenantId: tenant, connectionId: created.id, endpoint, ownerUserId: owner, connectionRevision: 0 },
    isCurrent: true,
  })
  assert.equal(result.connection.status, 'connected')
  assert.equal(result.connection.revision, 1)
  assert.equal(registry.privateConnection(created.id, tenant, owner)?.credentialReference, reference)
  assert.equal(registry.privateConnection(created.id, tenant, other), undefined)
})

test('owner access lost during credential resolution prevents discovery and commit', async () => {
  const resolving = deferred<string>()
  const started = deferred<void>()
  let discoveryCalls = 0
  const { registry, service, setOwnerVisible } = setup({
    resolveOAuthCredential: async () => { started.resolve(); return resolving.promise },
    discover: async () => { discoveryCalls++; return catalog },
  })
  const created = service.create(request(), tenant, owner).connection
  const pending = service.inspect(created.id, tenant, inspect('owner-lost-during-resolution'), owner)
  await started.promise
  setOwnerVisible(false)
  resolving.resolve('late-access-token')
  await assert.rejects(pending, missing)
  assert.equal(discoveryCalls, 0)
  assert.equal(registry.privateConnection(created.id, tenant, owner)?.connected, false)
})

test('owner access lost during synchronization cannot receive a stale acknowledgement', async () => {
  const synchronizing = deferred<'complete' | 'pending'>()
  const started = deferred<void>()
  const { registry, service, setOwnerVisible } = setup({
    resolveOAuthCredential: async () => 'native-access-token',
    synchronize: async () => { started.resolve(); return synchronizing.promise },
  })
  const created = service.create(request(), tenant, owner).connection
  const pending = service.inspect(created.id, tenant, inspect('owner-lost-during-ack'), owner)
  await started.promise
  assert.equal(registry.privateConnection(created.id, tenant, owner)?.connected, true)
  setOwnerVisible(false)
  synchronizing.resolve('complete')
  await assert.rejects(pending, missing)
  assert.equal(registry.privateConnection(created.id, tenant, other), undefined)
})

test('unavailable OAuth runtime refuses creation and inspection before credential resolution', async () => {
  let resolverCalls = 0
  const { service, registry } = setup({ available: false,
    resolveOAuthCredential: async () => { resolverCalls++; return 'must-not-resolve' },
  })
  assert.throws(() => service.create(request(), tenant, owner), unavailable)
  assert.deepEqual(registry.snapshot(), { connections: [], retired: [] })

  const availableSetup = setup()
  const created = availableSetup.service.create(request(), tenant, owner).connection
  const unavailableService = setup({ available: false, registry: availableSetup.registry,
    resolveOAuthCredential: async () => { resolverCalls++; return 'must-not-resolve' },
  }).service
  await assert.rejects(unavailableService.inspect(created.id, tenant, inspect(), owner), unavailable)
  assert.equal(resolverCalls, 0)
  assert.equal(availableSetup.registry.privateConnection(created.id, tenant, owner)?.connected, false)
})
