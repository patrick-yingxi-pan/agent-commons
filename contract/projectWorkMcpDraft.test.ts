import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpDiscoveredTool } from './mcpConnections.ts'
import {
  parseProjectWorkMcpDraftPreview,
  parseProjectWorkMcpDraftReply,
  parseProjectWorkMcpDraftSelection,
  projectWorkMcpDraftBindingText,
} from './projectWorkMcpDraft.ts'
import { parseProjectWorkDraftInput } from './projectWorkDraft.ts'

const selection = () => ({ connectionId: 'mcp-connection-1', connectionRevision: 4, toolName: 'create_task' })
const preview = () => ({ connectionLabel: 'Task server', toolName: 'create_task', bindingHash: 'a'.repeat(64) })
const tool = (extra: Record<string, unknown> = {}): McpDiscoveredTool => ({
  name: 'create_task', description: 'ignored', annotations: { title: 'ignored' },
  inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  ...extra,
})

test('Project-work MCP selection and preview parse exact detached bounded records', () => {
  const selected = selection()
  const parsedSelection = parseProjectWorkMcpDraftSelection(selected)
  assert.deepEqual(parsedSelection, selected)
  assert.ok(parsedSelection)
  assert.notEqual(parsedSelection, selected)

  const shown = preview()
  const parsedPreview = parseProjectWorkMcpDraftPreview(shown)
  assert.deepEqual(parsedPreview, shown)
  assert.ok(parsedPreview)
  assert.notEqual(parsedPreview, shown)
  assert.deepEqual(parseProjectWorkMcpDraftPreview({ ...shown, transport: 'stdio' }), { ...shown, transport: 'stdio' })
})

test('Project-work MCP parsers reject missing, unknown, symbol, inherited, accessor, and undefined-present fields', () => {
  const valid = selection()
  const missing = { ...valid } as Record<string, unknown>
  delete missing.toolName
  const custom = Object.assign(Object.create({ hidden: true }), valid)
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'toolName', { get: () => 'create_task', enumerable: true })
  const symbol = { ...valid, [Symbol('hidden')]: true }
  const previewAccessor = preview()
  Object.defineProperty(previewAccessor, 'bindingHash', { get: () => 'a'.repeat(64), enumerable: true })
  for (const value of [null, undefined, [], missing, { ...valid, extra: true }, symbol, custom, accessor,
    { ...valid, connectionRevision: undefined }, { ...valid, toolName: '\ud800' },
    { ...valid, connectionId: 'x'.repeat(201) }, { ...valid, toolName: `x${'x'.repeat(128)}` },
    { ...valid, connectionRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(parseProjectWorkMcpDraftSelection(value), undefined)
  }
  assert.equal(parseProjectWorkMcpDraftSelection({ ...valid, connectionId: 'foreign-connection-1' }), undefined,
    'draft selections use the established external-MCP identity namespace')
  for (const value of [null, undefined, [], { ...preview(), extra: 1 }, { ...preview(), transport: undefined },
    { ...preview(), transport: 'http' }, previewAccessor, { ...preview(), bindingHash: 'A'.repeat(64) },
    { ...preview(), connectionLabel: 'x'.repeat(2_001) }, { ...preview(), toolName: '' }]) {
    assert.equal(parseProjectWorkMcpDraftPreview(value), undefined)
  }
})

test('Project-work input admits only an optional exact MCP selection and detaches it', () => {
  const base = {
    projectWork: { projectId: 'p', itemId: 'i', commissionId: 'c', expectedRevision: 2 },
    execution: { agentId: 'a', providerId: 'provider', modelId: 'model' },
    mcpProposal: selection(),
  }
  const parsed = parseProjectWorkDraftInput(base)
  assert.deepEqual(parsed, base)
  assert.ok(parsed)
  assert.notEqual(parsed.mcpProposal, base.mcpProposal)
  base.mcpProposal.toolName = 'changed'
  assert.equal(parsed.mcpProposal?.toolName, 'create_task')
  assert.equal(parseProjectWorkDraftInput({ ...base, mcpProposal: { ...selection(), transport: 'stdio' } }), undefined)
  assert.equal(parseProjectWorkDraftInput({ ...base, mcpProposal: undefined }), undefined)
  assert.equal(parseProjectWorkDraftInput({ ...base, title: 'not accepted' }), undefined)
  const accessor = { ...base }
  Object.defineProperty(accessor, 'mcpProposal', { get: () => selection(), enumerable: true })
  assert.equal(parseProjectWorkDraftInput(accessor), undefined)
})

test('binding text is canonical over identity and admitted schemas, but ignores presentation metadata', () => {
  const first = projectWorkMcpDraftBindingText('tenant-a', 'person-a', selection(), tool())
  const reordered = projectWorkMcpDraftBindingText('tenant-a', 'person-a', selection(), tool({
    title: 'Different title', description: 'Different description', annotations: { x: 2 },
    inputSchema: { required: ['title'], properties: { title: { type: 'string' } }, type: 'object' },
  }))
  assert.equal(first, reordered)
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-b', 'person-a', selection(), tool()))
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-a', 'person-b', selection(), tool()))
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-a', 'person-a', { ...selection(), connectionRevision: 5 }, tool()))
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-a', 'person-a', { ...selection(), connectionId: 'mcp-connection-2' }, tool()))
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-a', 'person-a', { ...selection(), toolName: 'different' },
    tool({ name: 'different' })))
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-a', 'person-a', selection(), tool({
    inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1 } } },
  })))
  assert.notEqual(first, projectWorkMcpDraftBindingText('tenant-a', 'person-a', selection(), tool({
    outputSchema: { type: 'object' },
  })))
})

