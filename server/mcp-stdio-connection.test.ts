import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { McpStdioConnection } from './mcpStdioClient.ts'
import { parseMcpConnectionCreate, parseMcpConnectionInspection } from './routes/mcpConnectionInput.ts'
import { createMcpConnectionRegistry, McpConnectionError, mcpConnectionCreationId, mcpStdioConnectionCreationId,
  MAX_MCP_STDIO_CONNECTIONS, parseMcpConnectionState } from './mcpConnections.ts'
import { createMcpConnectionService } from './mcpConnectionService.ts'
import { McpInspectionError } from './mcpConnectionInspector.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { createBoundMcpExecutor } from './mcpBoundExecution.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'

const tenantId = 'tenant-stdio'
const ownerUserId = 'person-stdio'
const grantReference = `MCP_STDIO_${'A'.repeat(32)}`
const operation = 'stdio-inspection-1'
const tools = [{ name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } }]

function nativeConnection(): McpStdioConnection {
  return {
    request: async (method, params, { beforeDispatch }) => {
      if (method === 'tools/call' && beforeDispatch?.() !== true) throw Object.assign(new Error('refused'), { code: 'cancelled', mayHaveSubmitted: false })
      return { jsonrpc: '2.0', id: method, result: method === 'server/discover'
        ? { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'fixture', version: '1' } } }
        : method === 'tools/list' ? { resultType: 'complete', tools }
          : { resultType: 'complete', content: [{ type: 'text', text: `found ${String((params.arguments as { q?: string })?.q ?? '')}` }], isError: false } }
    },
    initialized: async () => undefined,
    close: async () => ({ code: 'released' }),
    closed: Promise.resolve({ code: 'released' }),
  }
}

function harness(options: { available?: boolean; syncAvailable?: boolean; oauthAvailable?: boolean } = {}) {
  const registry = createMcpConnectionRegistry()
  const bindingsSeen: unknown[][] = []
  let opens = 0
  const store = {
    createMcpConnection: registry.create,
    privateMcpConnection: registry.privateConnection,
    mcpConnection: registry.view,
    commitMcpInspection: registry.commitInspection,
    disconnectMcpConnection: registry.disconnect,
    removeMcpConnection: registry.remove,
    mcpCredentialBindings: registry.credentialBindings,
    mcpStdioBindings: registry.stdioBindings,
  }
  const service = createMcpConnectionService({
    store: store as never,
    configuration: () => ({
      deviceBearerAvailable: false, allowLoopback: false,
      deviceOAuthAvailable: options.oauthAvailable ?? false,
      ...(options.oauthAvailable ? { resolveOAuthCredential: async () => 'unused' } : {}),
      localProcessesAvailable: options.available ?? true,
      openStdio: (_reference, _binding, _options) => { opens += 1; return nativeConnection() },
    }),
    synchronize: async (http: unknown, stdio: unknown) => {
      bindingsSeen.push([http, stdio])
      return options.syncAvailable === false ? 'pending' : 'complete'
    },
  })
  return { registry, store, service, bindingsSeen, opens: () => opens }
}

test('stdio create and inspection use a distinct person namespace and persist only opaque grant authority', async () => {
  const h = harness()
  const httpId = mcpConnectionCreationId(tenantId, 'same-key', ownerUserId)
  const stdioId = mcpStdioConnectionCreationId(tenantId, 'same-key', ownerUserId)
  assert.notEqual(stdioId, httpId)
  assert.notEqual(stdioId, mcpConnectionCreationId(tenantId, 'same-key'))

  const created = await h.service.create({ transport: 'stdio', creationId: 'same-key', label: 'Local search' }, tenantId, ownerUserId)
  assert.equal(created.created, true)
  assert.equal(created.connection.transport, 'stdio')
  assert.equal('endpoint' in created.connection, false)
  assert.equal('authentication' in created.connection, false)
  assert.deepEqual(h.bindingsSeen[0]?.[1], [{ reference: null,
    binding: { tenantId, ownerUserId, connectionId: stdioId, connectionRevision: 0 } }])

  const inspected = await h.service.inspect(stdioId, tenantId,
    { operationId: operation, expectedRevision: 0, grantReference }, ownerUserId)
  assert.equal(inspected.connection.status, 'connected')
  assert.equal(inspected.connection.revision, 1)
  assert.equal(h.opens(), 1)
  const privateRow = h.registry.privateConnection(stdioId, tenantId, ownerUserId)!
  assert.equal(privateRow.transport, 'stdio')
  assert.equal(privateRow.ownerUserId, ownerUserId)
  assert.equal(privateRow.grantReference, grantReference)
  assert.equal('endpoint' in privateRow, false)
  assert.equal('authentication' in privateRow, false)
  assert.deepEqual(h.bindingsSeen[1]?.[1], [{ reference: grantReference,
    binding: { tenantId, ownerUserId, connectionId: stdioId, connectionRevision: 1 } }])
  const snapshot = h.registry.snapshot()
  assert.deepEqual(parseMcpConnectionState(snapshot), snapshot)
  assert.equal(JSON.stringify(created).includes(grantReference), false)
})

