import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_CATALOG_CURSOR_MAX_CHARS,
  MCP_CATALOG_DESCRIPTION_MAX_CHARS,
  MCP_CATALOG_NAME_MAX_CHARS,
  MCP_CATALOG_PAGE_MAX_BYTES,
  MCP_CATALOG_PAGE_MAX_TOOLS,
  MCP_CATALOG_SCHEMA_MAX_BYTES,
  MCP_CATALOG_SCHEMA_MAX_DEPTH,
  MCP_CATALOG_SCHEMA_MAX_NODES,
  MCP_CATALOG_TITLE_MAX_CHARS,
  McpCatalogError,
  parseMcpToolsPage,
} from './mcpCatalog.ts'

const inputSchema = { type: 'object', properties: {}, additionalProperties: false }
const tool = (name = 'workspace_read') => ({ name, description: 'Read one workspace value.', inputSchema })

function rejects(value: unknown) {
  assert.throws(
    () => parseMcpToolsPage(value),
    (error: unknown) => {
      assert.ok(error instanceof McpCatalogError)
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Invalid MCP tool catalog.')
      return true
    },
  )
}

test('valid pages preserve fields and return a detached JSON snapshot', () => {
  const source = {
    tools: [{
      ...tool(),
      title: 'Workspace read',
      outputSchema: { type: 'string', $ref: '#/definitions/value' },
      annotations: { readOnlyHint: true, vendor: { opaque: ['value'] } },
    }],
    nextCursor: 'cursor-1',
  }
  const parsed = parseMcpToolsPage(source)
  assert.deepEqual(parsed, source)
  assert.notEqual(parsed.tools, source.tools)
  assert.notEqual(parsed.tools[0], source.tools[0])
  assert.notEqual(parsed.tools[0].inputSchema, source.tools[0].inputSchema)
  assert.notEqual(parsed.tools[0].annotations, source.tools[0].annotations)
  source.tools[0].name = 'mutated'
  source.tools[0].annotations.vendor.opaque[0] = 'changed'
  assert.equal(parsed.tools[0].name, 'workspace_read')
  assert.deepEqual(parsed.tools[0].annotations, { readOnlyHint: true, vendor: { opaque: ['value'] } })
})

test('page, tool, name, text, and cursor boundaries are exact', () => {
  assert.equal(MCP_CATALOG_PAGE_MAX_TOOLS, 128)
  assert.equal(parseMcpToolsPage({ tools: Array.from({ length: 128 }, (_, i) => tool(`tool-${i}`)) }).tools.length, 128)
  assert.equal(parseMcpToolsPage({ tools: [tool('😀'.repeat(MCP_CATALOG_NAME_MAX_CHARS))] }).tools[0].name.length, MCP_CATALOG_NAME_MAX_CHARS * 2)
  assert.equal(parseMcpToolsPage({ tools: [{ ...tool(), title: 't'.repeat(MCP_CATALOG_TITLE_MAX_CHARS), description: 'd'.repeat(MCP_CATALOG_DESCRIPTION_MAX_CHARS) }], nextCursor: 'c'.repeat(MCP_CATALOG_CURSOR_MAX_CHARS) }).nextCursor?.length, MCP_CATALOG_CURSOR_MAX_CHARS)

  rejects({ tools: Array.from({ length: 129 }, (_, i) => tool(`tool-${i}`)) })
  rejects({ tools: [tool('x'.repeat(MCP_CATALOG_NAME_MAX_CHARS + 1))] })
  rejects({ tools: [tool('')] })
  rejects({ tools: [tool('bad\u0000name')] })
  rejects({ tools: [{ ...tool(), title: 't'.repeat(MCP_CATALOG_TITLE_MAX_CHARS + 1) }] })
  rejects({ tools: [{ ...tool(), description: 'd'.repeat(MCP_CATALOG_DESCRIPTION_MAX_CHARS + 1) }] })
  rejects({ tools: [tool()], nextCursor: 'c'.repeat(MCP_CATALOG_CURSOR_MAX_CHARS + 1) })
  rejects({ tools: [tool()], nextCursor: '' })
})

