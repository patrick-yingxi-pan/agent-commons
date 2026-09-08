import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpConnectionRegistry,
  McpConnectionError,
} from './mcpConnections.ts'
import { createMcpConnectionService } from './mcpConnectionService.ts'
import { McpInspectionError } from './mcpConnectionInspector.ts'
import { MCP_MODERN_VERSION, type McpDiscovery } from './mcpDiscovery.ts'

const tenant = 'service-owner'
const endpoint = 'https://mcp.example.test/tools'
const credentialReference = `MCP_DESKTOP_${'A'.repeat(32)}`
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

function makeStore(registry: ReturnType<typeof createMcpConnectionRegistry>) {
  return {
    createMcpConnection: registry.create,
    privateMcpConnection: registry.privateConnection,
    mcpConnection: registry.view,
    commitMcpInspection: registry.commitInspection,
    disconnectMcpConnection: registry.disconnect,
    removeMcpConnection: registry.remove,
    mcpCredentialBindings: registry.credentialBindings,
  }
}

function makeService(
  registry: ReturnType<typeof createMcpConnectionRegistry>,
  options: {
    secure?: boolean
    discover?: (endpoint: string, options: { scope: 'public' | 'loopback'; bearerToken?: string; signal: AbortSignal; timeoutMs: number }) => Promise<McpDiscovery>
    synchronize?: () => Promise<'complete' | 'pending'>
  } = {},
) {
  const secure = options.secure ?? false
  const configuration = () => secure ? {
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'outbound-secret',
  } : { deviceBearerAvailable: false, allowLoopback: false }
  return createMcpConnectionService({
    store: makeStore(registry),
    configuration,
    synchronize: options.synchronize ?? (async () => 'complete'),
    discover: options.discover ?? (async () => catalog),
  })
}

function createRequest(authentication: 'none' | 'device-bearer' = 'none') {
  return { creationId: 'primary', label: 'Search', endpoint, authentication }
}

function inspectionRequest(operationId = 'operation-1', expectedRevision = 0, ref?: string) {
  return { operationId, expectedRevision, ...(ref === undefined ? {} : { credentialReference: ref }) }
}

function isConnection(code: McpConnectionError['code']) {
  return (error: unknown) => error instanceof McpConnectionError && error.code === code
}

function isInspection(code: McpInspectionError['code']) {
  return (error: unknown) => error instanceof McpInspectionError && error.code === code
}

test('refresh uses the current private binding without requiring another token, and disconnect retires it', async () => {
  const registry = createMcpConnectionRegistry()
  const service = makeService(registry, { secure: true })
  const created = service.create(createRequest('device-bearer'), tenant).connection
  await service.inspect(created.id, tenant, inspectionRequest('initial', 0, credentialReference))
  const refreshed = await service.inspect(created.id, tenant, inspectionRequest('refresh', 1))
  assert.equal(refreshed.connection.revision, 2)
  assert.equal(registry.privateConnection(created.id, tenant)?.credentialReference, credentialReference)
  await service.disconnect(created.id, tenant, 2)
  await assert.rejects(service.inspect(created.id, tenant, inspectionRequest('reconnect', 3)), isConnection('invalid'))
})

test('an existing bearer setup remains acknowledgeable when secure storage later becomes unavailable', () => {
  const registry = createMcpConnectionRegistry()
  const secure = makeService(registry, { secure: true })
  const request = createRequest('device-bearer')
  const original = secure.create(request, tenant)
  const unavailable = makeService(registry)
  assert.deepEqual(unavailable.create(request, tenant), { connection: original.connection, created: false })
  assert.throws(() => unavailable.create({ ...request, creationId: 'different' }, tenant), isInspection('credentials_unavailable'))
})

