import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import type { Commission, OpenSubGoal, Project } from '../contract/index.ts'
import { projectWorkMcpDraftBindingText } from '../contract/projectWorkMcpDraft.ts'
import { prepareProjectWorkMcpDraft } from './projectWorkMcpDraft.ts'
import { projectWorkDraftPrompt } from './projectWorkDraft.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { ValidationError } from './conflict.ts'

const tenantId = 'draft-tenant'
const userId = 'draft-person'
const selection = { connectionId: `mcp-connection-${'a'.repeat(32)}`, connectionRevision: 2, toolName: 'write_record' }
const tool = { name: selection.toolName, description: 'Propose one record.', inputSchema: {
  type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false,
} }
const project = { name: 'Shared work', description: 'Visible facts', instructions: 'Visible instructions' } as Project
const item = { type: 'mcp.mutate', target: tool.name, status: 'open', subGoal: 'Write a reviewed record', note: 'Keep it concise.' } as OpenSubGoal
const commission = { role: 'reader' } as Commission

function fixture(local = false) {
  const row: any = { id: selection.connectionId, tenantId, label: 'Selected writer', revision: 2, connected: true,
    ...(local ? { transport: 'stdio', ownerUserId: userId, grantReference: `MCP_STDIO_${'B'.repeat(32)}` }
      : { authentication: 'none', endpoint: 'https://private-server.invalid' }),
    inspection: { tools: [structuredClone(tool)], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] } } }
  const store: any = {
    privateMcpConnection: () => structuredClone(row),
    mcpConnection: () => ({ id: row.id, label: row.label, revision: row.revision, tools: row.inspection.tools,
      status: row.connected ? 'connected' : 'disconnected', execution: 'approval-required', executableTools: [tool.name],
      ...(local ? { transport: 'stdio' } : {}) }),
  }
  return { row, store }
}

test('MCP drafting binds exact caller and inspected tool without retaining private launch authority', () => {
  for (const local of [false, true]) {
    const { row, store } = fixture(local)
    const prepared = prepareProjectWorkMcpDraft(store, tenantId, userId, selection, item)
    assert.deepEqual(prepared.tool, tool)
    assert.deepEqual(prepared.preview, { connectionLabel: row.label, toolName: tool.name,
      bindingHash: createHash('sha256').update(projectWorkMcpDraftBindingText(tenantId, userId, selection, tool)).digest('hex'),
      ...(local ? { transport: 'stdio' } : {}) })
    assert.doesNotMatch(JSON.stringify(prepared), /MCP_STDIO_|grantReference|private-server|draft-person|mcp-connection-/)
    prepared.tool.inputSchema.properties!.title = { type: 'number' }
    assert.equal(row.inspection.tools[0].inputSchema.properties.title.type, 'string', 'prompt input is detached')
  }
})

test('MCP drafting refuses absent or wrong caller, stale selection, closed/wrong work and lost catalog authority', () => {
  const { store, row } = fixture(true)
  for (const owner of [undefined, '', 'workspace-peer']) {
    assert.throws(() => prepareProjectWorkMcpDraft(store, tenantId, owner, selection, item), ValidationError)
  }
  assert.throws(() => prepareProjectWorkMcpDraft(store, 'foreign', userId, selection, item), ValidationError)
  for (const changed of [{ ...item, status: 'done' }, { ...item, type: 'read' }, { ...item, target: 'other' }]) {
    assert.throws(() => prepareProjectWorkMcpDraft(store, tenantId, userId, selection, changed as OpenSubGoal), ValidationError)
  }
  assert.throws(() => prepareProjectWorkMcpDraft(store, tenantId, userId, { ...selection, connectionRevision: 1 }, item), ValidationError)
  row.inspection.schemaAdmission.hashes = []
  assert.throws(() => prepareProjectWorkMcpDraft(store, tenantId, userId, selection, item), ValidationError)
})

test('the tool-free model prompt carries complete allowed facts and exact schema, never a callable tool or hidden registry', () => {
  const prepared = prepareProjectWorkMcpDraft(fixture(true).store, tenantId, userId, selection, item)
  const prompt = projectWorkDraftPrompt(project, item, commission, prepared)
  assert.match(prompt.detail, /one JSON object/)
  assert.match(prompt.detail, /"toolName"/)
  assert.match(prompt.detail, /no tools or external access/i)
  const facts = JSON.parse(prompt.detail.slice(prompt.detail.indexOf('\n\n') + 2))
  assert.deepEqual(facts.selectedTool, { connectionLabel: 'Selected writer', transport: 'stdio',
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
  assert.deepEqual(facts.project, { name: project.name, description: project.description, instructions: project.instructions })
  assert.doesNotMatch(prompt.detail, /bindingHash|connectionId|grantReference|ownerUserId|draft-person/)
  assert.throws(() => projectWorkDraftPrompt(project, item, commission, {
    ...prepared, tool: { ...tool, description: 'x'.repeat(16_000) },
  }), ValidationError, 'oversized schema/source is refused whole, not truncated')
})
