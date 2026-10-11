import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session, ToolActivity } from '../contract/index.ts'
import { parseMcpActivityAuthorities, validateMcpActivityAuthorities, type McpActivityAuthority } from './mcpActivityAuthority.ts'
import type { McpConnectionState } from './mcpConnections.ts'

const activity: ToolActivity = {
  id: 'activity-1', tool: 'mcp__remote__lookup', connector: 'Remote', connectorId: `mcp-connection-${'a'.repeat(32)}`,
  kind: 'action', status: 'done', summary: 'Complete', input: {}, decisionId: `tool-activity-decision-${'b'.repeat(24)}`,
  mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash: 'c'.repeat(64) },
}
const session: Session = { id: 'session-1', tenantId: 'tenant-a', title: 'Thread', preview: '', messages: [{ id: 'message-1', role: 'assistant', content: '', toolActivities: [activity] }] }
const authority: McpActivityAuthority = {
  sessionId: session.id, activityId: activity.id, connectionId: activity.connectorId, tenantId: 'tenant-a', ownerUserId: 'user-a',
}
const connection: McpConnectionState = {
  connections: [{
    tenantId: 'tenant-a', ownerUserId: 'user-a', id: activity.connectorId, label: 'Remote', endpoint: 'https://mcp.example',
    authentication: 'device-oauth', revision: 1, connected: true,
  }], retired: [],
}

test('private OAuth activity authority has a closed shape, bounded values and unique activity joins', () => {
  assert.deepEqual(parseMcpActivityAuthorities([authority]), [authority])
  for (const invalid of [
    null,
    [null],
    [{ ...authority, ownerUserId: undefined }],
    [{ ...authority, connectionId: 'mcp-connection-short' }],
    [{ ...authority, extra: 'wire leak' }],
    [authority, authority],
  ]) assert.throws(() => parseMcpActivityAuthorities(invalid))
})

test('OAuth owner joins exact active or retired connection and active or compacted activity', () => {
  assert.equal(validateMcpActivityAuthorities([authority], [session], connection), true)
  const compacted: Session = { ...session, messages: [], compactedMessages: session.messages }
  assert.equal(validateMcpActivityAuthorities([authority], [compacted], connection), true)
  const retired: McpConnectionState = { connections: [], retired: [{ tenantId: 'tenant-a', id: activity.connectorId, ownerUserId: 'user-a' }] }
  assert.equal(validateMcpActivityAuthorities([authority], [compacted], retired), true)
  assert.equal(validateMcpActivityAuthorities([], [session], connection), false, 'known OAuth history cannot lose its owner anchor')
})

test('authority rejects orphan, wrong activity, wrong connection, wrong owner and wrong tenant', () => {
  assert.equal(validateMcpActivityAuthorities([authority], [], connection), false)
  assert.equal(validateMcpActivityAuthorities([{ ...authority, activityId: 'other' }], [session], connection), false)
  assert.equal(validateMcpActivityAuthorities([{ ...authority, connectionId: `mcp-connection-${'d'.repeat(32)}` }], [session], connection), false)
  assert.equal(validateMcpActivityAuthorities([{ ...authority, ownerUserId: 'user-b' }], [session], connection), false)
  assert.equal(validateMcpActivityAuthorities([{ ...authority, tenantId: 'tenant-b' }], [session], connection), false)
  const reused = { ...connection, connections: [{ ...connection.connections[0], authentication: 'device-bearer', ownerUserId: undefined }] }
  assert.equal(validateMcpActivityAuthorities([authority], [session], reused), false)
})

test('stdio activity owner authority is mandatory for live and retired person-owned connections', () => {
  const stdioActivity: ToolActivity = { ...activity, connectorId: `mcp-connection-${'e'.repeat(32)}` }
  const sharedSession: Session = { ...session, tenantId: 'session-source-tenant', messages: [{
    ...session.messages![0]!, toolActivities: [stdioActivity],
  }] }
  const stdioAuthority: McpActivityAuthority = {
    sessionId: sharedSession.id, activityId: stdioActivity.id, connectionId: stdioActivity.connectorId,
    tenantId: 'connection-owner-tenant', ownerUserId: 'user-a',
  }
  const live: McpConnectionState = { connections: [{
    transport: 'stdio', tenantId: 'connection-owner-tenant', ownerUserId: 'user-a', id: stdioActivity.connectorId,
    label: 'Local', revision: 1, connected: true, grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
    inspection: { protocolVersion: '2025-11-25', cleanup: 'released', inspectedAt: 1, tools: [] },
  }], retired: [] }
  assert.equal(validateMcpActivityAuthorities([stdioAuthority], [sharedSession], live), true)
  assert.equal(validateMcpActivityAuthorities([], [sharedSession], live), false,
    'stdio action history cannot lose its person anchor')
  assert.equal(validateMcpActivityAuthorities([{ ...stdioAuthority, ownerUserId: 'user-b' }], [sharedSession], live), false)

  const compacted: Session = { ...sharedSession, messages: [], compactedMessages: sharedSession.messages }
  const retired: McpConnectionState = { connections: [], retired: [{
    transport: 'stdio', tenantId: 'connection-owner-tenant', id: stdioActivity.connectorId, ownerUserId: 'user-a',
  }] }
  assert.equal(validateMcpActivityAuthorities([stdioAuthority], [compacted], retired), true)
  assert.equal(validateMcpActivityAuthorities([], [compacted], retired), false,
    'retired stdio history still needs the private owner anchor')
})
