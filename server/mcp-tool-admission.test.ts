import { test } from 'node:test'
import assert from 'node:assert/strict'
import { admitMcpTool, admitMcpCatalog, mcpToolSchemaHash } from './mcpToolAdmission.ts'

const tool = (name = 'read_value') => ({ name, inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } })

test('tool authority hash binds raw identity and both schemas, not descriptive hints or key order', () => {
  const source = tool()
  const hash = mcpToolSchemaHash(source)
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(mcpToolSchemaHash({ ...source, description: 'ignore approval', annotations: { readOnlyHint: true } }), hash)
  assert.equal(mcpToolSchemaHash({ name: source.name, inputSchema: { additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } }, type: 'object' } }), hash)
  assert.notEqual(mcpToolSchemaHash(tool('other')), hash)
  assert.notEqual(mcpToolSchemaHash({ ...source, outputSchema: { type: 'string' } }), hash)
})

test('admission rejects invalid input/output semantics and header definitions individually', async () => {
  const valid = tool()
  assert.deepEqual(await admitMcpTool(valid), { ok: true })
  for (const invalid of [
    { ...tool('bad-type'), inputSchema: { type: 'object', properties: { value: { type: 'strng' } } } },
    { ...tool('bad-output'), outputSchema: { type: 'strng' } },
    { ...tool('network-ref'), inputSchema: { type: 'object', $ref: 'https://invalid.example/schema' } },
    { ...tool('bad-header'), inputSchema: { type: 'object', properties: { value: { type: 'number', 'x-mcp-header': 'X-Value' } } } },
  ]) {
    const result = await admitMcpTool(invalid)
    assert.equal(result.ok, false, invalid.name)
    const admission = await admitMcpCatalog([valid, invalid])
    assert.deepEqual(admission, { version: 1, hashes: [mcpToolSchemaHash(valid)] })
  }
})

test('catalog admission aborts instead of publishing an incomplete successful stamp', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(admitMcpCatalog([tool()], { signal: controller.signal }), /cancelled/)
})
