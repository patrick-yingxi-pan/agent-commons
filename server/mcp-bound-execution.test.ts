import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import { createBoundMcpExecutor } from './mcpBoundExecution.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { createApprovedMcpExecutor } from './mcpExecution.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'

const tool = { name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const connection = (): PrivateMcpConnection => ({
  tenantId: 'tenant-a', id: connectionId, label: 'Search MCP', endpoint: 'http://127.0.0.1:8789/mcp',
  authentication: 'none', revision: 3, connected: true,
  inspection: { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', inspectedAt: 1,
    tools: [tool], schemaAdmission: { version: 1, hashes: [schemaHash] } },
})
const binding = (): McpBoundToolCall => ({
  connectionId, connectionRevision: 3, toolName: 'search', schemaHash,
  arguments: { q: 'otters' },
})

function harness(row = connection()) {
  let current = row
  const store = {
    privateMcpConnection: (id: string, tenantId: string) => id === current.id && tenantId === current.tenantId ? current : undefined,
    mcpConnection: (id: string, tenantId: string): McpConnectionView | undefined => id === current.id && tenantId === current.tenantId
      ? { id: current.id, label: current.label, status: current.connected ? 'connected' : 'disconnected', revision: current.revision,
        authentication: current.authentication, protocolVersion: current.inspection?.protocolVersion ?? null, inspectedAt: 1,
        tools: [tool], execution: current.connected ? 'approval-required' : 'unavailable', executableTools: current.connected ? ['search'] : [] }
      : undefined,
    replace(next: PrivateMcpConnection) { current = next },
  }
  return store
}

const runtime = (resolveCredential?: (reference: string) => Promise<string>) => ({
  deviceBearerAvailable: Boolean(resolveCredential), allowLoopback: true,
  ...(resolveCredential ? { resolveCredential: async (reference: string) => resolveCredential(reference), synchronizeBindings: async () => ({ available: true }) } : {}),
})

test('bound executor snapshots exact arguments and tool schema before credential awaits', async () => {
  const store = harness({ ...connection(), authentication: 'device-bearer', credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  const input = binding()
  let releaseCredential!: (value: string) => void
  const credential = new Promise<string>((resolve) => { releaseCredential = resolve })
  let calls = 0
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(() => credential),
    call: async (_endpoint, invocation, options) => {
      calls += 1
      assert.deepEqual(invocation.arguments, { q: 'otters' })
      assert.deepEqual(invocation.tool.inputSchema, tool.inputSchema)
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false,
      } }
    },
  })
  const pending = execute(store, 'tenant-a', input, () => true)
  input.arguments.q = 'mutated after await'
  releaseCredential('private-token')
  assert.equal((await pending).status, 'done')
  assert.equal(calls, 1)

  const changingStore = harness({ ...connection(), authentication: 'device-bearer', credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  let releaseSecond!: (value: string) => void
  const secondCredential = new Promise<string>((resolve) => { releaseSecond = resolve })
  let sends = 0
  const second = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(() => secondCredential),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      sends += 1
      throw new Error('should be refused before send')
    },
  })
  const secondPending = second(changingStore, 'tenant-a', binding(), () => true)
  const changed = structuredClone(connection())
  changed.inspection!.tools[0].inputSchema.additionalProperties = true
  changingStore.replace({ ...changed, authentication: 'device-bearer', credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  releaseSecond('private-token')
  assert.equal((await secondPending).status, 'failed')
  assert.equal(sends, 0, 'a same-revision schema mutation fails the independent schema-hash fence')
})

test('authorization is strict, checked before credential access and immediately before send', async () => {
  const row = { ...connection(), authentication: 'device-bearer' as const, credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
  let credentialReads = 0
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(async () => { credentialReads += 1; return 'private-token' }),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      assert.fail('revoked authority must stop tools/call')
    },
  })
  let allowed = false
  assert.equal((await execute(harness(row), 'tenant-a', binding(), () => allowed)).status, 'failed')
  assert.equal(credentialReads, 0)

  const store = harness(row)
  const result = await execute(store, 'tenant-a', binding(), () => {
    if (credentialReads > 0) return false
    return true
  })
  assert.equal(result.status, 'failed')
  assert.equal(credentialReads, 1)
  const thenable = await execute(harness(), 'tenant-a', binding(), (() => Promise.resolve(true)) as unknown as () => boolean)
  assert.equal(thenable.status, 'failed', 'thenables are not awaited as authorization')
})

test('the final synchronous dispatch guard catches revocation at the transport boundary', async () => {
  let allowed = true
  let sends = 0
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(),
    call: async (_endpoint, _invocation, options) => {
      allowed = false
      await options.beforeCall?.()
      sends += 1
      throw new Error('transport must not dispatch after revocation')
    },
  })
  assert.equal((await execute(harness(), 'tenant-a', binding(), () => allowed)).status, 'failed')
  assert.equal(sends, 0)
})

