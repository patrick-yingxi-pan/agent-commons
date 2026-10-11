/** Local Anthropic Messages peer for the packaged native OAuth acceptance run.
 * It is deliberately independent of the product store and has no public-service
 * fallback. The caller's advertised records.search definition selects the one
 * opaque provider tool name used in the deterministic proposal. */
import { createServer } from 'node:http'

export const MCP_OAUTH_MESSAGES_SMOKE_MODEL = 'desktop-native-oauth-mcp-smoke-model'
export const MCP_OAUTH_MESSAGES_SMOKE_QUERY = 'native-oauth-approved-record'
export const MCP_OAUTH_MESSAGES_SMOKE_PROMPT = `Use the attached OAuth MCP tool to search for ${MCP_OAUTH_MESSAGES_SMOKE_QUERY}.`
export const MCP_OAUTH_MESSAGES_SMOKE_OUTCOME = Object.freeze({
  toolName: 'records.search',
  arguments: Object.freeze({ query: MCP_OAUTH_MESSAGES_SMOKE_QUERY }),
  finalText: 'The OAuth MCP search is awaiting your approval; it has not run yet.',
})

const MAX_REQUEST_BYTES = 256 * 1024
const MAX_REQUESTS = 2
const MAX_DECLARED_TOOLS = 256
const MAX_PROBE_REQUESTS = 4
const MAX_CATALOG_REQUESTS = 4
const PROBE_PROMPT = 'Conformance check. Reply with one word.'
const CALL_ID = 'native-oauth-smoke-call-1'
// toolExecution.ts replaces the activity's display summary with this explicit
// no-execution acknowledgement before the next Messages turn.
const STAGED_PROPOSAL_RESULT = 'Proposed to the user — awaiting their confirmation; not executed yet.'
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = value => structuredClone(value)
const textContent = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('') : ''
const isSearchTool = tool => isRecord(tool) && typeof tool.name === 'string' &&
  /^mcp_external_[a-f0-9]{48}$/.test(tool.name) && typeof tool.description === 'string' &&
  tool.description.startsWith(`${MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.toolName} — via `) &&
  isRecord(tool.input_schema) && tool.input_schema.type === 'object' &&
  isRecord(tool.input_schema.properties) && isRecord(tool.input_schema.properties.query) &&
  tool.input_schema.properties.query.type === 'string' && Array.isArray(tool.input_schema.required) &&
  tool.input_schema.required.includes('query')

function validRequest(body, count) {
  if (!isRecord(body) || body.model !== MCP_OAUTH_MESSAGES_SMOKE_MODEL ||
      !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 16 ||
      (body.stream !== true && body.stream !== false) || !Array.isArray(body.tools) || body.tools.length > MAX_DECLARED_TOOLS) return false
  if (count >= MAX_REQUESTS) return false
  if (body.messages.some(message => !isRecord(message) || !['user', 'assistant'].includes(message.role) ||
      !(typeof message.content === 'string' || Array.isArray(message.content)))) return false
  const matches = body.tools.filter(isSearchTool)
  if (matches.length !== 1) return false
  const hasPrompt = body.messages.some(message => message.role === 'user' &&
    textContent(message.content).includes(MCP_OAUTH_MESSAGES_SMOKE_PROMPT))
  if (!hasPrompt) return false
  const calls = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => isRecord(block) && block.type === 'tool_use')
  const results = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => isRecord(block) && block.type === 'tool_result')
  if (count === 0) return calls.length === 0 && results.length === 0
  if (calls.length !== 1 || results.length !== 1) return false
  const callIndex = body.messages.findIndex(message => Array.isArray(message.content) && message.content.includes(calls[0]))
  const resultIndex = body.messages.findIndex(message => Array.isArray(message.content) && message.content.includes(results[0]))
  return body.messages[callIndex].role === 'assistant' && body.messages[resultIndex].role === 'user' &&
    resultIndex > callIndex && calls[0].id === CALL_ID && calls[0].name === matches[0].name &&
    isRecord(calls[0].input) && calls[0].input.query === MCP_OAUTH_MESSAGES_SMOKE_QUERY &&
    results[0].tool_use_id === calls[0].id && results[0].content === STAGED_PROPOSAL_RESULT &&
    results[0].is_error !== true
}

