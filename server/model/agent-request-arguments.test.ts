import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Agent } from '../../contract/workers.ts'
import type { McpDiscoveredTool } from '../../contract/mcpConnections.ts'
import { generateAgentRequestArguments } from '../generate.ts'
import { UsageRecordingError } from '../modelUsage.ts'
import {
  parseProxyArgumentDraft,
  prepareAgentRequestArguments,
  ProxyArgumentPreparationInputError,
  ProxyArgumentPreparationOutputError,
  ProxyArgumentPreparationTransportError,
  ProxyArgumentPreparationUsageError,
  snapshotPreparedProxyArgumentInput,
} from '../proxyArgumentPreparation.ts'

const agent: Agent = { id: 'owner-agent-private-id', label: 'Private owner label', systemPrompt: 'Use the approved source only.',
  instructions: 'Keep the query narrow.', tools: [], providerId: 'provider-private-id' }
const tool: McpDiscoveredTool = { name: 'search', description: 'Search the reviewed catalog.', inputSchema: {
  type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'], additionalProperties: false,
} }
const task = 'Find the current release notes.'
const prepared = () => prepareAgentRequestArguments({ task, agent, tool })

type Mode = 'success' | 'wrong-tool' | 'extra' | 'duplicate' | 'oversized' | 'tool-call' | 'truncated' | 'missing-content' | 'http-error'
let mode: Mode = 'success'
let usageValue: unknown = { input_tokens: 23, output_tokens: 11 }
const requests: Array<Record<string, unknown>> = []

function message(content: unknown[], overrides: Record<string, unknown> = {}) {
  return { id: 'msg-agent-request-test', type: 'message', role: 'assistant', model: 'test-model', content,
    stop_reason: 'end_turn', stop_sequence: null, usage: usageValue, ...overrides }
}
function respond(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}
async function withPeer(run: (baseURL: string) => Promise<void>): Promise<void> {
  const peer: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    requests.push(body)
    if (mode === 'http-error') return respond(res, { type: 'error', error: { type: 'overloaded_error', message: 'retry me' } }, 503)
    const result: Record<string, unknown> = mode === 'success' ? { content: [{ type: 'text', text: '{"toolName":"search","arguments":{"query":"release notes","limit":5}}' }] } :
      mode === 'wrong-tool' ? { content: [{ type: 'text', text: '{"toolName":"other","arguments":{}}' }] } :
      mode === 'extra' ? { content: [{ type: 'text', text: '{"toolName":"search","arguments":{},"extra":true}' }] } :
      mode === 'duplicate' ? { content: [{ type: 'text', text: '{"toolName":"search","arguments":{"query":"a","query":"b"}}' }] } :
      mode === 'oversized' ? { content: [{ type: 'text', text: JSON.stringify({ toolName: 'search', arguments: { value: 'x'.repeat(50 * 1024) } }) }] } :
      mode === 'tool-call' ? { content: [{ type: 'tool_use', id: 'must-not-run', name: 'run_mcp', input: {} }], stop_reason: 'tool_use' } :
      mode === 'missing-content' ? { content: null } :
      { content: [{ type: 'text', text: '{"toolName":"search","arguments":' }], stop_reason: 'max_tokens' }
    respond(res, message(result.content as unknown[], result.stop_reason ? { stop_reason: result.stop_reason } : {}))
  })
  await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve))
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  try { await run(`http://127.0.0.1:${address.port}`) }
  finally {
    peer.closeAllConnections?.()
    await new Promise<void>(resolve => peer.close(() => resolve()))
  }
}

test('preparation freezes only request task, receiving Agent instructions, and selected tool schema', () => {
  const inputAgent = structuredClone(agent), inputTool = structuredClone(tool)
  const result = prepareAgentRequestArguments({ task, agent: inputAgent, tool: inputTool })
  assert.equal(result.toolName, 'search')
  assert.match(result.system, /untrusted source data/)
  assert.match(result.system, /Use the approved source only/)
  assert.match(result.system, /Keep the query narrow/)
  const payload = JSON.parse(result.prompt.slice(result.prompt.indexOf('\n') + 1))
  assert.deepEqual(payload, { task, tool: { name: 'search', description: 'Search the reviewed catalog.', inputSchema: tool.inputSchema } })
  for (const forbidden of ['owner-agent-private-id', 'Private owner label', 'provider-private-id', 'connection-private-id', 'credential-secret-canary']) {
    assert.doesNotMatch(`${result.system}\n${result.prompt}`, new RegExp(forbidden, 'i'))
  }
  const inputBytes = new TextEncoder().encode(result.system).byteLength + new TextEncoder().encode(result.prompt).byteLength
  assert.ok(inputBytes <= 64 * 1024)
  assert.equal(result.allowanceTokens, inputBytes + 4_096 + 1_024)
  inputAgent.instructions = 'changed later'
  inputTool.inputSchema.properties!.query = { type: 'integer' }
  assert.match(result.system, /Keep the query narrow/)
  assert.match(result.prompt, /"type":"string"/)
})

test('preparation rejects oversized, accessor-backed, malformed and non-JSON input', () => {
  assert.throws(() => prepareAgentRequestArguments({ task: 'x'.repeat(9_000), agent, tool }), ProxyArgumentPreparationInputError)
  const hostileAgent = { ...agent }
  Object.defineProperty(hostileAgent, 'instructions', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => prepareAgentRequestArguments({ task, agent: hostileAgent, tool }), ProxyArgumentPreparationInputError)
  const hostileTool = { ...tool, inputSchema: { type: 'object' } }
  Object.defineProperty(hostileTool.inputSchema, 'properties', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => prepareAgentRequestArguments({ task, agent, tool: hostileTool }), ProxyArgumentPreparationInputError)
  assert.throws(() => prepareAgentRequestArguments({ task: 'bad\ud800', agent, tool }), ProxyArgumentPreparationInputError)
  assert.throws(() => prepareAgentRequestArguments({ task, agent, tool: { ...tool, inputSchema: { type: 'string' } } }), ProxyArgumentPreparationInputError)
})

