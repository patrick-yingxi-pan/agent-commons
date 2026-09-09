import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { ToolActivity } from '../contract/index.ts'
import { createApprovedMcpExecutor } from './mcpExecution.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'

const tool = { name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } }
const hash = mcpToolSchemaHash(tool)
const connection = (): PrivateMcpConnection => ({
  tenantId: 'tenant-a', id: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Search MCP',
  endpoint: 'http://127.0.0.1:8789/mcp', authentication: 'none', revision: 3, connected: true,
  inspection: { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', inspectedAt: 1,
    tools: [tool], schemaAdmission: { version: 1, hashes: [hash] } },
})
const activity = (): ToolActivity => ({
  id: 'call-1', tool: 'mcp__search__search', connector: 'Search MCP',
  connectorId: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'action', status: 'running',
  decisionId: 'tool-activity-decision-000000000000000000000000', summary: 'Running', input: { q: 'otters' },
  mcp: { connectionRevision: 3, toolName: 'search', schemaHash: hash },
})
function harness(row = connection()) {
  let current = row
  const store = {
    privateMcpConnection: () => current,
    mcpConnection: (): McpConnectionView => ({ id: current.id, label: current.label, status: 'connected', revision: current.revision,
      authentication: current.authentication, protocolVersion: current.inspection?.protocolVersion ?? null, inspectedAt: 1,
      tools: [tool], execution: current.connected ? 'approval-required' : 'unavailable', executableTools: current.connected ? ['search'] : [] }),
    sessionContexts: () => [{ id: current.id, type: 'mcp' as const, label: current.label, scope: '*' }],
    disconnect: () => { current = { ...current, connected: false, revision: current.revision + 1 } },
  }
  return store
}

test('approved execution uses the exact reviewed call and rechecks authority immediately before send', async () => {
  const store = harness()
  let calls = 0
  const execute = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, allowLoopback: true }),
    call: async (endpoint, invocation, options) => {
      calls += 1
      assert.equal(endpoint, 'http://127.0.0.1:8789/mcp')
      assert.deepEqual(invocation, { tool: { name: 'search', inputSchema: tool.inputSchema }, arguments: { q: 'otters' } })
      assert.equal(options.expectedProtocolVersion, MCP_MODERN_VERSION)
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete' as const, content: [{ type: 'text' as const, text: 'found' }], isError: false,
      } }
    },
  })
  const result = await execute(store, 'session-a', 'tenant-a', activity())
  assert.equal(calls, 1)
  assert.equal(result.status, 'done')

  const disconnected = harness()
  const guarded = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, allowLoopback: true }),
    call: async (_endpoint, _invocation, options) => {
      disconnected.disconnect()
      await options.beforeCall?.()
      assert.fail('the guard must refuse before tools/call')
    },
  })
  assert.equal((await guarded(disconnected, 'session-a', 'tenant-a', activity())).status, 'failed')
})

test('post-submission failures and credential reflection are uncertain, never retryable success', async () => {
  const postSubmit = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, allowLoopback: true }),
    call: async () => { throw new McpToolCallError('response', true) },
  })
  assert.equal((await postSubmit(harness(), 'session-a', 'tenant-a', activity())).status, 'uncertain')

  const secret = 'secret-token-value'
  const bearerRow = { ...connection(), authentication: 'device-bearer' as const, credentialReference: `MCP_DESKTOP_${'A'.repeat(32)}` }
  const reflected = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: true, allowLoopback: true, resolveCredential: async () => secret,
      synchronizeBindings: async () => ({ available: true }) }),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete' as const, content: [{ type: 'text' as const, text: `peer echoed ${secret}` }], isError: false,
      } }
    },
  })
  const result = await reflected(harness(bearerRow), 'session-a', 'tenant-a', activity())
  assert.equal(result.status, 'uncertain')
  assert.doesNotMatch(result.summary, /secret-token-value/)

  const reflectedKey = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: true, allowLoopback: true, resolveCredential: async () => secret,
      synchronizeBindings: async () => ({ available: true }) }),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete' as const, content: [], isError: false,
        structuredContent: { [bearerRow.credentialReference!]: 'hidden in a key' },
      } }
    },
  })
  assert.equal((await reflectedKey(harness(bearerRow), 'session-a', 'tenant-a', activity())).status, 'uncertain')

  const returnedError = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, allowLoopback: true }),
    call: async (_endpoint, _invocation, options) => {
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete' as const, content: [{ type: 'text' as const, text: 'remote refusal' }], isError: true,
      } }
    },
  })
  const returned = await returnedError(harness(), 'session-a', 'tenant-a', activity())
  assert.equal(returned.status, 'failed')
  assert.equal('result' in returned ? returned.result?.isError : undefined, true)
})

test('invalid reviewed arguments fail before a tool call', async () => {
  let calls = 0
  const execute = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, allowLoopback: true }),
    call: async () => { calls += 1; throw new Error('must not call') },
  })
  const invalid = { ...activity(), input: { q: 12 } }
  assert.equal((await execute(harness(), 'session-a', 'tenant-a', invalid)).status, 'failed')
  assert.equal(calls, 0)
})

test('the executor independently requires a durable running external approval', async () => {
  let calls = 0
  const execute = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, allowLoopback: true }),
    call: async () => { calls += 1; throw new Error('must not call') },
  })
  for (const invalid of [
    { ...activity(), status: 'proposed' as const },
    { ...activity(), decisionId: undefined },
    { ...activity(), connectorId: 'conn-internal' },
    { ...activity(), kind: 'read' as const },
  ]) assert.equal((await execute(harness(), 'session-a', 'tenant-a', invalid)).status, 'failed')
  assert.equal(calls, 0)
})