test('required shape, duplicates, and malformed optional records reject the entire page', () => {
  for (const value of [
    null,
    [],
    {},
    { tools: null },
    { tools: [{ ...tool(), inputSchema: { type: 'string' } }] },
    { tools: [{ ...tool(), inputSchema: [] }] },
    { tools: [{ ...tool(), outputSchema: [] }] },
    { tools: [{ ...tool(), annotations: [] }] },
    { tools: [tool('same'), tool('same')] },
  ]) rejects(value)
})

test('modern protocol metadata and tool extensions are ignored after bounded snapshotting', () => {
  const page = parseMcpToolsPage({
    _meta: { ttlMs: 15_000, cacheScope: 'session' },
    resultType: 'tools',
    ttlMs: 15_000,
    cacheScope: 'session',
    tools: [{
      ...tool(),
      icons: [{ src: 'https://attacker.invalid/icon.svg', mimeType: 'image/svg+xml' }],
      _meta: { execution: { taskSupport: 'optional' } },
      execution: { taskSupport: 'optional' },
      futureExtension: { opaque: true },
    }],
  })
  assert.deepEqual(page, { tools: [tool()] })
  assert.equal('icons' in page.tools[0], false)
  assert.equal('execution' in page.tools[0], false)
  assert.equal('futureExtension' in page.tools[0], false)
})

test('tool descriptions allow ordinary multiline documentation but reject other controls', () => {
  const description = 'First line\r\n\tIndented details.'
  assert.equal(parseMcpToolsPage({ tools: [{ ...tool(), description }] }).tools[0].description, description)
  rejects({ tools: [{ ...tool(), description: 'bad\u000bcontrol' }] })
  rejects({ tools: [{ ...tool(), description: 'bad\u007fcontrol' }] })
})

test('schema byte, depth, and node budgets are exact for both schema fields', () => {
  const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`p${i}`, { type: 'string' }])) }
  rejects({ tools: [{ ...tool(), inputSchema: wide }] })

  const deep = { type: 'object' } as Record<string, unknown>
  let cursor = deep
  for (let i = 1; i < MCP_CATALOG_SCHEMA_MAX_DEPTH - 1; i++) cursor.next = { type: 'object' }, cursor = cursor.next as Record<string, unknown>
  assert.doesNotThrow(() => parseMcpToolsPage({ tools: [{ ...tool(), inputSchema: deep }] }))
  cursor.next = { type: 'object' }
  rejects({ tools: [{ ...tool(), inputSchema: deep }] })

  const large = { type: 'object', description: 'x'.repeat(MCP_CATALOG_SCHEMA_MAX_BYTES) }
  rejects({ tools: [{ ...tool(), inputSchema: large }] })
  rejects({ tools: [{ ...tool(), outputSchema: large }] })
})

test('page UTF-8 budget rejects oversized Unicode JSON and does not partially return tools', () => {
  const oversized = { tools: [tool(), { ...tool('second'), description: '😀'.repeat(MCP_CATALOG_PAGE_MAX_BYTES) }] }
  rejects(oversized)
})

test('schemas are inert data: refs and annotation hints are preserved, not followed or interpreted', () => {
  const page = parseMcpToolsPage({
    tools: [{
      ...tool(),
      inputSchema: { type: 'object', $ref: 'https://attacker.invalid/schema', properties: { secret: { type: 'string' } } },
      annotations: { destructiveHint: false, readOnlyHint: true, openWorldHint: true },
    }],
  })
  assert.equal((page.tools[0].inputSchema as any).$ref, 'https://attacker.invalid/schema')
  assert.deepEqual(page.tools[0].annotations, { destructiveHint: false, readOnlyHint: true, openWorldHint: true })
})