function send(res, event, value) { res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`) }
function reply(res, body, tool) {
  const content = tool
    ? [{ type: 'tool_use', id: CALL_ID, name: tool.name, input: { ...MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.arguments } }]
    : [{ type: 'text', text: MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.finalText }]
  const message = { id: 'msg_native_oauth_smoke_1', type: 'message', role: 'assistant',
    model: MCP_OAUTH_MESSAGES_SMOKE_MODEL, content, stop_reason: tool ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 12, output_tokens: tool ? 8 : 10 } }
  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(message))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' })
  const start = { ...message, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } }
  send(res, 'message_start', { type: 'message_start', message: start })
  if (tool) {
    send(res, 'content_block_start', { type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: CALL_ID, name: tool.name, input: {} } })
    send(res, 'content_block_delta', { type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.arguments) } })
  } else {
    send(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    send(res, 'content_block_delta', { type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.finalText } })
  }
  send(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  send(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: tool ? 8 : 10 } })
  send(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

/** Starts an ephemeral loopback-only Messages API endpoint used by packaged
 * acceptance. Invalid, oversized, unrelated, or unbounded requests are refused
 * without being recorded. `snapshot()` returns a detached copy of accepted bodies. */
export async function startMcpOAuthMessagesSmokeFixture() {
  const requests = []
  const probes = []
  const catalogRequests = []
  const rejected = []
  const sockets = new Set()
  let closing
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      if (catalogRequests.length >= MAX_CATALOG_REQUESTS) { res.writeHead(429).end(); return }
      catalogRequests.push({ method: req.method, path })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ data: [{ id: MCP_OAUTH_MESSAGES_SMOKE_MODEL, display_name: 'Native OAuth Messages fixture',
        created_at: '2026-10-11T00:00:00Z', type: 'model', max_input_tokens: 200_000, max_tokens: 8_192 }],
      has_more: false, first_id: MCP_OAUTH_MESSAGES_SMOKE_MODEL, last_id: MCP_OAUTH_MESSAGES_SMOKE_MODEL }))
      return
    }
    if (req.method !== 'POST' || path !== '/v1/messages') { res.writeHead(404).end(); return }
    const chunks = []
    let size = 0
    try {
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_REQUEST_BYTES) { res.writeHead(413).end(); return }
        chunks.push(chunk)
      }
    } catch {
      if (!res.destroyed && !res.writableEnded) res.writeHead(400).end()
      return
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
    const probe = isRecord(body) && body.model === MCP_OAUTH_MESSAGES_SMOKE_MODEL && body.max_tokens === 8 &&
      Array.isArray(body.messages) && body.messages.length === 1 && body.messages[0]?.role === 'user' &&
      body.messages[0]?.content === PROBE_PROMPT && Array.isArray(body.tools) && body.tools.length === 1 &&
      isRecord(body.tools[0]) && body.tools[0].name === 'probe_noop' &&
      body.tools[0].description === 'Conformance probe — never called.' &&
      isRecord(body.tools[0].input_schema) && body.tools[0].input_schema.type === 'object' &&
      isRecord(body.tools[0].input_schema.properties) && Object.keys(body.tools[0].input_schema.properties).length === 0
    if (probe) {
      if (probes.length >= MAX_PROBE_REQUESTS) { res.writeHead(429).end(); return }
      probes.push(clone(body))
      const message = { id: 'msg_native_oauth_probe_1', type: 'message', role: 'assistant',
        model: MCP_OAUTH_MESSAGES_SMOKE_MODEL, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn',
        usage: { input_tokens: 6, output_tokens: 1 } }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(message))
      return
    }
    if (!validRequest(body, requests.length)) {
      if (rejected.length < 4) rejected.push({ model: body?.model, stream: body?.stream,
        tools: Array.isArray(body?.tools) ? body.tools.length : null,
        searchTools: Array.isArray(body?.tools) ? body.tools.filter(isSearchTool).length : null,
        messages: Array.isArray(body?.messages) ? body.messages.map(message => ({ role: message?.role,
          hasPrompt: textContent(message?.content).includes(MCP_OAUTH_MESSAGES_SMOKE_PROMPT),
          blocks: Array.isArray(message?.content) ? message.content.map(block => block?.type) : 'text' })) : null })
      res.writeHead(400).end(); return
    }
    requests.push(clone(body))
    const tool = body.tools.find(isSearchTool)
    const hasResult = body.messages.some(message => Array.isArray(message.content) &&
      message.content.some(block => isRecord(block) && block.type === 'tool_result'))
    reply(res, body, hasResult ? undefined : tool)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    baseUrl: origin,
    requests,
    probes,
    catalogRequests,
    rejected,
    snapshot: () => clone(requests),
    close() {
      if (closing) return closing
      closing = new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy() })
      return closing
    },
  }
}
