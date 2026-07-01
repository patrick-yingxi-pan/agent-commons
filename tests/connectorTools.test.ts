/** P6 slice 1 — connector/MCP tool exposure (server/model/connectorTools.ts).
 *  Locks the pure derivation + execution: which attached contexts yield tools, the
 *  deterministic tool names, the read/action classification, and that executing a
 *  derived tool produces a `ToolActivity` (mock result) while an unknown name falls
 *  through. The end-to-end round-trip (model calls a tool → SSE → UI card) is proven
 *  separately once generation + the mock + the route are wired. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveConnectorTools, runConnectorTool, isConnectorContext } from '../server/model/connectorTools.ts'

const mcpFs = { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' }
const slack = { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' }
const folder = { id: 'f1', type: 'folder', label: 'insights/', scope: '~/insights' }

test('only connector/MCP contexts contribute tools', () => {
  assert.equal(isConnectorContext(mcpFs), true)
  assert.equal(isConnectorContext(slack), true)
  assert.equal(isConnectorContext(folder), false)
})

test('an MCP context contributes one tool per advertised tool, correctly named + classified', () => {
  const { definitions, bindings } = deriveConnectorTools([mcpFs])
  assert.deepEqual(
    definitions.map((d) => d.name),
    ['mcp__filesystem__read_file', 'mcp__filesystem__write_file', 'mcp__filesystem__list_directory', 'mcp__filesystem__search_files'],
    'tool names are slugged from the server label + the advertised tool name',
  )
  assert.equal(bindings.get('mcp__filesystem__write_file')?.kind, 'action', 'a mutating verb is an action')
  assert.equal(bindings.get('mcp__filesystem__read_file')?.kind, 'read', 'a non-mutating tool is a read')
  for (const d of definitions) {
    assert.equal(d.input_schema.type, 'object')
    assert.deepEqual(d.input_schema.required, [], 'no required args in this slice')
  }
})

test('a connector context contributes one list read tool over its resources', () => {
  const { definitions, bindings } = deriveConnectorTools([slack])
  assert.deepEqual(definitions.map((d) => d.name), ['connector__slack__list'])
  const b = bindings.get('connector__slack__list')
  assert.equal(b?.kind, 'read')
  assert.match(b?.summary ?? '', /#launch/, 'the summary carries the fixture channels')
})

test('non-connector contexts are ignored; multiple contexts compose', () => {
  const names = deriveConnectorTools([folder, slack, mcpFs]).definitions.map((d) => d.name)
  assert.ok(!names.some((n) => n.includes('insights')), 'the folder yields no tools')
  assert.ok(names.includes('connector__slack__list'), 'the connector is present')
  assert.ok(names.includes('mcp__filesystem__read_file'), 'the MCP server is present')
})

test('runConnectorTool executes a derived tool into a ToolActivity; unknown → undefined', () => {
  const { bindings } = deriveConnectorTools([slack])
  const activity = runConnectorTool('connector__slack__list', bindings)
  assert.ok(activity, 'a derived tool executes')
  assert.equal(activity?.tool, 'connector__slack__list')
  assert.equal(activity?.connector, 'Slack')
  assert.equal(activity?.connectorId, 'conn-slack')
  assert.equal(activity?.kind, 'read')
  assert.match(activity?.summary ?? '', /#launch/)
  assert.equal(runConnectorTool('mcp__nope__x', bindings), undefined, 'an unknown name falls through')
})