test('stdio rows are hidden from tenant peers and disconnect publishes an exact native revoke fence', async () => {
  const h = harness()
  const created = await h.service.create({ transport: 'stdio', creationId: 'owner-only', label: 'Local' }, tenantId, ownerUserId)
  const id = created.connection.id
  assert.equal(h.registry.view(id, tenantId), undefined)
  assert.equal(h.registry.privateConnection(id, tenantId, 'other-person'), undefined)
  assert.throws(() => h.registry.disconnect(id, tenantId, 0, 'other-person'), (error: unknown) =>
    error instanceof McpConnectionError && error.code === 'missing')

  await h.service.inspect(id, tenantId, { operationId: operation, expectedRevision: 0, grantReference }, ownerUserId)
  const disconnected = await h.service.disconnect(id, tenantId, 1, ownerUserId)
  assert.equal(disconnected.connection.status, 'disconnected')
  assert.deepEqual(h.bindingsSeen.at(-1)?.[1], [{ reference: null,
    binding: { tenantId, ownerUserId, connectionId: id, connectionRevision: 2 } }])
  const removed = await h.service.remove(id, tenantId, 2, ownerUserId)
  assert.equal(removed.removed, true)
  assert.deepEqual(h.registry.snapshot().retired, [{ tenantId, id, ownerUserId, transport: 'stdio' }],
    'retirement preserves enough private transport identity to prevent old unattended receipts becoming HTTP authority')
  assert.deepEqual(parseMcpConnectionState(h.registry.snapshot()), h.registry.snapshot())
  assert.throws(() => parseMcpConnectionState({ connections: [], retired: [{ tenantId, id, transport: 'stdio' }] }),
    'stdio tombstones cannot lose their person owner')
})

test('stdio setup and inspection fail closed before native/process work when capability or custody is unavailable', async () => {
  const unavailable = harness({ available: false })
  await assert.rejects(unavailable.service.create({ transport: 'stdio', creationId: 'no-cap', label: 'Local' }, tenantId, ownerUserId),
    (error: unknown) => error instanceof McpInspectionError && error.code === 'credentials_unavailable')
  assert.deepEqual(unavailable.registry.snapshot(), { connections: [], retired: [] })

  const pending = harness({ syncAvailable: false })
  await assert.rejects(pending.service.create({ transport: 'stdio', creationId: 'no-custody', label: 'Local' }, tenantId, ownerUserId),
    (error: unknown) => error instanceof McpInspectionError && error.code === 'credentials_unavailable')
  assert.equal(pending.registry.snapshot().connections.length, 1, 'durable create is recoverable by retrying the same identity')
  assert.equal(pending.opens(), 0)
})

test('strict stdio parser rejects fake HTTP/auth fields and accepts only the opaque native reference', () => {
  assert.deepEqual(parseMcpConnectionCreate({ transport: 'stdio', creationId: 'local', label: 'Local' }),
    { transport: 'stdio', creationId: 'local', label: 'Local' })
  assert.throws(() => parseMcpConnectionCreate({ transport: 'stdio', creationId: 'local', label: 'Local', endpoint: 'stdio://x' }))
  assert.throws(() => parseMcpConnectionCreate({ transport: 'stdio', creationId: 'local', label: 'Local', authentication: 'none' }))
  assert.throws(() => parseMcpConnectionCreate({ transport: 'http', creationId: 'local', label: 'Local' }))
  assert.deepEqual(parseMcpConnectionInspection({ operationId: 'op', expectedRevision: 0, grantReference }),
    { operationId: 'op', expectedRevision: 0, grantReference })
  assert.throws(() => parseMcpConnectionInspection({ operationId: 'op', expectedRevision: 0,
    grantReference, credentialReference: `MCP_DESKTOP_${'B'.repeat(32)}` }))
  assert.throws(() => parseMcpConnectionInspection({ operationId: 'op', expectedRevision: 0,
    grantReference: 'raw-secret-or-path' }))
})

test('private persisted stdio admission refuses missing owners, mixed fields, and dangling grants', () => {
  const base = { transport: 'stdio', tenantId, ownerUserId, id: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    label: 'Local', revision: 0, connected: false }
  for (const malformed of [
    { ...base, ownerUserId: undefined },
    { ...base, endpoint: 'https://not-stdio.example' },
    { ...base, authentication: 'none' },
    { ...base, grantReference },
  ]) assert.throws(() => parseMcpConnectionState({ connections: [malformed], retired: [] }))
})