test('coalesces exact inspections and rejects changed operation input before extra I/O', async () => {
  const registry = createMcpConnectionRegistry()
  const service = makeService(registry)
  const created = service.create(createRequest(), tenant).connection
  const started = deferred<void>()
  const held = deferred<McpDiscovery>()
  let discoveryCalls = 0
  const running = makeService(registry, {
    discover: async () => { discoveryCalls += 1; started.resolve(); return held.promise },
  })
  const request = inspectionRequest()
  const first = running.inspect(created.id, tenant, request)
  const second = running.inspect(created.id, tenant, request)
  assert.strictEqual(second, first)
  await started.promise
  await assert.rejects(
    running.inspect(created.id, tenant, inspectionRequest('operation-2')),
    isConnection('conflict'),
  )
  await assert.rejects(
    running.inspect(created.id, tenant, inspectionRequest('operation-1', 0, credentialReference)),
    isConnection('conflict'),
  )
  assert.equal(discoveryCalls, 1)
  held.resolve(catalog)
  const result = await first
  assert.equal(result.connection.status, 'connected')
  assert.equal(result.connection.inspectionOperationId, 'operation-1')
  assert.equal(result.credentialCleanup, 'complete')
})

test('replays a durable receipt after rehydrate without probing, including after disconnect', async () => {
  const registry = createMcpConnectionRegistry()
  let discoveryCalls = 0
  const service = makeService(registry, { discover: async () => { discoveryCalls += 1; return catalog } })
  const created = service.create(createRequest(), tenant).connection
  const request = inspectionRequest()
  await service.inspect(created.id, tenant, request)
  assert.equal(discoveryCalls, 1)
  const snapshot = registry.snapshot()

  const restarted = createMcpConnectionRegistry()
  restarted.rehydrate(snapshot)
  const replay = makeService(restarted, { discover: async () => { discoveryCalls += 1; return catalog } })
  const acknowledged = await replay.inspect(created.id, tenant, request)
  assert.equal(discoveryCalls, 1)
  assert.equal(acknowledged.connection.status, 'connected')
  assert.equal(acknowledged.connection.revision, 1)

  await replay.disconnect(created.id, tenant, 1)
  const disconnectedSnapshot = restarted.snapshot()
  const afterDisconnect = createMcpConnectionRegistry()
  afterDisconnect.rehydrate(disconnectedSnapshot)
  const replayAfterDisconnect = makeService(afterDisconnect, {
    discover: async () => { discoveryCalls += 1; return catalog },
  })
  const disconnected = await replayAfterDisconnect.inspect(created.id, tenant, request)
  assert.equal(discoveryCalls, 1)
  assert.equal(disconnected.connection.status, 'disconnected')
  assert.equal(disconnected.connection.revision, 2)
  assert.equal(disconnected.connection.inspectionOperationId, 'operation-1')
})

test('rejects unavailable device credentials before create or discovery I/O', async () => {
  const registry = createMcpConnectionRegistry()
  const unavailable = makeService(registry)
  assert.throws(
    () => unavailable.create(createRequest('device-bearer'), tenant),
    isInspection('credentials_unavailable'),
  )
  assert.deepEqual(registry.snapshot(), { connections: [], retired: [] })

  const secure = makeService(registry, { secure: true })
  const created = secure.create(createRequest('device-bearer'), tenant).connection
  let discoveryCalls = 0
  const inspectUnavailable = makeService(registry, {
    discover: async () => { discoveryCalls += 1; return catalog },
  })
  await assert.rejects(
    inspectUnavailable.inspect(created.id, tenant, inspectionRequest('secure-op', 0, credentialReference)),
    isInspection('credentials_unavailable'),
  )
  assert.equal(discoveryCalls, 0)
  assert.equal(registry.view(created.id, tenant)!.status, 'unverified')
})

