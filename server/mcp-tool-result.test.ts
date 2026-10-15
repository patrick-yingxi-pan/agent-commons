import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MCP_TOOL_RESULT_LEGACY_VERSIONS,
  MCP_TOOL_RESULT_MODERN_VERSION,
  McpToolResultError,
  parseMcpToolResult,
} from './mcpToolResult.ts'

const image = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png; charset=binary' }
const audio = { type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' }

test('parses a modern complete result and detaches structured JSON', () => {
  const source = { resultType: 'complete', content: [{ type: 'text', text: 'ok' }], structuredContent: { answer: ['one'] }, isError: true }
  const result = parseMcpToolResult(source, MCP_TOOL_RESULT_MODERN_VERSION)
  assert.equal(result.isError, true)
  assert.deepEqual(result.content, [{ type: 'text', text: 'ok' }])
  source.structuredContent.answer[0] = 'mutated'
  assert.deepEqual(result.structuredContent, { answer: ['one'] })
})

test('accepts multiline text and valid astral Unicode without invoking remote getters', () => {
  const source: Record<string, unknown> = { resultType: 'complete' }
  let touched = false
  Object.defineProperty(source, 'content', { enumerable: true, get() { touched = true; return [{ type: 'text', text: 'line one\n\tline two 🦦' }] } })
  assert.throws(() => parseMcpToolResult(source, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.equal(touched, false)
  const result = parseMcpToolResult({ resultType: 'complete', content: [{ type: 'text', text: 'line one\n\tline two 🦦' }] }, MCP_TOOL_RESULT_MODERN_VERSION)
  assert.equal((result.content[0] as { text: string }).text, 'line one\n\tline two 🦦')
})

test('preserves JSON control characters in body text while keeping presentation metadata strict', () => {
  const controls = [...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => index + 127)]
  const body = `start${String.fromCharCode(...controls)} café 🧪 end`
  for (const version of [...MCP_TOOL_RESULT_LEGACY_VERSIONS, MCP_TOOL_RESULT_MODERN_VERSION]) {
    const complete = version === MCP_TOOL_RESULT_MODERN_VERSION ? { resultType: 'complete' } : {}
    const result = parseMcpToolResult({ ...complete, content: [
      { type: 'text', text: body },
      { type: 'resource', resource: { uri: 'urn:control-text', mimeType: 'text/plain', text: body } },
    ] }, version)
    assert.equal((result.content[0] as { text: string }).text, body, version)
    assert.equal((result.content[1] as { resource: { text: string } }).resource.text, body, version)
  }

  const invalidMetadata = [
    { type: 'resource_link', uri: 'https://example.test/file', name: 'bad\u0000name' },
    { type: 'resource_link', uri: 'https://example.test/file', name: 'file', title: 'bad\u001btitle' },
    { type: 'resource_link', uri: 'https://example.test/\u0000file', name: 'file' },
    { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png\u0000' },
    { type: 'text', text: 'body', annotations: { lastModified: '2026-10-15\u0085' } },
  ]
  for (const block of invalidMetadata) assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [block] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  for (const bodyWithInvalidSurrogate of ['unpaired\ud800', 'unpaired\udfff']) {
    assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'text', text: bodyWithInvalidSurrogate }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  }
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'resource', resource: {
    uri: 'urn:invalid-surrogate', text: 'unpaired\ud800',
  } }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
})

test('escaped control text still counts against the total JSON byte bound', () => {
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'text', text: '\u0000'.repeat(180_000) }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
})

test('accepts absent resultType only for supported legacy protocol versions', () => {
  for (const version of MCP_TOOL_RESULT_LEGACY_VERSIONS) {
    assert.equal(parseMcpToolResult({ content: [] }, version).isError, false)
  }
  assert.throws(() => parseMcpToolResult({ content: [] }, MCP_TOOL_RESULT_MODERN_VERSION), (error: unknown) => error instanceof McpToolResultError && error.code === 'result')
  assert.throws(() => parseMcpToolResult({ content: [] }, '2024-11-05'), (error: unknown) => error instanceof McpToolResultError && error.code === 'result')
})

test('rejects input_required without exposing remote payload or continuation data', () => {
  assert.throws(() => parseMcpToolResult({ resultType: 'input_required', inputRequests: { secret: 'do not copy' }, requestState: 'opaque' }, MCP_TOOL_RESULT_MODERN_VERSION), (error: unknown) => {
    assert.ok(error instanceof McpToolResultError)
    assert.equal(error.code, 'input_required')
    assert.equal(error.message, 'MCP tool input is required.')
    assert.equal(error.message.includes('secret'), false)
    return true
  })
})

test('preserves supported content blocks as inert data', () => {
  const result = parseMcpToolResult({ resultType: 'complete', content: [
    { type: 'text', text: 'hello', annotations: { audience: ['user'] } }, image, audio,
    { type: 'resource_link', uri: 'https://remote.invalid/a', name: 'remote', title: 'Remote', size: 5 },
    { type: 'resource', resource: { uri: 'urn:txt', mimeType: 'text/plain', text: 'embedded' } },
    { type: 'resource', resource: { uri: 'urn:blob', blob: 'aGVsbG8=' } },
  ] }, MCP_TOOL_RESULT_MODERN_VERSION)
  assert.equal(result.content.length, 6)
  assert.deepEqual(result.content[1], image)
  assert.deepEqual(result.content[2], audio)
  assert.equal((result.content[4] as any).resource.text, 'embedded')
  assert.equal((result.content[5] as any).resource.blob, 'aGVsbG8=')
})

test('defaults isError and rejects malformed blocks and primitive fields', () => {
  assert.equal(parseMcpToolResult({ resultType: 'complete', content: [] }, MCP_TOOL_RESULT_MODERN_VERSION).isError, false)
  const invalid = [
    { type: 'unknown', value: 1 }, { type: 'text', text: 1 }, { type: 'image', data: 'bad!', mimeType: 'image/png' },
    { type: 'audio', data: 'aGVsbG8=', mimeType: 2 }, { type: 'resource_link', uri: 'u', name: 4 },
    { type: 'resource', resource: { uri: 'u', text: 'x', blob: 'aGVsbG8=' } },
    { type: 'resource', resource: { uri: 'u', blob: 'bad!' } },
  ]
  for (const block of invalid) assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [block] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [], isError: 'false' }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'image', data: 'aGVsbG8=', mimeType: '' }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'resource_link', uri: 'not a URI', name: 'x' }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'text', text: 'x', annotations: 'remote primitive' }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
})

test('enforces content, JSON depth, node, and total-byte bounds without truncation', () => {
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: Array.from({ length: 129 }, () => ({ type: 'text', text: 'x' })) }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  let nested: any = 'leaf'
  for (let index = 0; index < 40; index += 1) nested = { next: nested }
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [], structuredContent: nested }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [{ type: 'text', text: 'x'.repeat(1_048_570) }] }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [], unknown: 'x'.repeat(1_048_570) }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
})

test('allows structured null and arrays while retaining only JSON data', () => {
  assert.equal(parseMcpToolResult({ resultType: 'complete', content: [], structuredContent: null }, MCP_TOOL_RESULT_MODERN_VERSION).structuredContent, null)
  assert.deepEqual(parseMcpToolResult({ resultType: 'complete', content: [], structuredContent: [1, 'two', false] }, MCP_TOOL_RESULT_MODERN_VERSION).structuredContent, [1, 'two', false])
  assert.throws(() => parseMcpToolResult({ resultType: 'complete', content: [], structuredContent: { bad: undefined } }, MCP_TOOL_RESULT_MODERN_VERSION), McpToolResultError)
})