test('HTTP OAuth and native stdio creation enforce actor and global synchronized capacity before row publication', () => {
  const registry = createMcpConnectionRegistry()
  const oauthSetup = { id: mcpConnectionCreationId(tenantId, 'oauth-requires-person'), label: 'OAuth',
    endpoint: 'https://mcp.example.test/rpc', authentication: 'device-oauth' as const }
  assert.throws(() => registry.create(oauthSetup, tenantId), (error: unknown) =>
    error instanceof McpConnectionError && error.code === 'invalid')
  assert.throws(() => registry.create(oauthSetup, tenantId, false, ' '), (error: unknown) =>
    error instanceof McpConnectionError && error.code === 'invalid')
  assert.deepEqual(registry.snapshot(), { connections: [], retired: [] }, 'invalid OAuth creation never publishes a tenant-only row')
  const serviceHarness = harness({ oauthAvailable: true })
  assert.throws(() => serviceHarness.service.create({ creationId: 'oauth-needs-actor', label: 'OAuth',
    endpoint: 'https://mcp.example.test/rpc', authentication: 'device-oauth' }, tenantId), (error: unknown) =>
    error instanceof McpConnectionError && error.code === 'invalid')
  assert.equal(serviceHarness.registry.snapshot().connections.length, 0, 'service creation inherits the direct registry actor requirement')

  for (let index = 0; index < MAX_MCP_STDIO_CONNECTIONS; index += 1) {
    const tenant = `tenant-${index}`
    registry.create({ transport: 'stdio', id: mcpStdioConnectionCreationId(tenant, `grant-${index}`, ownerUserId), label: 'Local' }, tenant, false, ownerUserId)
  }
  assert.throws(() => registry.create({ transport: 'stdio', id: mcpStdioConnectionCreationId('tenant-overflow', 'grant', ownerUserId), label: 'Local' },
    'tenant-overflow', false, ownerUserId), (error: unknown) => error instanceof McpConnectionError && error.code === 'capacity')
  assert.equal(registry.snapshot().connections.length, MAX_MCP_STDIO_CONNECTIONS,
    'disconnected and unverified rows also occupy native synchronization capacity')
  const oversized = structuredClone(registry.snapshot())
  oversized.connections.push({ transport: 'stdio', tenantId: 'tenant-extra', ownerUserId,
    id: mcpStdioConnectionCreationId('tenant-extra', 'extra', ownerUserId), label: 'Local', revision: 0, connected: false })
  assert.throws(() => parseMcpConnectionState(oversized), (error: unknown) =>
    error instanceof McpConnectionError && error.code === 'capacity', 'restore admission applies the same global bound')
})

test('interactive bound execution uses exactly one owner-bound stdio tool call and never an HTTP endpoint', async () => {
  const h = harness()
  const created = await h.service.create({ transport: 'stdio', creationId: 'bound-call', label: 'Local' }, tenantId, ownerUserId)
  const id = created.connection.id
  await h.service.inspect(id, tenantId, { operationId: operation, expectedRevision: 0, grantReference }, ownerUserId)
  const view = h.registry.view(id, tenantId, ownerUserId)!
  const tool = view.tools[0]!
  const exactBinding: McpBoundToolCall = { connectionId: id, connectionRevision: view.revision, toolName: tool.name,
    schemaHash: mcpToolSchemaHash(tool), arguments: { q: 'otters' } }
  const purpose: string[] = []
  let calls = 0
  let opens = 0
  const execute = createBoundMcpExecutor({ runtimeConfiguration: () => ({
    deviceBearerAvailable: false, allowLoopback: false, localProcessesAvailable: true,
    openStdio: (reference, binding, options) => {
      opens += 1
      assert.equal(reference, grantReference)
      assert.deepEqual(binding, { tenantId, ownerUserId, connectionId: id, connectionRevision: view.revision })
      purpose.push(options.purpose)
      return {
        ...nativeConnection(),
        request: async (method, params, nativeOptions) => {
          if (method === 'tools/call') {
            calls += 1
            assert.equal(params.name, 'search')
            assert.deepEqual(params.arguments, { q: 'otters' })
          }
          return nativeConnection().request(method, params, nativeOptions)
        },
      }
    },
  }) })
  assert.equal((await execute(h.store as never, tenantId, exactBinding, () => true, ownerUserId)).status, 'done')
  assert.deepEqual(purpose, ['call'])
  assert.equal(calls, 1)
  assert.equal((await execute(h.store as never, tenantId, exactBinding, () => true, 'other-person')).status, 'failed')
  assert.equal(opens, 1)
})
