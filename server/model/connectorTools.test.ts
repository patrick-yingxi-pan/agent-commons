/** P6 slice 1 — connector/MCP tool exposure (server/model/connectorTools.ts).
 *  Locks the pure derivation + execution: which attached contexts yield tools, the
 *  deterministic tool names, the read/action classification, and that the injected
 *  runtime produces an honest `ToolActivity` while an unknown name falls through.
 *  The end-to-end round-trip (model calls a tool → SSE → UI card) is proven
 *  separately once generation + the mock + the route are wired. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveConnectorTools, runConnectorTool, isConnectorContext } from './connectorTools.ts'
import { fixtureConnectorRuntime, MAX_CONNECTOR_INPUT_CHARS, unconfiguredConnectorRuntime } from '../connectorRuntime.ts'
import { matchConnectorTools } from './intents.ts'

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
  assert.match(b?.developmentFixtureSummary ?? '', /#launch/, 'the development binding carries the fixture channels')
})

test('non-connector contexts are ignored; multiple contexts compose', () => {
  const names = deriveConnectorTools([folder, slack, mcpFs]).definitions.map((d) => d.name)
  assert.ok(!names.some((n) => n.includes('insights')), 'the folder yields no tools')
  assert.ok(names.includes('connector__slack__list'), 'the connector is present')
  assert.ok(names.includes('mcp__filesystem__read_file'), 'the MCP server is present')
})

test('matchConnectorTools ranks by matched tool-name words — a write picks write_file, not the first-declared read', () => {
  // Reproduces the review finding: the filesystem MCP declares read_file first, so a flat
  // "some word matched" score + first-declared tie-break collapsed every message to read_file
  // (mislabeling a write as a no-consent read). The word-count fix must pick the right tool.
  const fsTools = deriveConnectorTools([mcpFs]).definitions.map((d) => d.name)
  assert.deepEqual(matchConnectorTools('write a file via filesystem', fsTools).map((c) => c.name), ['mcp__filesystem__write_file'])
  assert.deepEqual(matchConnectorTools('read a file from filesystem', fsTools).map((c) => c.name), ['mcp__filesystem__read_file'])
  // The slug "filesystem" contains "file", but whole-word matching must NOT let that score
  // read_file for a list request — list_directory wins.
  assert.deepEqual(matchConnectorTools('list the directory via filesystem', fsTools).map((c) => c.name), ['mcp__filesystem__list_directory'])
})

test('matchConnectorTools only fires when the connector is named and tools are present', () => {
  const fsTools = deriveConnectorTools([mcpFs]).definitions.map((d) => d.name)
  assert.deepEqual(matchConnectorTools('list my stuff', fsTools), [], 'connector not named ⇒ no call (no guessing)')
  assert.deepEqual(matchConnectorTools('write a file via filesystem', []), [], 'no connector tools declared ⇒ no call')
})

test('runConnectorTool runs a READ through the injected fixture runtime; unknown → undefined', async () => {
  const { bindings } = deriveConnectorTools([slack])
  const activity = await runConnectorTool('connector__slack__list', bindings, 'act-1', {}, fixtureConnectorRuntime)
  assert.ok(activity, 'a derived tool executes')
  assert.equal(activity?.id, 'act-1')
  assert.equal(activity?.tool, 'connector__slack__list')
  assert.equal(activity?.connector, 'Slack')
  assert.equal(activity?.connectorId, 'conn-slack')
  assert.equal(activity?.kind, 'read')
  assert.equal(activity?.status, 'done', 'a read runs immediately')
  assert.match(activity?.summary ?? '', /#launch/)
  assert.equal(await runConnectorTool('mcp__nope__x', bindings, 'act-x', {}, fixtureConnectorRuntime), undefined, 'an unknown name falls through')
})

test('runConnectorTool only PROPOSES an interactive WRITE and retains its exact input', async () => {
  const { bindings } = deriveConnectorTools([mcpFs])
  const input = { path: 'notes/launch.md', content: 'Ship it' }
  const activity = await runConnectorTool('mcp__filesystem__write_file', bindings, 'act-2', input, fixtureConnectorRuntime)
  assert.equal(activity?.kind, 'action')
  assert.equal(activity?.status, 'proposed', 'a write is not executed — it awaits consent')
  assert.match(activity?.summary ?? '', /Proposed:.*write_file/, 'the summary describes the proposed effect, not a result')
  assert.deepEqual(activity?.input, input, 'confirmation can execute exactly what the model proposed')
})

test('a routine standing approval executes the same WRITE action without a new prompt', async () => {
  const { bindings } = deriveConnectorTools([mcpFs], { standingApprovedContextIds: new Set([mcpFs.id]) })
  const activity = await runConnectorTool('mcp__filesystem__write_file', bindings, 'act-standing', {}, fixtureConnectorRuntime)
  assert.equal(activity?.kind, 'action')
  assert.equal(activity?.status, 'done')
  assert.match(activity?.summary ?? '', /write_file completed on MCP · filesystem/)
})

test('an unavailable release runtime records a failed activity and never claims completion', async () => {
  const { bindings } = deriveConnectorTools([slack])
  const activity = await runConnectorTool('connector__slack__list', bindings, 'act-release', {}, unconfiguredConnectorRuntime)
  assert.equal(activity?.status, 'failed')
  assert.equal(activity?.failure?.code, 'connector_unconfigured')
  assert.equal(activity?.failure?.retryable, false)
  assert.doesNotMatch(activity?.summary ?? '', /\(mock\)/, 'release failure never leaks fixture success copy')
})

test('oversized model input becomes failed provenance without reaching the runtime', async () => {
  let calls = 0
  const runtime = {
    mode: 'adapter' as const,
    async execute() {
      calls += 1
      return { ok: true as const, summary: 'should not run' }
    },
  }
  const { bindings } = deriveConnectorTools([mcpFs])
  const activity = await runConnectorTool(
    'mcp__filesystem__write_file',
    bindings,
    'act-large',
    { content: 'x'.repeat(MAX_CONNECTOR_INPUT_CHARS + 1) },
    runtime,
  )
  assert.equal(activity?.status, 'failed')
  assert.match(activity?.summary ?? '', /safety limit/i)
  assert.equal(activity?.input, undefined, 'the oversized body is not persisted into provenance')
  assert.equal(calls, 0)
})
