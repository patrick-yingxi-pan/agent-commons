import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpBoundToolCall, McpToolPermission } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { matchesHttpMcpPermission, mcpPermissionAllowsCall, snapshotMcpToolPermissions } from './mcpPermission.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const connectionId = `mcp-connection-${'a'.repeat(32)}`
const tool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)

function permission(fixedArguments: Record<string, never | string | number | boolean | null | object> = {}, toolName = tool.name, id = connectionId, revision = 7, hash = schemaHash): McpToolPermission {
  return { connectionId: id, connectionRevision: revision, toolName, schemaHash: hash, fixedArguments: fixedArguments as McpToolPermission['fixedArguments'] }
}

function call(arguments_: Record<string, never | string | number | boolean | null | object> = {}, overrides: Partial<McpBoundToolCall> = {}): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'], ...overrides }
}

function connection(overrides: Partial<McpConnectionView> = {}): McpConnectionView {
  return {
    id: connectionId, label: 'Reviewed MCP', status: 'connected', revision: 7, authentication: 'none',
    protocolVersion: '2026-07-28', inspectedAt: 1_800_000_000_000, tools: [tool],
    execution: 'approval-required', executableTools: ['search'], ...overrides,
  }
}

test('permission snapshots are bounded, closed, and detached', () => {
  const source = [permission({ filter: { tags: ['a', { rank: 2 }] } })]
  const copied = snapshotMcpToolPermissions(source, 1)
  assert.ok(copied)
  source[0].fixedArguments.filter = { tags: ['changed'] }
  assert.deepEqual(copied[0].fixedArguments, { filter: { tags: ['a', { rank: 2 }] } })

  for (const maxTools of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 17, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(snapshotMcpToolPermissions([permission()], maxTools), undefined)
  }
  assert.equal(snapshotMcpToolPermissions([], 1), undefined)
  assert.equal(snapshotMcpToolPermissions([permission(), permission({}, 'other')], 1), undefined)
  assert.equal(snapshotMcpToolPermissions([{ ...permission(), extra: true }], 1), undefined)
  assert.equal(snapshotMcpToolPermissions([permission()], 0), undefined)
})

test('permission snapshot rejects duplicate connection/tool keys but permits distinct tools or connections', () => {
  assert.equal(snapshotMcpToolPermissions([permission(), permission({}, 'search', connectionId, 8)], 2), undefined)
  assert.ok(snapshotMcpToolPermissions([permission(), permission({}, 'search', `mcp-connection-${'b'.repeat(32)}`)], 2))
  assert.ok(snapshotMcpToolPermissions([permission(), permission({}, 'lookup')], 2))
})

test('fixed arguments compare exact nested JSON, with sorted object keys and ordered arrays', () => {
  const fixed = permission({ filter: { region: 'north', flags: [true, null, { level: 2 }] }, query: 'otters', nothing: null })
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters', filter: { flags: [true, null, { level: 2 }], region: 'north' }, nothing: null, extra: 9 })), true)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters', filter: { flags: [true, { level: 2 }, null], region: 'north' }, nothing: null })), false)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters', filter: { flags: [true, null, { level: 3 }], region: 'north' }, nothing: null })), false)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters', filter: { flags: [true, null, { level: 2 }], region: 'north' } })), false)
})

test('prototype-like argument names remain data and null is compared exactly', () => {
  const fixed = Object.create(null) as Record<string, never | string | number | boolean | null | object>
  Object.defineProperty(fixed, '__proto__', { value: { constructor: null }, enumerable: true, writable: true, configurable: true })
  fixed.constructor = null
  const actual = Object.create(null) as Record<string, never | string | number | boolean | null | object>
  Object.defineProperty(actual, '__proto__', { value: { constructor: null }, enumerable: true, writable: true, configurable: true })
  actual.constructor = null
  assert.equal(mcpPermissionAllowsCall(permission(fixed), call(actual)), true)
  actual.constructor = 'null'
  assert.equal(mcpPermissionAllowsCall(permission(fixed), call(actual)), false)
})

test('call permission binds the exact connection revision, schema, and tool', () => {
  const fixed = permission({ query: 'otters' })
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters' })), true)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters' }, { connectionRevision: 8 })), false)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters' }, { schemaHash: 'b'.repeat(64) })), false)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters' }, { toolName: 'lookup' })), false)
  assert.equal(mcpPermissionAllowsCall(fixed, call({ query: 'otters' }, { connectionId: `mcp-connection-${'b'.repeat(32)}` })), false)
})

test('HTTP permission requires one matching connected, admitted, approval-required tool', () => {
  const reviewed = permission()
  assert.equal(matchesHttpMcpPermission(reviewed, connection()), true)
  assert.equal(matchesHttpMcpPermission(reviewed, connection({ transport: 'http' })), true)
  for (const view of [
    undefined,
    connection({ transport: 'stdio' }),
    connection({ id: `mcp-connection-${'b'.repeat(32)}` }),
    connection({ revision: 8 }),
    connection({ status: 'disconnected' }),
    connection({ status: 'unverified' }),
    connection({ execution: 'unavailable' }),
    connection({ executableTools: [] }),
    connection({ tools: [] }),
    connection({ tools: [{ ...tool, inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }),
    connection({ tools: [tool, tool] }),
  ]) assert.equal(matchesHttpMcpPermission(reviewed, view), false)
})

test('duplicate schema names are rejected even when exactly one duplicate hash agrees', () => {
  const otherSchema = { ...tool, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }
  assert.equal(matchesHttpMcpPermission(permission(), connection({ tools: [tool, otherSchema] })), false)
})
