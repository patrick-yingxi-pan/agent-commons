import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mcpConnectionContext, type McpConnectionView } from './mcpConnections.ts'

const base = {
  id: 'opaque-connection-identity', label: 'Reviewed server', revision: 7,
  protocolVersion: '2025-06-18', inspectedAt: 42,
  tools: [{ name: 'read', inputSchema: { type: 'object' } }, { name: 'list', inputSchema: { type: 'object' } }],
  execution: 'approval-required' as const,
}

function assertProjection(connection: McpConnectionView, detail: string) {
  assert.deepEqual(mcpConnectionContext(connection), {
    id: base.id, label: base.label, kind: 'mcp',
    status: connection.status === 'connected' ? 'connected' : 'needs-auth',
    connectionRevision: base.revision, lastUsedAt: null, sessions: 0, detail,
  })
}

test('local MCP context synopsis names its transport without changing identity or attachment authority', () => {
  for (const status of ['unverified', 'connected', 'disconnected'] as const) {
    assertProjection({ ...base, transport: 'stdio', status }, status === 'connected'
      ? 'Local MCP process · 2 tools inspected' : 'Local MCP process · connection required')
  }
  assertProjection({ ...base, transport: 'stdio', status: 'connected', tools: [] }, 'Local MCP process · 0 tools inspected')
})

test('legacy and explicit HTTP MCP context synopses preserve existing copy for every authentication mode', () => {
  for (const transport of [undefined, 'http'] as const) {
    for (const authentication of ['none', 'device-bearer', 'device-oauth'] as const) {
      for (const status of ['unverified', 'connected', 'disconnected'] as const) {
        assertProjection({ ...base, ...(transport ? { transport } : {}), authentication, status }, status === 'connected'
          ? 'External MCP · 2 tools inspected' : 'External MCP · connection required')
      }
    }
  }
})