test('prepared snapshot rejects tampering and is detached before provider I/O', async () => {
  const value = prepared()
  assert.deepEqual(snapshotPreparedProxyArgumentInput(value), value)
  const altered = { ...value, prompt: `${value.prompt} extra` }
  assert.throws(() => snapshotPreparedProxyArgumentInput(altered), ProxyArgumentPreparationInputError)
  const accessor = { ...value }
  Object.defineProperty(accessor, 'prompt', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => snapshotPreparedProxyArgumentInput(accessor), ProxyArgumentPreparationInputError)
  requests.length = 0
  mode = 'success'
  await withPeer(async baseURL => {
    const input = prepared()
    const promise = generateAgentRequestArguments(input, { baseURL, model: 'draft-model' }, undefined, () => {})
    input.prompt = 'mutated after call'
    const result = await promise
    assert.deepEqual(result, { toolName: 'search', arguments: { query: 'release notes', limit: 5 } })
  })
  assert.equal(requests.length, 1)
  const body = requests[0]!
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'system'])
  assert.equal(body.max_tokens, 4_096)
  assert.equal(body.model, 'draft-model')
  assert.equal(body.system, prepared().system)
  assert.deepEqual(body.messages, [{ role: 'user', content: prepared().prompt }])
})

test('draft parser requires one exact selected-tool JSON object and bounded arguments', () => {
  assert.deepEqual(parseProxyArgumentDraft('{"toolName":"search","arguments":{"query":"x"}}', 'search'),
    { toolName: 'search', arguments: { query: 'x' } })
  for (const raw of [
    '{"toolName":"search","arguments":{},"extra":true}',
    '{"toolName":"other","arguments":{}}',
    '{"toolName":"search","arguments":{"a":1,"a":2}}',
    JSON.stringify({ toolName: 'search', arguments: { large: 'x'.repeat(50 * 1024) } }),
    'not json',
  ]) assert.throws(() => parseProxyArgumentDraft(raw, 'search'), ProxyArgumentPreparationOutputError)
})

test('completed arguments use one tool-free Messages call and record usage before parsing', async () => {
  requests.length = 0; mode = 'success'; usageValue = { input_tokens: 23, output_tokens: 11 }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  await withPeer(async baseURL => {
    const result = await generateAgentRequestArguments(prepared(), { baseURL, model: 'draft-no-tools' }, undefined,
      row => usage.push(row))
    assert.equal(result.toolName, 'search')
  })
  assert.deepEqual(usage, [{ inputTokens: 23, outputTokens: 11 }])
  assert.equal(requests.length, 1)
  assert.equal(Object.hasOwn(requests[0]!, 'tools'), false)
  assert.equal(Object.hasOwn(requests[0]!, 'metadata'), false)
})

test('malformed, truncated, oversized, wrong-tool and tool-call output is metered then rejected', async t => {
  usageValue = { input_tokens: 23, output_tokens: 11 }
  for (const current of ['wrong-tool', 'extra', 'duplicate', 'oversized', 'tool-call', 'truncated', 'missing-content'] as const) {
    await t.test(current, async () => {
      mode = current
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      await withPeer(async baseURL => assert.rejects(generateAgentRequestArguments(prepared(), { baseURL, model: current }, undefined,
        row => usage.push(row)), ProxyArgumentPreparationOutputError))
      assert.deepEqual(usage, [{ inputTokens: 23, outputTokens: 11 }])
    })
  }
})

test('invalid settled usage is uncertain and never recorded as zero', async t => {
  for (const bad of [undefined, { output_tokens: 11 }, { input_tokens: 23 }, { input_tokens: -1, output_tokens: 1 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }]) {
    await t.test(JSON.stringify(bad), async () => {
      mode = 'success'; usageValue = bad
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      await withPeer(async baseURL => assert.rejects(generateAgentRequestArguments(prepared(), { baseURL, model: 'usage' }, undefined,
        row => usage.push(row)), ProxyArgumentPreparationUsageError))
      assert.deepEqual(usage, [])
    })
  }
  usageValue = { input_tokens: 23, output_tokens: 11 }
})

test('transport errors are attempted once with SDK retries disabled', async () => {
  requests.length = 0; mode = 'http-error'
  const previous = process.env.ANTHROPIC_MAX_RETRIES
  process.env.ANTHROPIC_MAX_RETRIES = '4'
  try {
    await withPeer(async baseURL => assert.rejects(generateAgentRequestArguments(prepared(), { baseURL, model: 'no-retry' }, undefined,
      () => {}), ProxyArgumentPreparationTransportError))
    assert.equal(requests.length, 1)
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_MAX_RETRIES
    else process.env.ANTHROPIC_MAX_RETRIES = previous
  }
})

test('usage recorder failure discards a valid draft', async () => {
  mode = 'success'; usageValue = { input_tokens: 23, output_tokens: 11 }
  await withPeer(async baseURL => assert.rejects(generateAgentRequestArguments(prepared(), { baseURL, model: 'meter-failure' }, undefined,
    () => { throw new Error('store unavailable') }), UsageRecordingError))
})