test('tool-name bounds count Unicode code points like existing Contribution admission', () => {
  const name = '🛠'.repeat(128)
  assert.equal(name.length, 256)
  assert.ok(parseProjectWorkMcpDraftSelection({ ...selection(), toolName: name }))
  assert.ok(parseProjectWorkMcpDraftPreview({ ...preview(), toolName: name }))
  assert.equal(parseProjectWorkMcpDraftSelection({ ...selection(), toolName: `${name}x` }), undefined)
})

test('binding text reads only valid data schemas and preserves exact Unicode identity', () => {
  assert.equal(projectWorkMcpDraftBindingText('ténant', '用戶', selection(), tool()).includes('用戶'), true)
  const accessorSchema = { type: 'object' }
  Object.defineProperty(accessorSchema, 'properties', { get: () => ({}) })
  assert.throws(() => projectWorkMcpDraftBindingText('tenant-a', 'person-a', selection(), tool({ inputSchema: accessorSchema })))
  assert.throws(() => projectWorkMcpDraftBindingText('tenant-a', 'person-a', selection(), tool({ inputSchema: { type: undefined } })))
})

test('draft reply accepts only the expected tool and bounded JSON arguments', () => {
  assert.deepEqual(parseProjectWorkMcpDraftReply('{"toolName":"create_task","arguments":{"title":"Café ☕"}}', 'create_task'),
    { ok: true, arguments: { title: 'Café ☕' } })
  const escapedContent = JSON.stringify({ toolName: 'create_task', arguments: { text: 'quote " brace } comma , slash \\' } })
  assert.equal(parseProjectWorkMcpDraftReply(escapedContent, 'create_task').ok, true,
    'escaped punctuation inside JSON strings is not treated as structural syntax')
  for (const text of [
    '```json\n{"toolName":"create_task","arguments":{}}\n```',
    '{"toolName":"other","arguments":{}}',
    '{"toolName":"create_task","arguments":{},"extra":true}',
    '{"toolName":"create_task","arguments":[]}',
    '{"toolName":"create_task","arguments":{"x":1,"x":2}}',
    '{"toolName":"create_task","arguments":{"x":1e400}}',
    '{"toolName":"create_task","arguments":{"x":"\\ud800"}}',
    '{"toolName":"create_task","arguments":{"a":1,"\\u0061":2}}',
    '{"toolName":"create_task","arguments":{}',
    '{"toolName":"create_task","arguments":{"x":1}} trailing',
  ]) assert.equal(parseProjectWorkMcpDraftReply(text, 'create_task').ok, false, text)

  assert.equal(parseProjectWorkMcpDraftReply(`{"toolName":"create_task","arguments":{"x":"${'x'.repeat(48 * 1024)}"}}`, 'create_task').ok, false)
  assert.equal(parseProjectWorkMcpDraftReply(`{"toolName":"create_task","arguments":{"x":"${'x'.repeat(65 * 1024)}"}}`, 'create_task').ok, false)
  const deepArguments = `${'['.repeat(33)}0${']'.repeat(33)}`
  assert.equal(parseProjectWorkMcpDraftReply(`{"toolName":"create_task","arguments":{"x":${deepArguments}}}`, 'create_task').ok, false)
  assert.equal(parseProjectWorkMcpDraftReply(`{"toolName":"create_task","arguments":${JSON.stringify(Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`k${i}`, i])))}}`, 'create_task').ok, false)
})
