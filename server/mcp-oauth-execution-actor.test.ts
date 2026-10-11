import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { ToolActivity } from '../contract/index.ts'
import { createApprovedMcpExecutor } from './mcpExecution.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'

const tenantId = 'tenant-oauth-interactive'
const ownerUserId = 'user-oauth-interactive-owner'
const connectionId = `mcp-connection-${'a'.repeat(32)}`
const endpoint = 'https://interactive-owner.example.test/mcp'
const credentialReference = `MCP_DESKTOP_${'A'.repeat(32)}`
const tool = { name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } },
  required: ['query'], additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
const row: PrivateMcpConnection = { tenantId, ownerUserId, id: connectionId, label: 'Owner lookup', endpoint,
  authentication: 'device-oauth', credentialReference, revision: 6, connected: true,
  inspection: { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', inspectedAt: 1, tools: [tool],
    schemaAdmission: { version: 1, hashes: [schemaHash] } } }
const activity: ToolActivity = { id: 'oauth-interactive-call', tool: 'mcp__lookup__lookup', connector: 'Owner lookup',
  connectorId: connectionId, kind: 'action', status: 'running', decisionId: 'tool-activity-decision-000000000000000000000000',
  summary: 'Running', input: { query: 'albatross' }, mcp: { connectionRevision: 6, toolName: 'lookup', schemaHash } }

test('approved executor carries the authenticated person into attached-context and connection fences', async () => {
  const privateActors: Array<string | undefined> = []
  const viewActors: Array<string | undefined> = []
  const contextActors: Array<string | undefined> = []
  let credentialActor: string | undefined
  let dispatched = 0
  const view: McpConnectionView = { id: connectionId, label: row.label, status: 'connected', revision: row.revision,
    authentication: row.authentication, protocolVersion: MCP_MODERN_VERSION, inspectedAt: 1, tools: [tool],
    execution: 'approval-required', executableTools: ['lookup'] }
  const store = {
    privateMcpConnection: (_id: string, _tenant: string, actor?: string) => { privateActors.push(actor); return row },
    mcpConnection: (_id: string, _tenant: string, actor?: string) => { viewActors.push(actor); return view },
    sessionContexts: (_session: string, actor?: string) => { contextActors.push(actor); return [{ id: connectionId, type: 'mcp' as const, label: row.label }] },
  }
  const execute = createApprovedMcpExecutor({
    runtimeConfiguration: () => ({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
      resolveOAuthCredential: async (_reference, binding) => {
        credentialActor = binding.ownerUserId
        return 'native-oauth-secret'
      } }) as any,
    call: async (_url, _invocation, options) => {
      dispatched++
      assert.equal(options.bearerToken, 'native-oauth-secret')
      await options.beforeCall?.()
      return { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', result: {
        resultType: 'complete', content: [{ type: 'text', text: 'Found an albatross.' }], isError: false,
      } }
    },
  })
  const outcome = await execute(store, 'session-interactive', tenantId, activity, ownerUserId)
  assert.equal(outcome.status, 'done')
  assert.equal(credentialActor, ownerUserId)
  assert.equal(dispatched, 1)
  assert.ok(privateActors.length >= 2 && privateActors.every(actor => actor === ownerUserId))
  assert.ok(viewActors.length >= 2 && viewActors.every(actor => actor === ownerUserId))
  assert.ok(contextActors.length >= 2 && contextActors.every(actor => actor === ownerUserId))
})
