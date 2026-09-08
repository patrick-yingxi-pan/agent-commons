import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpSseDecoder,
  MAX_MCP_SSE_EVENT_BYTES,
  McpResponseError,
  parseRpcResponse,
  rpcResponse,
} from './mcpHttpResponse.ts'

const response = (id: string | number = 7) => ({ jsonrpc: '2.0', id, result: { ok: true } })
const frame = (value: unknown, separator = '\n') => `data: ${JSON.stringify(value)}${separator}${separator}`
const throwsResponse = (fn: () => unknown) => assert.throws(fn, McpResponseError)

test('JSON responses require strict correlation and exactly one result or error', () => {
  const ok = response(17)
  assert.deepEqual(rpcResponse(ok, 17), ok)
  assert.deepEqual(parseRpcResponse(JSON.stringify(ok), 17), ok)

  const error = { jsonrpc: '2.0', id: 17, error: { code: -32001, message: 'declined', data: { retryable: true } } }
  assert.deepEqual(rpcResponse(error, 17), error)
  assert.deepEqual(rpcResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid' } }, 17, true).id, null)

  for (const invalid of [
    null,
    [],
    { jsonrpc: '1.0', id: 17, result: {} },
    { jsonrpc: '2.0', id: '17', result: {} },
    { jsonrpc: '2.0', id: 18, result: {} },
    { jsonrpc: '2.0', id: 17 },
    { jsonrpc: '2.0', id: 17, result: {}, error: { code: -1, message: 'both' } },
    { jsonrpc: '2.0', id: 17, result: {}, method: 'notifications/progress' },
    { jsonrpc: '2.0', id: 17, error: { code: 1 } },
    { jsonrpc: '2.0', id: 17, error: { code: '1', message: 'wrong code type' } },
    { jsonrpc: '2.0', id: null, result: {} },
  ]) throwsResponse(() => rpcResponse(invalid, 17))

  throwsResponse(() => rpcResponse({ jsonrpc: '2.0', id: null, error: { code: -1, message: 'not allowed' } }, 17))
  throwsResponse(() => rpcResponse({ jsonrpc: '2.0', id: null, error: { code: -1, message: 'not a result' } }, 17, false))
  throwsResponse(() => parseRpcResponse('{"jsonrpc":"2.0",', 17))
  throwsResponse(() => parseRpcResponse(JSON.stringify([ok]), 17))
  throwsResponse(() => parseRpcResponse(JSON.stringify(ok), '17'))
})

test('SSE accepts LF, CR, CRLF, and CRLF split across chunks', () => {
  for (const separator of ['\n', '\r', '\r\n']) {
    const decoder = createMcpSseDecoder(7)
    assert.deepEqual(decoder.push(frame(response(), separator)), response())
  }

  const stream = frame(response(), '\r\n')
  const split = stream.indexOf('\r') + 1
  const decoder = createMcpSseDecoder(7)
  assert.equal(decoder.push(stream.slice(0, split)), undefined)
  assert.deepEqual(decoder.push(stream.slice(split)), response())
})

test('SSE joins multiline data fields before parsing JSON', () => {
  const decoder = createMcpSseDecoder(17)
  const stream = [
    'data: {"jsonrpc":"2.0",\n',
    'data: "id":17,\n',
    'data: "result":{"text":"multiline"}}\n',
    '\n',
  ].join('')
  assert.deepEqual(decoder.push(stream), { jsonrpc: '2.0', id: 17, result: { text: 'multiline' } })
})

test('SSE ignores protocol notifications but refuses server requests and notification-shaped results', () => {
  const decoder = createMcpSseDecoder(9)
  const notification = { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 0.5 } }
  assert.equal(decoder.push(frame(notification)), undefined)
  assert.deepEqual(decoder.push(frame(response(9))), response(9))

  for (const request of [
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'notifications/progress', params: {} },
    { jsonrpc: '2.0', method: 'notifications/progress', result: {} },
    { jsonrpc: '2.0', method: 'notifications/progress', error: { code: -1, message: 'bad' } },
    { jsonrpc: '2.0', method: 12 },
  ]) throwsResponse(() => createMcpSseDecoder(9).push(frame(request)))
})

test('SSE rejects invalid JSON and JSON-RPC batches', () => {
  throwsResponse(() => createMcpSseDecoder(1).push('data: not-json\n\n'))
  throwsResponse(() => createMcpSseDecoder(1).push(`data: ${JSON.stringify([response(1)])}\n\n`))
  throwsResponse(() => createMcpSseDecoder(1).push(`data: ${JSON.stringify({ jsonrpc: '1.0', id: 1, result: {} })}\n\n`))
  throwsResponse(() => createMcpSseDecoder(1).push(`data: ${JSON.stringify(response(2))}\n\n`))
})

test('SSE treats EOF before a blank-line dispatch as incomplete', () => {
  const decoder = createMcpSseDecoder(3)
  assert.equal(decoder.push(`data: ${JSON.stringify(response(3))}\n`), undefined)
  throwsResponse(() => decoder.end())

  const notificationOnly = createMcpSseDecoder(3)
  notificationOnly.push(frame({ jsonrpc: '2.0', method: 'notifications/message' }))
  throwsResponse(() => notificationOnly.end())
})

test('SSE event byte bound counts UTF-8 bytes, including Unicode data', () => {
  const encodedBytes = (text: string) => new TextEncoder().encode(text).byteLength
  const make = (count: number) => frame({ jsonrpc: '2.0', id: 1, result: { text: '😀'.repeat(count) } })
  let low = 0
  let high = MAX_MCP_SSE_EVENT_BYTES
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (encodedBytes(make(middle)) <= MAX_MCP_SSE_EVENT_BYTES) low = middle
    else high = middle - 1
  }
  assert.ok(low > 0)
  assert.ok(encodedBytes(make(low)) <= MAX_MCP_SSE_EVENT_BYTES)
  assert.ok(encodedBytes(make(low + 1)) > MAX_MCP_SSE_EVENT_BYTES)
  assert.deepEqual(createMcpSseDecoder(1).push(make(low)), { jsonrpc: '2.0', id: 1, result: { text: '😀'.repeat(low) } })
  throwsResponse(() => createMcpSseDecoder(1).push(make(low + 1)))
})

test('a completed decoder cannot accept trailing input', () => {
  const decoder = createMcpSseDecoder(5)
  assert.deepEqual(decoder.push(frame(response(5))), response(5))
  throwsResponse(() => decoder.push(frame(response(5))))
})

test('SSE event budget includes both bytes of CRLF, even across chunks', () => {
  const comments = ':\r\n'.repeat(Math.ceil(MAX_MCP_SSE_EVENT_BYTES / 3))
  throwsResponse(() => createMcpSseDecoder(1).push(comments))
  const decoder = createMcpSseDecoder(1)
  throwsResponse(() => {
    for (const char of comments) decoder.push(char)
  })
})
