import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpConnectionRegistry, mcpConnectionCreationId, McpConnectionError } from './mcpConnections.ts'
import { createMcpConnectionInspector, McpInspectionError, type McpCredentialBinding } from './mcpConnectionInspector.ts'
import { MCP_MODERN_VERSION } from './mcpDiscovery.ts'

const id = mcpConnectionCreationId('owner', 'key')
const endpoint = 'http://127.0.0.1:8000/mcp'
const ref = `MCP_DESKTOP_${'A'.repeat(32)}`
const catalog = { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed' as const,
  tools: [{ name: 'search', inputSchema: { type: 'object' } }] }
function fixture(authentication: 'none' | 'device-bearer' = 'device-bearer') {
  const registry = createMcpConnectionRegistry()
  registry.create({ id, label: 'Search', endpoint, authentication }, 'owner', true)
  const store = { privateMcpConnection: registry.privateConnection, commitMcpInspection: registry.commitInspection }
  return { registry, store }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const isInspection = (code: string) => (error: unknown) => error instanceof McpInspectionError && error.code === code
const isConnection = (code: string) => (error: unknown) => error instanceof McpConnectionError && error.code === code

test('inspection resolves an exact tenant/connection/audience binding, then commits only safe metadata', async () => {
  const { registry, store } = fixture()
  const credentials: Array<[string, McpCredentialBinding]> = []
  const inspect = createMcpConnectionInspector({ store, allowLoopback: true, now: () => 123,
    resolveCredential: async (...args) => { credentials.push(args); return 'outbound-secret' },
    discover: async (url, options) => {
      assert.equal(url, endpoint)
      assert.equal(options.scope, 'loopback')
      assert.equal(options.bearerToken, 'outbound-secret')
      assert.equal(options.signal!.aborted, false)
      return catalog
    } })
  const result = await inspect(id, 'owner', 0, { credentialReference: ref })
  assert.deepEqual(credentials, [[ref, { tenantId: 'owner', connectionId: id, endpoint }]])
  assert.equal(result.status, 'connected')
  assert.equal(result.execution, 'unavailable')
  assert.equal(result.inspectedAt, 123)
  assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1|MCP_DESKTOP|outbound-secret/)
  assert.equal(registry.privateConnection(id, 'owner')!.credentialReference, ref)
})

test('ownership, revision, destination and deployment credential capability fail before resolution or I/O', async () => {
  const { store } = fixture()
  let calls = 0
  const discover = async () => { calls++; return catalog }
  const resolveCredential = async () => { calls++; return 'secret' }
  const inspect = createMcpConnectionInspector({ store, discover, resolveCredential, allowLoopback: true })
  await assert.rejects(inspect(id, 'foreign', 0, { credentialReference: ref }), isConnection('missing'))
  await assert.rejects(inspect(id, 'owner', 2, { credentialReference: ref }), isConnection('conflict'))
  await assert.rejects(inspect(id, 'owner', 0, { credentialReference: 'PROVIDER_DESKTOP_BAD' }), isConnection('invalid'))
  await assert.rejects(createMcpConnectionInspector({ store, discover, resolveCredential })(id, 'owner', 0, { credentialReference: ref }), isConnection('invalid'))
  await assert.rejects(createMcpConnectionInspector({ store, discover, allowLoopback: true })(id, 'owner', 0, { credentialReference: ref }), isInspection('credentials_unavailable'))
  assert.equal(calls, 0)
})

test('credential failures are non-reflective and do not save a reference or contact the server', async () => {
  for (const failure of [() => { throw new Error('token=secret https://private.example') }, () => 'unicode-α', () => 'bad\rheader']) {
    const { registry, store } = fixture()
    const before = registry.snapshot()
    const inspect = createMcpConnectionInspector({ store, allowLoopback: true,
      resolveCredential: async () => failure(), discover: async () => assert.fail('No request after credential refusal') })
    await assert.rejects(inspect(id, 'owner', 0, { credentialReference: ref }), error => {
      assert.equal(isInspection('credentials_unavailable')(error), true)
      assert.doesNotMatch(String(error), /token=|private\.example|unicode|header/)
      return true
    })
    assert.deepEqual(registry.snapshot(), before)
  }
})

test('disconnect while credentials resolve prevents later endpoint I/O', async () => {
  const { registry, store } = fixture()
  const secret = deferred<string>()
  const started = deferred<void>()
  const inspect = createMcpConnectionInspector({ store, allowLoopback: true,
    resolveCredential: async () => { started.resolve(); return secret.promise },
    discover: async () => assert.fail('Disconnected before request') })
  const running = inspect(id, 'owner', 0, { credentialReference: ref })
  await started.promise
  registry.disconnect(id, 'owner', 0)
  secret.resolve('secret')
  await assert.rejects(running, isConnection('conflict'))
  assert.equal(registry.view(id, 'owner')!.status, 'unverified')
})

test('late discovery cannot resurrect a removed connection, nor bypass a durable commit failure', async () => {
  const { registry, store } = fixture('none')
  const result = deferred<typeof catalog>()
  const started = deferred<void>()
  const inspect = createMcpConnectionInspector({ store, allowLoopback: true,
    discover: async () => { started.resolve(); return result.promise } })
  const running = inspect(id, 'owner', 0)
  await started.promise
  registry.remove(id, 'owner', 0)
  result.resolve(catalog)
  await assert.rejects(running, isConnection('missing'))
  assert.equal(registry.view(id, 'owner'), undefined)
  const healthy = fixture('none')
  const storageFailure = new Error('storage unavailable')
  const failing = createMcpConnectionInspector({ store: { ...healthy.store, commitMcpInspection() { throw storageFailure } },
    allowLoopback: true, discover: async () => catalog })
  await assert.rejects(failing(id, 'owner', 0), error => error === storageFailure)
})

test('cancellation and one deadline cover credential resolution; late secrets cannot start I/O', async () => {
  for (const mode of ['cancel', 'timeout']) {
    const { registry, store } = fixture()
    const secret = deferred<string>()
    const started = deferred<void>()
    const controller = new AbortController()
    const inspect = createMcpConnectionInspector({ store, allowLoopback: true, timeoutMs: mode === 'timeout' ? 20 : 1000,
      resolveCredential: async () => { started.resolve(); return secret.promise },
      discover: async () => assert.fail('Cancelled or expired before request') })
    const running = inspect(id, 'owner', 0, { credentialReference: ref, signal: controller.signal })
    await started.promise
    if (mode === 'cancel') controller.abort()
    await assert.rejects(running, isInspection(mode === 'cancel' ? 'cancelled' : 'timeout'))
    secret.resolve('secret')
    await Promise.resolve()
    assert.equal(registry.view(id, 'owner')!.status, 'unverified')
  }
})

test('one in-flight probe per connection is admitted; failure releases its slot without automatic Retry', async () => {
  const { registry, store } = fixture('none')
  const result = deferred<typeof catalog>()
  let calls = 0
  const inspect = createMcpConnectionInspector({ store, allowLoopback: true,
    discover: async () => { calls++; return result.promise } })
  const running = inspect(id, 'owner', 0)
  await assert.rejects(inspect(id, 'owner', 0), isInspection('busy'))
  assert.equal(calls, 1)
  result.resolve(catalog)
  await running
  registry.disconnect(id, 'owner', 1)
  await inspect(id, 'owner', 2)
  assert.equal(calls, 2)
})