test('late disconnect and remove fence a held probe from committing', async () => {
  const registry = createMcpConnectionRegistry()
  const setup = makeService(registry)
  const first = setup.create({ ...createRequest(), creationId: 'disconnect' }, tenant).connection
  const second = setup.create({ ...createRequest(), creationId: 'remove' }, tenant).connection

  const heldDisconnect = deferred<McpDiscovery>()
  const startedDisconnect = deferred<void>()
  const disconnectService = makeService(registry, {
    discover: async () => { startedDisconnect.resolve(); return heldDisconnect.promise },
  })
  const disconnecting = disconnectService.inspect(first.id, tenant, inspectionRequest('disconnect-op'))
  await startedDisconnect.promise
  const disconnected = await disconnectService.disconnect(first.id, tenant, 0)
  assert.equal(disconnected.connection.status, 'unverified')
  heldDisconnect.resolve(catalog)
  await assert.rejects(disconnecting, isConnection('conflict'))
  assert.equal(registry.view(first.id, tenant)!.revision, 1)

  const heldRemove = deferred<McpDiscovery>()
  const startedRemove = deferred<void>()
  const removeService = makeService(registry, {
    discover: async () => { startedRemove.resolve(); return heldRemove.promise },
  })
  const removing = removeService.inspect(second.id, tenant, inspectionRequest('remove-op'))
  await startedRemove.promise
  const removed = await removeService.remove(second.id, tenant, 0)
  assert.equal(removed.removed, true)
  heldRemove.resolve(catalog)
  await assert.rejects(removing, isConnection('missing'))
  assert.equal(registry.view(second.id, tenant), undefined)
})

test('reports pending credential cleanup without hiding a committed connection', async () => {
  const registry = createMcpConnectionRegistry()
  const service = makeService(registry, { synchronize: async () => 'pending' })
  const created = service.create(createRequest(), tenant).connection
  const result = await service.inspect(created.id, tenant, inspectionRequest())
  assert.equal(result.credentialCleanup, 'pending')
  assert.equal(result.connection.status, 'connected')
  assert.equal(registry.view(created.id, tenant)!.status, 'connected')
  const removed = await service.remove(created.id, tenant, 1)
  assert.equal(removed.removed, true)
  assert.equal(removed.credentialCleanup, 'pending')
})

test('keeps stale operations fenced and makes disconnect/remove retries convergent', async () => {
  const registry = createMcpConnectionRegistry()
  const service = makeService(registry)
  const created = service.create(createRequest(), tenant).connection
  let discoveryCalls = 0
  const probing = makeService(registry, { discover: async () => { discoveryCalls += 1; return catalog } })
  await assert.rejects(
    probing.inspect(created.id, tenant, inspectionRequest('stale-op', 1)),
    isConnection('conflict'),
  )
  assert.equal(discoveryCalls, 0)

  const firstDisconnect = await service.disconnect(created.id, tenant, 0)
  const retryDisconnect = await service.disconnect(created.id, tenant, 0)
  assert.equal(firstDisconnect.connection.revision, 1)
  assert.equal(retryDisconnect.connection.revision, 1)
  assert.equal(retryDisconnect.connection.status, 'unverified')

  const firstRemove = await service.remove(created.id, tenant, 1)
  const retryRemove = await service.remove(created.id, tenant, 1)
  assert.equal(firstRemove.removed, true)
  assert.equal(retryRemove.removed, false)
  assert.throws(() => service.create(createRequest(), tenant), isConnection('retired'))
})

test('returns only safe public metadata while using the private bearer during discovery', async () => {
  const registry = createMcpConnectionRegistry()
  let bearerSeen: string | undefined
  const service = makeService(registry, {
    secure: true,
    discover: async (_url, options) => { bearerSeen = options.bearerToken; return catalog },
  })
  const created = service.create(createRequest('device-bearer'), tenant).connection
  const result = await service.inspect(created.id, tenant, inspectionRequest('secure-op', 0, credentialReference))
  assert.equal(bearerSeen, 'outbound-secret')
  assert.equal(result.connection.status, 'connected')
  assert.equal(result.connection.inspectionOperationId, 'secure-op')
  assert.doesNotMatch(JSON.stringify(result.connection), /mcp\.example|MCP_DESKTOP|outbound-secret|service-owner/)
})

test('replays only the exact operation fingerprint', async () => {
  const registry = createMcpConnectionRegistry()
  let discoveryCalls = 0
  const service = makeService(registry, { discover: async () => { discoveryCalls += 1; return catalog } })
  const created = service.create(createRequest(), tenant).connection
  await service.inspect(created.id, tenant, inspectionRequest('operation-1', 0))
  assert.equal(discoveryCalls, 1)
  await assert.rejects(
    service.inspect(created.id, tenant, inspectionRequest('operation-1', 1)),
    isConnection('conflict'),
  )
  assert.equal(discoveryCalls, 1)
})
