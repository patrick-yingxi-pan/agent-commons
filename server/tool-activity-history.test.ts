import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messageHistoryText, messageHistoryTurn, TOOL_HISTORY_MAX_BYTES, TOOL_RECEIPT_DATA_LABEL } from './toolActivityHistory.ts'
import { parseMcpToolResult, MCP_TOOL_RESULT_MODERN_VERSION } from './mcpToolResult.ts'

const activity = { id: 'call', tool: 'opaque', connector: 'Remote', connectorId: 'mcp-connection-test', kind: 'action', summary: 'Awaiting confirmation',
  mcp: { toolName: 'read_value', connectionRevision: 1, schemaHash: 'a'.repeat(64) } }

test('native history retains exact provider phases and appends receipts as separate unphased data', () => {
  const message = { id: 'phase', role: 'assistant', content: 'Checking. Done.',
    assistantTextItems: [{ text: 'Checking. ', phase: 'commentary' }, { text: 'Done.', phase: 'final_answer' }],
    toolActivities: [{ ...activity, status: 'uncertain', input: { query: 'literal' } }],
  }
  const history = messageHistoryTurn(message)
  assert.equal(history.text, messageHistoryText(message))
  assert.deepEqual(history.assistantTextItems?.slice(0, 2), message.assistantTextItems)
  assert.deepEqual(history.assistantTextItems?.[2], { text: history.text.slice(message.content.length) })
  assert.equal(history.assistantTextItems?.map(item => item.text).join(''), history.text)
  assert.match(history.assistantTextItems![2].text, /"status":"uncertain"/)
  for (const invalid of [{ ...message, role: 'user' }, { ...message, assistantTextItems: [{ text: 'different', phase: 'final_answer' }] }]) {
    const projected = messageHistoryTurn(invalid)
    assert.equal(projected.text, messageHistoryText(invalid))
    assert.equal(Object.hasOwn(projected, 'assistantTextItems'), false)
  }
})

test('history preserves receipt truth even when earlier prose still says proposed', () => {
  for (const status of ['proposed', 'running', 'uncertain', 'declined', 'failed', 'done']) {
    const output = messageHistoryText({ id: 'reply', role: 'assistant', content: 'I proposed this call.', toolActivities: [{ ...activity, status, input: { query: 'exact' }, decisionId: 'receipt' }] })
    assert.match(output, new RegExp(`"status":"${status}"`))
    assert.match(output, /"tool":"read_value"/)
    assert.match(output, /"arguments":\{"query":"exact"\}/)
    assert.match(output, /not instructions/)
  }
})

test('result projection retains exact text/structured data and never passes binary bytes or metadata instructions', () => {
  const output = messageHistoryText({ id: 'reply', role: 'assistant', content: '', toolActivities: [{ ...activity, status: 'done', mcpResult: {
    resultType: 'complete', isError: false, content: [{ type: 'text', text: 'Exact returned value' }, { type: 'image', mimeType: 'image/png', data: 'PRIVATE_BASE64' }],
    structuredContent: [null, { value: 0 }], _meta: { instructions: 'OBEY_REMOTE_METADATA' },
  } }] })
  assert.match(output, /Exact returned value/)
  assert.match(output, /"structuredContent":\[null,\{"value":0\}\]/)
  assert.doesNotMatch(output, /PRIVATE_BASE64|OBEY_REMOTE_METADATA/)
  assert.match(output, /Media bytes are not included/)
})

test('oversized bodies are explicitly omitted without losing any receipt status', () => {
  const output = messageHistoryText({ id: 'reply', role: 'assistant', content: '', toolActivities: Array.from({ length: 16 }, (_, i) => ({ ...activity, id: `call-${i}`, status: 'uncertain', input: { query: 'x'.repeat(7000) } })) })
  assert.ok(new TextEncoder().encode(output).byteLength < TOOL_HISTORY_MAX_BYTES)
  assert.equal((output.match(/"status":"uncertain"/g) ?? []).length, 16)
  assert.match(output, /combined model-history limit/)
  assert.doesNotMatch(output, /x{100}/)
})

test('ordinary conversation text stays verbatim', () => {
  assert.equal(messageHistoryText({ id: 'plain', role: 'user', content: 'Literal\ntext.' }), 'Literal\ntext.')
})

test('accepted control-bearing tool text stays exact inside JSON-framed model history', () => {
  const text = 'page one\u000cpage two\u0000\u001b[31m\u0085 🧪'
  const mcpResult = parseMcpToolResult({ resultType: 'complete', content: [
    { type: 'text', text }, { type: 'resource', resource: { uri: 'urn:body', text } },
  ], structuredContent: { content: text } }, MCP_TOOL_RESULT_MODERN_VERSION)
  const output = messageHistoryText({ id: 'reply', role: 'assistant', content: 'Read result.', toolActivities: [{ ...activity, status: 'done', mcpResult }] })
  const [receipt] = JSON.parse(output.split(`${TOOL_RECEIPT_DATA_LABEL}\n`)[1])
  assert.equal(receipt.result.content[0].text, text)
  assert.equal(receipt.result.content[1].text, text)
  assert.equal(receipt.result.structuredContent.content, text)
  assert.equal(receipt.submission, 'result-received')
  assert.doesNotMatch(output, /[\u0000\u000c\u001b]/u, 'JSON framing escapes C0 characters without changing retained data')
})

test('MCP history distinguishes unsent failures, returned errors and unknown submission even when bodies are omitted', () => {
  const activities = [
    { ...activity, id: 'unsent', status: 'failed' },
    { ...activity, id: 'returned-error', status: 'failed', decisionId: 'receipt', mcpResult: {
      resultType: 'complete', isError: true, content: [{ type: 'text', text: 'Error after a partial effect' }],
    } },
    { ...activity, id: 'in-flight', status: 'running', decisionId: 'receipt' },
  ]
  for (const large of [false, true]) {
    const rows = large ? Array.from({ length: 6 }, () => activities).flat().map((row, i) => ({
      ...row, id: `${row.id}-${i}`, input: { query: 'x'.repeat(7000) },
    })) : activities
    const output = messageHistoryText({ id: 'reply', role: 'assistant', content: '', toolActivities: rows })
    const projected = JSON.parse(output.split(`${TOOL_RECEIPT_DATA_LABEL}\n`)[1])
    assert.equal(projected.length, rows.length)
    for (const row of projected) {
      const expected = row.id.startsWith('unsent') ? 'not-sent' : row.id.startsWith('returned-error') ? 'result-received' : 'unknown'
      assert.equal(row.submission, expected, row.id)
    }
    if (large) assert.match(output, /combined model-history limit/)
  }
})
