import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveConnectorTools, runConnectorTool } from './connectorTools.ts'
import { unconfiguredConnectorRuntime } from '../connectorRuntime.ts'

const id = `mcp-connection-${'a'.repeat(32)}`
const context = { id, type: 'mcp', label: 'Caller supplied label', scope: '*' }
const tool = { name: 'read/value.with spaces', description: 'Untrusted description', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } }
const connection = { id, label: 'Inspected server', revision: 3, status: 'connected', authentication: 'none', inspectedAt: 1, protocolVersion: '2026-07-28', tools: [tool], execution: 'approval-required', executableTools: [tool.name] }

test('owned attached external tools have provider-safe identities independent of labels and descriptions', () => {
  const derived = deriveConnectorTools([context], { externalMcpConnections: [connection] })
  assert.equal(derived.definitions.length, 1)
  const definition = derived.definitions[0]
  assert.match(definition.name, /^mcp_external_[a-f0-9]{48}$/)
  assert.deepEqual(definition.input_schema, tool.inputSchema)
  assert.match(definition.description, /read\/value.with spaces — via Inspected server/)
  const other = deriveConnectorTools([{ ...context, label: 'Renamed context' }], { externalMcpConnections: [{ ...connection, label: 'Renamed server' }] })
  assert.equal(other.definitions[0].name, definition.name)
  const secondId = `mcp-connection-${'b'.repeat(32)}`
  const pair = deriveConnectorTools([context, { ...context, id: secondId }], { externalMcpConnections: [connection, { ...connection, id: secondId }] })
  assert.equal(new Set(pair.definitions.map(entry => entry.name)).size, 2)
})

test('absent, detached, wrong-kind, disconnected, legacy and unsupported catalogs never derive tools', () => {
  assert.deepEqual(deriveConnectorTools([], { externalMcpConnections: [connection] }).definitions, [])
  assert.deepEqual(deriveConnectorTools([context]).definitions, [])
  assert.deepEqual(deriveConnectorTools([{ ...context, type: 'connector' }], { externalMcpConnections: [connection] }).definitions, [])
  for (const row of [{ ...connection, status: 'disconnected' }, { ...connection, execution: 'unavailable' }, { ...connection, executableTools: [] }]) {
    assert.deepEqual(deriveConnectorTools([context], { externalMcpConnections: [row] }).definitions, [])
  }
})

test('every external call is an exact-argument proposal; names, hints and standing approval grant no execution', async () => {
  const derived = deriveConnectorTools([context], { externalMcpConnections: [connection], standingApprovedContextIds: new Set([id]) })
  const name = derived.definitions[0].name
  const input = { query: 'Exact <text> & Unicode 🌱' }
  const activity = await runConnectorTool(name, derived.bindings, 'call-1', input, { mode: 'adapter', execute() { assert.fail('external proposals never invoke a connector runtime') } })
  assert.equal(activity.status, 'proposed')
  assert.equal(activity.kind, 'action')
  assert.deepEqual(activity.input, input)
  assert.notEqual(activity.input, input)
  assert.deepEqual(activity.mcp, { connectionRevision: 3, toolName: tool.name, schemaHash: derived.bindings.get(name).mcp.anchor.schemaHash })
  assert.match(activity.summary, /awaiting owner approval/)
})

test('external consent identities are host-owned even when a provider reuses a wire call id', async () => {
  const derived = deriveConnectorTools([context], { externalMcpConnections: [connection] })
  const name = derived.definitions[0].name
  const first = await runConnectorTool(name, derived.bindings, 'reused-provider-id', { query: 'First request' }, unconfiguredConnectorRuntime)
  const second = await runConnectorTool(name, derived.bindings, 'reused-provider-id', { query: 'Different request' }, unconfiguredConnectorRuntime)
  assert.match(first.id, /^mcp-activity-[a-f0-9-]{36}$/)
  assert.notEqual(first.id, 'reused-provider-id')
  assert.notEqual(second.id, first.id, 'a new proposal cannot inherit an earlier consent identity')
  assert.deepEqual(second.input, { query: 'Different request' })
})

test('invalid or cancelled arguments cannot enter an approval proposal', async () => {
  const derived = deriveConnectorTools([context], { externalMcpConnections: [connection] })
  const name = derived.definitions[0].name
  for (const input of [{}, { query: 42 }, { query: 'valid', extra: true }]) {
    const activity = await runConnectorTool(name, derived.bindings, 'call', input, unconfiguredConnectorRuntime)
    assert.equal(activity.status, 'failed')
    assert.equal(activity.input, undefined)
    assert.equal(activity.failure.retryable, false)
  }
  const cancelled = await runConnectorTool(name, derived.bindings, 'cancelled', { query: 'valid' }, unconfiguredConnectorRuntime, AbortSignal.abort())
  assert.equal(cancelled.status, 'failed')
})

test('oversized aggregate external catalogs are refused as a whole with an explicit disclosure', () => {
  const tools = Array.from({ length: 129 }, (_, index) => ({ ...tool, name: `tool_${index}` }))
  const derived = deriveConnectorTools([context], { externalMcpConnections: [{ ...connection, tools, executableTools: tools.map(row => row.name) }] })
  assert.equal(derived.externalUnavailable, true)
  assert.deepEqual(derived.definitions, [])
  assert.equal(derived.bindings.size, 0)
})
