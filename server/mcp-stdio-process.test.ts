import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { createMcpStdioSupervisor } from '../desktop/mcpStdioSupervisor.mjs'
import { createMcpStdioClient, McpStdioClientError } from './mcpStdioClient.ts'
import { MCP_MODERN_VERSION, MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'

// Repository-authored subprocess only: no app imports, storage, filesystem,
// network or real credentials. The ordinary native pipes and lifecycle are real.
const peer = `
  import readline from 'node:readline';
  const input = readline.createInterface({ input: process.stdin });
  const seen = [];
  let initialized = false;
  const modern = '2026-07-28';
  const legacy = process.env.PEER_MODE.startsWith('legacy');
  const send = row => process.stdout.write(JSON.stringify(row) + '\\n');
  input.on('line', line => {
    const row = JSON.parse(line); seen.push(row);
    if (row.method === 'notifications/initialized') { initialized = true; return; }
    if (row.id === undefined) return;
    const result = value => send({ jsonrpc: '2.0', id: row.id, result: value });
    const error = code => send({ jsonrpc: '2.0', id: row.id, error: { code, message: 'private peer diagnostic' } });
    if (row.method === 'server/discover') {
      if (process.env.PEER_MODE === 'legacy-exit') process.exit(0);
      if (legacy) return error(-32602);
      return result({ resultType: 'complete', supportedVersions: [modern], capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'owned stdio fixture', version: '1' } } });
    }
    if (row.method === 'initialize') return result({ protocolVersion: '2025-06-18',
      serverInfo: { name: 'owned legacy fixture', version: '1' }, capabilities: { tools: {} } });
    if (legacy && !initialized) return error(-32001);
    if (!legacy && row.params._meta['io.modelcontextprotocol/protocolVersion'] !== modern) return error(-32022);
    if (row.method === 'tools/list') return result({ ...(legacy ? {} : { resultType: 'complete' }),
      tools: [{ name: row.params.cursor ? 'second' : 'echo', inputSchema: { type: 'object' },
        annotations: { trace: seen } }], ...(row.params.cursor ? {} : { nextCursor: 'page-two' }) });
    if (row.method === 'tools/call') {
      if (row.params.name === 'crash') process.exit(9);
      if (row.params.name === 'server-request') return send({ jsonrpc: '2.0', id: 'peer-request', method: 'sampling/createMessage', params: {} });
      if (row.params.name === 'form' && !row.params.inputResponses) return result({ resultType: 'input_required',
        requestState: '  私密\\u0000opaque\\n  ', inputRequests: { detail: { method: 'elicitation/create', params: {
          message: 'Choose a name', requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        } } } });
      return result({ ...(legacy ? {} : { resultType: 'complete' }), content: [{ type: 'text', text: '世界🙂' }],
        structuredContent: { trace: seen, processId: process.pid }, isError: false });
    }
    error(-32601);
  });
`
const invocation = (name = 'echo') => ({ tool: { name, inputSchema: { type: 'object', properties: { value: { type: 'string', 'x-mcp-header': 'Ignored-For-Stdio' } } } },
  arguments: { value: 'literal $(not-run)\u0000世界' } })
const options = { isCurrent: () => true }
const native = { skip: process.platform !== 'darwin', timeout: 15_000 }

function setup(t, mode = 'modern') {
  const manager = createMcpStdioSupervisor()
  const opened = []
  const methods: string[] = []
  const client = createMcpStdioClient({ open: input => {
    const connection = manager.open({ executable: process.execPath, args: ['--input-type=module', '-e', peer], cwd: tmpdir(), env: { PEER_MODE: mode } }, input)
    opened.push(connection)
    return { ...connection, request(method, params, requestOptions) {
      methods.push(method)
      return connection.request(method, params, requestOptions)
    } }
  } })
  t.after(async () => { manager.dispose(); await Promise.all(opened.map(connection => connection.closed)) })
  return { client, opened, methods }
}

test('real stdio modern discovery and one call use inline metadata, inert pages and separate bounded processes', native, async t => {
  const h = setup(t)
  const catalog = await h.client.discover(options)
  assert.equal(catalog.cleanup, 'released')
  assert.deepEqual(catalog.tools.map(tool => tool.name), ['echo', 'second'])
  assert.equal(catalog.serverInfo?.name, 'owned stdio fixture')
  assert.deepEqual(h.methods, ['server/discover', 'tools/list', 'tools/list'])
  const call = await h.client.callTool(invocation(), { ...options, expectedProtocolVersion: MCP_MODERN_VERSION })
  assert.equal(call.cleanup, 'released')
  assert.deepEqual(call.result.content, [{ type: 'text', text: '世界🙂' }])
  const trace = call.result.structuredContent!.trace
  assert.deepEqual(trace.map(row => row.method), ['server/discover', 'tools/call'])
  assert.deepEqual(trace[1].params.arguments, invocation().arguments)
  assert.equal(trace[1].params._meta['io.modelcontextprotocol/protocolVersion'], MCP_MODERN_VERSION)
  assert.deepEqual(trace[1].params._meta['io.modelcontextprotocol/clientCapabilities'], {})
  assert.deepEqual(Object.keys(trace[1].params).sort(), ['_meta', 'arguments', 'name'])
  assert.equal(h.opened.length, 2)
})

test('real legacy peers reject or exit on discovery; probe is reaped before a fresh initialize', native, async t => {
  for (const mode of ['legacy-error', 'legacy-exit']) {
    const h = setup(t, mode)
    const result = await h.client.callTool(invocation(), { ...options, expectedProtocolVersion: MCP_LEGACY_VERSIONS[1] })
    assert.equal(result.protocolVersion, MCP_LEGACY_VERSIONS[1])
    assert.equal(result.cleanup, 'released')
    assert.equal(h.opened.length, 2)
    assert.deepEqual(h.methods, ['server/discover', 'initialize', 'tools/call'])
    const trace = result.result.structuredContent!.trace
    assert.deepEqual(trace.map(row => row.method), ['initialize', 'notifications/initialized', 'tools/call'])
    assert.equal(trace[0].params.protocolVersion, MCP_LEGACY_VERSIONS[0])
    assert.equal(trace[2].params._meta, undefined)
    assert.equal(trace[0].params._meta, undefined)
    assert.equal((await h.opened[0].closed).code, 'closed')
  }
})

test('real form rounds close between explicit calls, echo exact private state and do not auto-continue', native, async t => {
  const h = setup(t)
  const first = await h.client.callToolWithForms(invocation('form'), options)
  assert.equal(first.result.resultType, 'input_required')
  assert.equal(first.cleanup, 'released')
  assert.deepEqual(h.methods, ['server/discover', 'tools/call'])
  const responses = { detail: { action: 'accept', content: { name: 'Ada' } } }
  const final = await h.client.callToolWithForms({ ...invocation('form'), continuation: { pending: first.result, responses } }, options)
  assert.equal(final.result.resultType, 'complete')
  const trace = final.result.structuredContent!.trace
  assert.equal(trace[1].params.requestState, '  私密\u0000opaque\n  ')
  assert.deepEqual(trace[1].params.inputResponses, responses)
  assert.deepEqual(trace[1].params.arguments, invocation('form').arguments)
  for (const row of trace) assert.deepEqual(row.params._meta['io.modelcontextprotocol/clientCapabilities'], { elicitation: { form: {} } })
  assert.equal(h.opened.length, 2)
})

test('real child crash/server request after tool submission is uncertain and never launches a replacement', native, async t => {
  for (const [name, code] of [['crash', 'closed'], ['server-request', 'protocol']]) {
    const h = setup(t)
    await assert.rejects(h.client.callTool(invocation(name), options), error => {
      assert.ok(error instanceof McpStdioClientError)
      assert.equal(error.code, code)
      assert.equal(error.mayHaveExecuted, true)
      assert.doesNotMatch(error.message, /private peer diagnostic/)
      return true
    })
    assert.equal(h.opened.length, 1)
    assert.deepEqual(h.methods, ['server/discover', 'tools/call'])
  }
})

test('native last-write consent fence refuses changed authority without claiming a tool was submitted', native, async t => {
  const h = setup(t)
  let checks = 0
  await assert.rejects(h.client.callTool(invocation(), { ...options, beforeCall: () => ++checks === 1 }),
    error => error.code === 'stale' && error.mayHaveExecuted === false)
  assert.equal(checks, 2)
  assert.equal(h.opened.length, 1)
})
