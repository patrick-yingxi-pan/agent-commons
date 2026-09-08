import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMcpParameterHeaders,
  encodeMcpHeaderValue,
  McpHeaderParameterError,
  parseMcpHeaderParameters,
} from './mcpHeaderParameters.ts'

const invalid = (fn: () => unknown) => {
  assert.throws(fn, (error: unknown) => error instanceof McpHeaderParameterError &&
    error.message === 'Invalid MCP header parameter definition.')
}

test('parses nested static properties and ignores inert example data', () => {
  const plan = parseMcpHeaderParameters({
    type: 'object',
    examples: [{ 'x-mcp-header': 'Ignored', type: 'string' }],
    properties: {
      outer: {
        type: 'object',
        properties: {
          token: { type: 'string', 'x-mcp-header': 'X-Token' },
          count: { type: 'integer', 'x-mcp-header': 'X-Count' },
        },
      },
      enabled: { type: 'boolean', 'x-mcp-header': 'X-Enabled' },
    },
  })
  assert.deepEqual(plan, [
    { name: 'X-Token', path: ['outer', 'token'], type: 'string' },
    { name: 'X-Count', path: ['outer', 'count'], type: 'integer' },
    { name: 'X-Enabled', path: ['enabled'], type: 'boolean' },
  ])
})

test('rejects annotations outside a static properties path', () => {
  const cases = [
    { type: 'string', 'x-mcp-header': 'Root' },
    { type: 'object', items: { type: 'string', 'x-mcp-header': 'Items' } },
    { type: 'object', allOf: [{ type: 'string', 'x-mcp-header': 'All' }] },
    { type: 'object', anyOf: [{ type: 'string', 'x-mcp-header': 'Any' }] },
    { type: 'object', oneOf: [{ type: 'string', 'x-mcp-header': 'One' }] },
    { type: 'object', if: { 'x-mcp-header': 'If', type: 'string' } },
    { type: 'object', then: { 'x-mcp-header': 'Then', type: 'string' } },
    { type: 'object', else: { 'x-mcp-header': 'Else', type: 'string' } },
    { type: 'object', $defs: { saved: { type: 'string', 'x-mcp-header': 'Def' } } },
    { type: 'object', properties: { value: { items: { type: 'string', 'x-mcp-header': 'NestedItems' } } } },
  ]
  for (const schema of cases) invalid(() => parseMcpHeaderParameters(schema))
})

test('rejects malformed annotation names, types, duplicates, and count overflow', () => {
  invalid(() => parseMcpHeaderParameters({ type: 'object', properties: { x: { type: 'number', 'x-mcp-header': 'X' } } }))
  invalid(() => parseMcpHeaderParameters({ type: 'object', properties: { x: { type: 'string', 'x-mcp-header': 'bad name' } } }))
  invalid(() => parseMcpHeaderParameters({
    type: 'object', properties: {
      a: { type: 'string', 'x-mcp-header': 'X-Header' },
      b: { type: 'string', 'x-mcp-header': 'x-header' },
    },
  }))
  const properties: Record<string, unknown> = {}
  for (let index = 0; index < 33; index += 1) properties[`p${index}`] = { type: 'string', 'x-mcp-header': `X-${index}` }
  invalid(() => parseMcpHeaderParameters({ type: 'object', properties }))
})

test('encodes only values unsafe for HTTP field-values', () => {
  assert.equal(encodeMcpHeaderValue('plain'), 'plain')
  assert.equal(encodeMcpHeaderValue('middle space'), 'middle space')
  assert.equal(encodeMcpHeaderValue('middle\ttab'), 'middle\ttab')
  assert.equal(encodeMcpHeaderValue(' padded '), '=?base64?IHBhZGRlZCA=?=')
  assert.equal(encodeMcpHeaderValue('Hello, 世界'), '=?base64?SGVsbG8sIOS4lueVjA==?=')
  assert.equal(encodeMcpHeaderValue('line1\nline2'), '=?base64?bGluZTEKbGluZTI=?=')
  assert.equal(encodeMcpHeaderValue('=?base64?literal?='), '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=')
  invalid(() => encodeMcpHeaderValue('\uD800'))
})

test('extracts only own properties, omits absent/null, and preserves exact types', () => {
  const plan = parseMcpHeaderParameters({
    type: 'object', properties: {
      nested: { type: 'object', properties: {
        text: { type: 'string', 'x-mcp-header': 'Text' },
        count: { type: 'integer', 'x-mcp-header': 'Count' },
        enabled: { type: 'boolean', 'x-mcp-header': 'Enabled' },
        omitted: { type: 'string', 'x-mcp-header': 'Omitted' },
      } },
    },
  })
  const inherited = { text: 'inherited' }
  const args = Object.create({ nested: inherited }) as Record<string, unknown>
  args.nested = { text: 'hello 世界', count: -7, enabled: false, omitted: null }
  assert.deepEqual(buildMcpParameterHeaders(plan, args), {
    'Mcp-Param-Text': '=?base64?aGVsbG8g5LiW55WM?=',
    'Mcp-Param-Count': '-7',
    'Mcp-Param-Enabled': 'false',
  })
  assert.deepEqual(buildMcpParameterHeaders(plan, { nested: { text: 'x' } }), { 'Mcp-Param-Text': 'x' })
  assert.deepEqual(buildMcpParameterHeaders(plan, { nested: null }), {})
  invalid(() => buildMcpParameterHeaders(plan, { nested: { count: 1.5 } }))
  invalid(() => buildMcpParameterHeaders(plan, { nested: { enabled: 'false' } }))
  invalid(() => buildMcpParameterHeaders(plan, { nested: { count: Number.MAX_SAFE_INTEGER + 1 } }))
})

test('validates directly supplied plans and the aggregate encoded header budget', () => {
  invalid(() => buildMcpParameterHeaders([{ name: 'X', path: [], type: 'string' }], {}))
  invalid(() => buildMcpParameterHeaders([{ name: 'x bad', path: ['value'], type: 'string' }], { value: 'x' }))
  invalid(() => buildMcpParameterHeaders([{ name: 'X', path: ['value'], type: 'number' }], { value: 1 }))
  invalid(() => buildMcpParameterHeaders([{ name: 'X', path: ['value'], type: 'string' }], { value: 'a'.repeat(16_380) }))
  const inherited = Object.create({ name: 'X', path: ['value'], type: 'string' })
  invalid(() => buildMcpParameterHeaders([inherited], { value: 'x' }))
})

test('snapshots schema and plan inputs without invoking accessors or accepting oversized input', () => {
  let schemaGetterCalled = false
  const schema = { type: 'object', properties: {} as Record<string, unknown> }
  Object.defineProperty(schema, 'default', {
    enumerable: true,
    get() { schemaGetterCalled = true; throw new Error('must not run') },
  })
  invalid(() => parseMcpHeaderParameters(schema))
  assert.equal(schemaGetterCalled, false)

  invalid(() => parseMcpHeaderParameters({ type: 'object', default: 'x'.repeat(65_536) }))

  let argsGetterCalled = false
  const args = {}
  Object.defineProperty(args, 'value', {
    enumerable: true,
    get() { argsGetterCalled = true; throw new Error('must not run') },
  })
  const plan = [{ name: 'Value', path: ['value'], type: 'string' as const }]
  invalid(() => buildMcpParameterHeaders(plan, args))
  assert.equal(argsGetterCalled, false)
})