test('foreign, stale, disconnected, and non-admitted bindings refuse without a call', async () => {
  let calls = 0
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(),
    call: async () => { calls += 1; throw new Error('must not send') },
  })
  const wrongTenant = await execute(harness(), 'tenant-b', binding(), () => true)
  const stale = await execute(harness(), 'tenant-a', { ...binding(), connectionRevision: 2 }, () => true)
  const disconnectedStore = harness({ ...connection(), connected: false })
  const disconnected = await execute(disconnectedStore, 'tenant-a', binding(), () => true)
  const wrongHash = await execute(harness(), 'tenant-a', { ...binding(), schemaHash: 'b'.repeat(64) }, () => true)
  assert.deepEqual([wrongTenant.status, stale.status, disconnected.status, wrongHash.status], ['failed', 'failed', 'failed', 'failed'])
  assert.equal(calls, 0)
})

test('invalid schema or arguments fail before the call and post-submission uncertainty is terminal', async () => {
  let calls = 0
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(),
    call: async (_endpoint, _invocation, options) => {
      calls += 1
      await options.beforeCall?.()
      throw new McpToolCallError('response', true)
    },
  })
  const invalidArgs = await execute(harness(), 'tenant-a', { ...binding(), arguments: { q: 4 as never } }, () => true)
  assert.equal(invalidArgs.status, 'failed')
  assert.equal(calls, 0)
  const malformedTool = { name: 'search', inputSchema: { type: 'string' } }
  const malformedHash = mcpToolSchemaHash(malformedTool)
  const malformedRow = structuredClone(connection())
  malformedRow.inspection!.tools = [malformedTool]
  malformedRow.inspection!.schemaAdmission!.hashes = [malformedHash]
  const invalidSchema = await execute(harness(malformedRow), 'tenant-a', { ...binding(), schemaHash: malformedHash }, () => true)
  assert.equal(invalidSchema.status, 'failed')
  assert.equal(calls, 0, 'an admitted stamp cannot make a malformed live schema executable')
  const uncertain = await execute(harness(), 'tenant-a', binding(), () => true)
  assert.equal(uncertain.status, 'uncertain')
  assert.match(uncertain.summary, /will not be run again automatically/)
  assert.equal(calls, 1)
})

test('returned results cannot disclose endpoint, credential reference, or bearer literals', async () => {
  const endpoint = connection().endpoint
  const reference = 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const secret = 'private-token'
  const row = { ...connection(), authentication: 'device-bearer' as const, credentialReference: reference }
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(async () => secret),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete', content: [{ type: 'text', text: `echo ${endpoint} ${reference} ${secret}` }], isError: false,
      } }
    },
  })
  const result = await execute(harness(row), 'tenant-a', binding(), () => true)
  assert.equal(result.status, 'uncertain')
  assert.doesNotMatch(JSON.stringify(result), /private-token|MCP_DESKTOP_|127\.0\.0\.1/)
})

test('bound-call snapshots preserve the independent argument cap and never invoke getters', () => {
  const maxArgs = { q: 'a'.repeat(49_144) }
  assert.equal(new TextEncoder().encode(JSON.stringify(maxArgs)).byteLength, 49_152)
  const exact = snapshotMcpBoundToolCall({ ...binding(), arguments: maxArgs })
  assert.ok(exact)
  assert.equal(exact.arguments.q?.toString().length, 49_144)
  assert.equal(snapshotMcpBoundToolCall({ ...binding(), arguments: { q: 'a'.repeat(49_145) } }), undefined)

  let getterReads = 0
  const withGetter = { ...binding(), get arguments() { getterReads += 1; return { q: 'otters' } } }
  assert.equal(snapshotMcpBoundToolCall(withGetter), undefined)
  assert.equal(getterReads, 0)
})

test('bound execution ignores unrelated oversized catalog entries and snapshots authority fields', async () => {
  const row = connection()
  row.inspection!.tools.push({ name: 'unrelated', description: 'x'.repeat(300_000), inputSchema: { type: 'object' } })
  const store = harness(row)
  let calls = 0
  const execute = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(),
    call: async (_endpoint, _invocation, options) => {
      calls += 1
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete', content: [{ type: 'text', text: 'ok' }], isError: false,
      } }
    },
  })
  assert.equal((await execute(store, 'tenant-a', binding(), () => true)).status, 'done')
  assert.equal(calls, 1)

  const bearerRow = { ...connection(), authentication: 'device-bearer' as const, credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
  const changedStore = harness(bearerRow)
  let release!: (secret: string) => void
  let credentialStarted!: () => void
  const started = new Promise<void>((resolve) => { credentialStarted = resolve })
  const credential = new Promise<string>((resolve) => { release = resolve })
  let sent = false
  const guarded = createBoundMcpExecutor({
    runtimeConfiguration: () => runtime(async () => { credentialStarted(); return credential }),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      sent = true
      throw new Error('must not send after endpoint authority changes')
    },
  })
  const pending = guarded(changedStore, 'tenant-a', binding(), () => true)
  await started
  changedStore.replace({ ...bearerRow, endpoint: 'http://127.0.0.1:8790/mcp' })
  release('private-token')
  assert.equal((await pending).status, 'failed')
  assert.equal(sent, false)
})

