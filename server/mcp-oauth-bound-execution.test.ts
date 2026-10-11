import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import { createBoundMcpExecutor } from './mcpBoundExecution.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'

const tool = { name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
const tenantId = 'tenant-oauth-owner'
const ownerUserId = 'user-oauth-owner'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const endpoint = 'https://mcp.example.test/tools'
const credentialReference = `MCP_DESKTOP_${'A'.repeat(32)}`
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const exactBinding = (): McpBoundToolCall => ({ connectionId, connectionRevision: 7, toolName: 'search', schemaHash,
  arguments: { q: 'puffins' } })
const connection = (): PrivateMcpConnection => ({ tenantId, ownerUserId, id: connectionId, label: 'Private search', endpoint,
  authentication: 'device-oauth', credentialReference, revision: 7, connected: true,
  inspection: { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', inspectedAt: 123,
    tools: [tool], schemaAdmission: { version: 1, hashes: [schemaHash] } } })
function harness(row = connection()) {
  let current = row
  const actorReads: Array<string | undefined> = []
  const actorViewReads: Array<string | undefined> = []
  const store = {
    privateMcpConnection: (_id: string, _tenant: string, actor?: string) => { actorReads.push(actor); return current },
    mcpConnection: (_id: string, _tenant: string, actor?: string): McpConnectionView => { actorViewReads.push(actor); return ({ id: connectionId, label: current.label, status: 'connected', revision: current.revision,
      authentication: current.authentication, protocolVersion: MCP_MODERN_VERSION, inspectedAt: 123, tools: [tool],
      execution: 'approval-required', executableTools: ['search'] }) },
  }
  return { store, actorReads, actorViewReads, replace(next: PrivateMcpConnection) { current = next } }
}
const runtime = (extra: Record<string, unknown> = {}) => ({ deviceBearerAvailable: false, allowLoopback: false, ...extra }) as any
function completedCall() {
  return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
    resultType: 'complete', content: [{ type: 'text', text: 'found puffins' }], isError: false,
  } }
}

test('OAuth owner is required before any credential or network call, even with permissive store reads', async () => {
  for (const actorUserId of [undefined, 'other-user']) {
    const h = harness()
    let oauthReads = 0, bearerReads = 0, calls = 0
    const execute = createBoundMcpExecutor({ runtimeConfiguration: () => runtime({
      deviceOAuthAvailable: true,
      resolveOAuthCredential: async () => { oauthReads++; return 'oauth-token' },
      resolveCredential: async () => { bearerReads++; return 'wrong bearer path' },
    }), call: async () => { calls++; return completedCall() } })
    const result = await execute(h.store as any, tenantId, exactBinding(), () => true, actorUserId)
    assert.equal(result.status, 'failed')
    assert.equal(oauthReads, 0)
    assert.equal(bearerReads, 0)
    assert.equal(calls, 0)
  }
})

test('correct owner resolves only the exact OAuth binding and fences the final dispatch', async () => {
  const h = harness()
  let received: unknown, resolverOptions: any, calls = 0, bearerReads = 0
  const execute = createBoundMcpExecutor({ runtimeConfiguration: () => runtime({
    deviceOAuthAvailable: true,
    resolveOAuthCredential: async (reference: string, binding: unknown, options: unknown) => {
      received = { reference, binding }; resolverOptions = options
      assert.equal((options as any).isCurrent(), true)
      return 'native-oauth-access'
    },
    resolveCredential: async () => { bearerReads++; return 'wrong-bearer-path' },
  }), call: async (_endpoint, _invocation, options) => {
    calls++
    assert.equal(options.bearerToken, 'native-oauth-access')
    await options.beforeCall?.()
    return completedCall()
  } })
  const result = await execute(h.store as any, tenantId, exactBinding(), () => true, ownerUserId)
  assert.deepEqual(received, { reference: credentialReference, binding: { tenantId, connectionId, endpoint, ownerUserId,
    connectionRevision: 7 } })
  assert.equal(resolverOptions.signal.aborted, true)
  assert.equal(bearerReads, 0)
  assert.equal(calls, 1)
  assert.equal(result.status, 'done')
  assert.ok(h.actorReads.every(actor => actor === ownerUserId))
  assert.ok(h.actorViewReads.every(actor => actor === ownerUserId))
})

test('owner/revision revocation during OAuth resolution blocks transport dispatch', async () => {
  const h = harness()
  let release!: (token: string) => void
  let resolverOptions: any, calls = 0
  const resolverStarted = deferred<void>()
  const pendingToken = new Promise<string>(resolve => { release = resolve })
  const execute = createBoundMcpExecutor({ runtimeConfiguration: () => runtime({
    deviceOAuthAvailable: true,
    resolveOAuthCredential: async (_reference: string, _binding: unknown, options: unknown) => {
      resolverOptions = options
      resolverStarted.resolve()
      return pendingToken
    },
  }), call: async () => { calls++; return completedCall() } })
  const work = execute(h.store as any, tenantId, exactBinding(), () => true, ownerUserId)
  await resolverStarted.promise
  h.replace({ ...connection(), ownerUserId: 'different-owner', revision: 8 })
  assert.equal(resolverOptions.isCurrent(), false)
  release('late-oauth-token')
  assert.equal((await work).status, 'failed')
  assert.equal(calls, 0)
})

test('OAuth never falls back to bearer credential resolution when capability or resolver is absent', async () => {
  for (const runtimeConfig of [
    runtime({ deviceBearerAvailable: true, resolveCredential: async () => 'bearer-token' }),
    runtime({ deviceOAuthAvailable: true, resolveCredential: async () => 'bearer-token' }),
  ]) {
    let bearerReads = 0, calls = 0
    runtimeConfig.resolveCredential = async () => { bearerReads++; return 'bearer-token' }
    const execute = createBoundMcpExecutor({ runtimeConfiguration: () => runtimeConfig,
      call: async () => { calls++; return completedCall() } })
    assert.equal((await execute(harness().store as any, tenantId, exactBinding(), () => true, ownerUserId)).status, 'failed')
    assert.equal(bearerReads, 0)
    assert.equal(calls, 0)
  }
})

test('OAuth execution cannot inherit a deployment loopback exception', async () => {
  const localEndpoint = 'https://127.0.0.1:8443/mcp'
  const h = harness({ ...connection(), endpoint: localEndpoint })
  let oauthReads = 0, calls = 0
  const execute = createBoundMcpExecutor({ runtimeConfiguration: () => runtime({
    allowLoopback: true,
    deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => { oauthReads++; return 'oauth-token' },
  }), call: async () => { calls++; return completedCall() } })
  assert.equal((await execute(h.store as any, tenantId, exactBinding(), () => true, ownerUserId)).status, 'failed')
  assert.equal(oauthReads, 0)
  assert.equal(calls, 0)
})
