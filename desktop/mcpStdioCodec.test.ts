import assert from 'node:assert/strict'
import test from 'node:test'
import { MCP_STDIO_LIMITS, McpStdioCodecError, createMcpStdioDecoder, encodeMcpStdioMessage } from './mcpStdioCodec.mjs'

test('stdio codec handles fragmented UTF-8, CRLF, and detached retained chunks', () => {
  const decoder = createMcpStdioDecoder()
  const wire = Buffer.from('{"text":"café"}\r\n')
  const split = wire.indexOf(Buffer.from('é')) + 1
  const first = Buffer.from(wire.subarray(0, split))
  assert.deepEqual(decoder.push(first), [])
  first.fill(0)
  assert.deepEqual(decoder.push(wire.subarray(split)), [{ text: 'café' }])
  decoder.end()
})

test('stdio codec rejects invalid UTF-8, BOM, blank frames, batches, scalars, and trailing partial EOF', () => {
  for (const bytes of [Buffer.from([0xff, 0x0a]), Buffer.from('\ufeff{}\n'), Buffer.from(' \t\r\n'), Buffer.from('[{}]\n'), Buffer.from('null\n')]) {
    assert.throws(() => createMcpStdioDecoder().push(bytes), (error: unknown) =>
      error instanceof McpStdioCodecError && error.code === 'invalid-message')
  }
  const partial = createMcpStdioDecoder()
  assert.deepEqual(partial.push(Buffer.from('{"incomplete":')), [])
  assert.throws(() => partial.end(), (error: unknown) => error instanceof McpStdioCodecError && error.code === 'invalid-message')
})

test('stdio codec applies per-frame, cumulative-byte, and message-count budgets', () => {
  const { maxFrameBytes, maxTotalBytes, maxMessages } = MCP_STDIO_LIMITS
  const exactFrame = (bytes: number) => Buffer.from(`{"text":"${'x'.repeat(bytes - 12)}"}\n`)
  assert.equal(exactFrame(maxFrameBytes).byteLength, maxFrameBytes)
  assert.deepEqual(createMcpStdioDecoder().push(exactFrame(maxFrameBytes)), [{ text: 'x'.repeat(maxFrameBytes - 12) }])
  assert.throws(() => createMcpStdioDecoder().push(exactFrame(maxFrameBytes + 1)), (error: unknown) =>
    error instanceof McpStdioCodecError && error.code === 'limit')

  const cumulative = createMcpStdioDecoder()
  for (let index = 0; index < maxTotalBytes / maxFrameBytes; index++) {
    assert.equal(cumulative.push(exactFrame(maxFrameBytes)).length, 1)
  }
  assert.throws(() => cumulative.push(Buffer.from('\n')), (error: unknown) => error instanceof McpStdioCodecError && error.code === 'limit')

  const messages = createMcpStdioDecoder()
  for (let index = 0; index < maxMessages; index++) assert.equal(messages.push(Buffer.from('{}\n')).length, 1)
  assert.throws(() => messages.push(Buffer.from('{}\n')), (error: unknown) => error instanceof McpStdioCodecError && error.code === 'limit')
})

test('stdio codec uses shared depth/node snapshot limits and refuses shared backing stores', () => {
  const nested = `{"nested":${'['.repeat(MCP_STDIO_LIMITS.maxDepth)}0${']'.repeat(MCP_STDIO_LIMITS.maxDepth)}}\n`
  assert.throws(() => createMcpStdioDecoder().push(Buffer.from(nested)), (error: unknown) => error instanceof McpStdioCodecError && error.code === 'limit')
  const many = `{"items":[${Array.from({ length: MCP_STDIO_LIMITS.maxNodes }, () => '0').join(',') }]}\n`
  assert.throws(() => createMcpStdioDecoder().push(Buffer.from(many)), (error: unknown) => error instanceof McpStdioCodecError && error.code === 'limit')
  const shared = new SharedArrayBuffer(8)
  assert.throws(() => createMcpStdioDecoder().push(Buffer.from(shared)), (error: unknown) => error instanceof McpStdioCodecError && error.code === 'invalid-message')
})

test('stdio encoder snapshots JSON objects, appends one newline, and never invokes accessors or toJSON', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"nested":[1,"world"]}')
  const encoded = encodeMcpStdioMessage(source)
  assert.equal(encoded.at(-1), 0x0a)
  assert.deepEqual(createMcpStdioDecoder().push(encoded), [source])
  source.nested[1] = 'changed'
  assert.deepEqual(createMcpStdioDecoder().push(encoded), [JSON.parse('{"__proto__":{"polluted":true},"nested":[1,"world"]}')])

  let invoked = 0
  const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get() { invoked++; return 'private' } })
  const hook = { toJSON() { invoked++; return {} } }
  for (const value of [accessor, hook, [], null, 'scalar']) {
    assert.throws(() => encodeMcpStdioMessage(value), McpStdioCodecError)
  }
  assert.equal(invoked, 0)
  assert.throws(() => encodeMcpStdioMessage({ text: 'x'.repeat(MCP_STDIO_LIMITS.maxFrameBytes) }), McpStdioCodecError)
})
