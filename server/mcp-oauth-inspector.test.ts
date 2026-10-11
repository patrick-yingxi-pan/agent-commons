import assert from 'node:assert/strict'
import test from 'node:test'
import { McpConnectionError } from './mcpConnections.ts'
import { createMcpConnectionInspector, McpInspectionError } from './mcpConnectionInspector.ts'
import { MCP_MODERN_VERSION } from './mcpDiscovery.ts'

const id = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const tenantId = 'tenant-oauth-owner'
const ownerUserId = 'user-oauth-owner'
const endpoint = 'https://mcp.example.test/tools'
const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
const catalog = { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed' as const,
  tools: [{ name: 'search', inputSchema: { type: 'object' } }] }
const row = () => ({ id, tenantId, ownerUserId, label: 'Private MCP', endpoint, authentication: 'device-oauth',
  credentialReference: reference, revision: 7, connected: false })
const isConnection = (code: string) => (error: unknown) => error instanceof McpConnectionError && error.code === code
const isInspection = (code: string) => (error: unknown) => error instanceof McpInspectionError && error.code === code
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function harness() {
  let current: any = row()
  let committedActor: string | undefined
  const store = {
    privateMcpConnection: (_id: string, _tenantId: string, _actorUserId?: string) => current,
    commitMcpInspection: (...args: any[]) => { committedActor = args[7]; return { id, status: 'connected' } },
  }
  return { store, replace(next: any) { current = next }, committedActor: () => committedActor }
}

test('OAuth inspection requires the exact person before credential lookup, even if the store is permissive', async () => {
  const h = harness()
  let oauthReads = 0, bearerReads = 0, network = 0
  const inspect = createMcpConnectionInspector({ store: h.store as any, allowLoopback: false,
    resolveCredential: async () => { bearerReads++; return 'wrong-bearer-path' },
    resolveOAuthCredential: async () => { oauthReads++; return 'oauth-access' },
    discover: async () => { network++; return catalog } })
  await assert.rejects(inspect(id, tenantId, 7, { credentialReference: reference }), isConnection('missing'))
  await assert.rejects(inspect(id, tenantId, 7, { credentialReference: reference, actorUserId: 'other-user' }), isConnection('missing'))
  assert.equal(oauthReads, 0)
  assert.equal(bearerReads, 0)
  assert.equal(network, 0)
})

test('OAuth inspection supplies exact owner/revision binding and a live abortable fence, with no bearer fallback', async () => {
  const h = harness()
  let binding: unknown, options: any, bearerReads = 0, discovery: any
  const inspect = createMcpConnectionInspector({ store: h.store as any,
    resolveCredential: async () => { bearerReads++; return 'must-not-be-used' },
    resolveOAuthCredential: async (gotReference, gotBinding, gotOptions) => {
      assert.equal(gotReference, reference)
      binding = gotBinding; options = gotOptions
      assert.equal(gotOptions.isCurrent(), true)
      return 'oauth-access-token'
    },
    discover: async (_endpoint, value) => { discovery = value; return catalog }, now: () => 123 })
  const result = await inspect(id, tenantId, 7, { actorUserId: ownerUserId })
  assert.deepEqual(binding, { tenantId, connectionId: id, endpoint, ownerUserId, connectionRevision: 7 })
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(options.signal.aborted, true, 'inspection always aborts its resolver signal on settlement')
  assert.equal(discovery.bearerToken, 'oauth-access-token')
  assert.equal(bearerReads, 0)
  assert.equal(h.committedActor(), ownerUserId)
  assert.equal(result.status, 'connected')
})

test('OAuth owner, endpoint, reference and revision are rechecked after credential resolution', async () => {
  for (const change of [
    (value: any) => { value.ownerUserId = 'other-user' },
    (value: any) => { value.endpoint = 'https://changed.example.test/tools' },
    (value: any) => { value.credentialReference = `MCP_DESKTOP_${'B'.repeat(32)}` },
    (value: any) => { value.revision += 1 },
  ]) {
    const h = harness()
    const pending = deferred<string>()
    const resolverStarted = deferred<void>()
    let network = 0
    const inspect = createMcpConnectionInspector({ store: h.store as any,
      resolveOAuthCredential: async (_reference, _binding, options) => {
        assert.equal(options.isCurrent(), true)
        resolverStarted.resolve()
        return pending.promise
      },
      discover: async () => { network++; return catalog } })
    const work = inspect(id, tenantId, 7, { actorUserId: ownerUserId })
    await resolverStarted.promise
    const changed = row(); change(changed); h.replace(changed)
    pending.resolve('late-access-token')
    await assert.rejects(work, isConnection('conflict'))
    assert.equal(network, 0)
  }
})

test('OAuth resolver absence fails closed and never falls back to bearer resolution', async () => {
  const h = harness()
  let bearerReads = 0, network = 0
  const inspect = createMcpConnectionInspector({ store: h.store as any,
    resolveCredential: async () => { bearerReads++; return 'bearer-token' },
    discover: async () => { network++; return catalog } })
  await assert.rejects(inspect(id, tenantId, 7, { actorUserId: ownerUserId }), isInspection('credentials_unavailable'))
  assert.equal(bearerReads, 0)
  assert.equal(network, 0)
})

test('OAuth inspection cannot inherit deployment loopback allowance and can bind a fresh replacement reference', async () => {
  const h = harness()
  let reads = 0, discovery: any
  const inspect = createMcpConnectionInspector({ store: h.store as any, allowLoopback: true,
    resolveOAuthCredential: async (gotReference, _binding, options) => {
      reads++
      assert.equal(gotReference, reference)
      assert.equal(options.isCurrent(), true)
      return 'fresh-oauth-access'
    }, discover: async (_endpoint, value) => { discovery = value; return catalog } })

  h.replace({ ...row(), endpoint: 'http://127.0.0.1:8787/mcp', credentialReference: undefined })
  await assert.rejects(inspect(id, tenantId, 7, { actorUserId: ownerUserId, credentialReference: reference }), isConnection('invalid'))
  assert.equal(reads, 0)

  h.replace({ ...row(), credentialReference: undefined })
  await inspect(id, tenantId, 7, { actorUserId: ownerUserId, credentialReference: reference })
  assert.equal(reads, 1)
  assert.equal(discovery.bearerToken, 'fresh-oauth-access')
})