test('same-revision authentication, credential, and protocol mutations refuse after credential waits', async () => {
  const mutations: Array<[string, (row: PrivateMcpConnection) => void]> = [
    ['authentication', (row) => { row.authentication = 'none'; delete row.credentialReference }],
    ['credential reference', (row) => { row.credentialReference = 'MCP_DESKTOP_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }],
    ['protocol version', (row) => { row.inspection!.protocolVersion = '2024-11-05' }],
  ]
  for (const [name, mutate] of mutations) {
    const original = { ...connection(), authentication: 'device-bearer' as const, credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    const store = harness(original)
    let credentialStarted!: () => void
    const started = new Promise<void>((resolve) => { credentialStarted = resolve })
    let release!: (secret: string) => void
    const credential = new Promise<string>((resolve) => { release = resolve })
    let sent = false
    const execute = createBoundMcpExecutor({
      runtimeConfiguration: () => runtime(async () => { credentialStarted(); return credential }),
      call: async (_endpoint, _invocation, options) => {
        await options.beforeCall?.()
        sent = true
        throw new Error(`must not send after ${name} changes`)
      },
    })
    const pending = execute(store, 'tenant-a', binding(), () => true)
    const beforeMutation = await Promise.race([started.then(() => 'credential-started'), pending.then((outcome) => outcome.status)])
    assert.equal(beforeMutation, 'credential-started', name)
    const changed = structuredClone(original)
    mutate(changed)
    store.replace(changed)
    release('private-token')
    assert.equal((await pending).status, 'failed', name)
    assert.equal(sent, false, name)
  }
})

test('rejected asynchronous authorization is refused without an unhandled rejection', async () => {
  const execute = createBoundMcpExecutor({ runtimeConfiguration: () => runtime(), call: async () => assert.fail('must not call') })
  const result = await execute(harness(), 'tenant-a', binding(), (() => Promise.reject(new Error('denied'))) as unknown as () => boolean)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(result.status, 'failed')
})

test('session wrapper cannot retarget an approved call while credentials resolve', async () => {
  const first = { ...connection(), authentication: 'device-bearer' as const, credentialReference: 'MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
  const second = { ...connection(), id: 'mcp-connection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', label: 'Second MCP', authentication: 'device-bearer' as const,
    credentialReference: 'MCP_DESKTOP_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }
  let attached = first.id
  const store = {
    privateMcpConnection: (id: string, tenantId: string) => tenantId === 'tenant-a' &&
      (id === first.id || id === second.id) ? (id === first.id ? first : second) : undefined,
    mcpConnection: (id: string, tenantId: string): McpConnectionView | undefined => {
      const row = id === first.id ? first : id === second.id ? second : undefined
      return tenantId === 'tenant-a' && row ? { id: row.id, label: row.label, status: 'connected', revision: row.revision,
        authentication: row.authentication, protocolVersion: row.inspection?.protocolVersion ?? null, inspectedAt: 1,
        tools: [tool], execution: 'approval-required', executableTools: ['search'] } : undefined
    },
    sessionContexts: () => [{ id: attached, type: 'mcp' as const, label: 'MCP', scope: '*' }],
  }
  const activity = {
    id: 'call-redirect', tool: 'mcp__search__search', connector: 'Search MCP', connectorId: first.id, kind: 'action' as const,
    status: 'running' as const, decisionId: 'tool-activity-decision-000000000000000000000000', summary: 'Running', input: { q: 'otters' },
    mcp: { connectionRevision: 3, toolName: 'search', schemaHash },
  }
  let credentialStarted!: () => void
  const started = new Promise<void>((resolve) => { credentialStarted = resolve })
  let release!: (secret: string) => void
  const credential = new Promise<string>((resolve) => { release = resolve })
  let sent = false
  const execute = createApprovedMcpExecutor({
    runtimeConfiguration: () => runtime(async () => { credentialStarted(); return credential }),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      sent = true
      throw new Error('must not send')
    },
  })
  const pending = execute(store, 'session-a', 'tenant-a', activity)
  const beforeRedirect = await Promise.race([started.then(() => 'credential-started'), pending.then((outcome) => outcome.status)])
  assert.equal(beforeRedirect, 'credential-started')
  attached = second.id
  activity.connectorId = second.id
  activity.connector = second.label
  release('private-token')
  assert.equal((await pending).status, 'failed')
  assert.equal(sent, false)
})
