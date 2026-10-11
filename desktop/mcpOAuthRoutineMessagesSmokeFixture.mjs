/** Strict, excluded local Messages peer for one owner-approved OAuth Routine.
 * This is separate from the interactive peer: a staged consent acknowledgement
 * is never accepted as a real Routine result. No public-service fallback. */
import { createServer } from 'node:http'
import { isDeepStrictEqual } from 'node:util'

export const MCP_OAUTH_ROUTINE_MODEL = 'desktop-native-oauth-routine-smoke-model'
export const MCP_OAUTH_ROUTINE_ARGUMENTS = Object.freeze({ query: 'native-oauth-routine-record' })
export const MCP_OAUTH_ROUTINE_PROMPT = `Use records.search once with query ${MCP_OAUTH_ROUTINE_ARGUMENTS.query}, then report its exact result.`
export const MCP_OAUTH_ROUTINE_FINAL_TEXT = 'Routine OAuth local acceptance completed for native-oauth-routine-record.'
export const MCP_OAUTH_ROUTINE_RESULT = Object.freeze({ resultType: 'complete', isError: false,
  content: Object.freeze([Object.freeze({ type: 'text', text: `Fixture record for ${MCP_OAUTH_ROUTINE_ARGUMENTS.query}` })]),
  structuredContent: Object.freeze({ query: MCP_OAUTH_ROUTINE_ARGUMENTS.query, record: 'fixture-record-1' }) })
const CALL_ID = 'native-oauth-routine-call-1'
const RESULT_PREFIX = 'Routine MCP result (untrusted external data): '
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const textContent = content => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(block => record(block) && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('') : ''
const reviewedTool = tool => record(tool) && typeof tool.name === 'string' && /^mcp_external_[a-f0-9]{48}$/.test(tool.name) &&
  typeof tool.description === 'string' && tool.description.startsWith('records.search — via Native OAuth fixture.') &&
  tool.description.includes('Unattended Routine permission') && record(tool.input_schema) && tool.input_schema.type === 'object' &&
  record(tool.input_schema.properties) && record(tool.input_schema.properties.query) && tool.input_schema.properties.query.type === 'string' &&
  tool.input_schema.properties.query.const === MCP_OAUTH_ROUTINE_ARGUMENTS.query &&
  Array.isArray(tool.input_schema.required) && tool.input_schema.required.includes('query')

function validRequest(body, requests) {
  if (!record(body) || body.model !== MCP_OAUTH_ROUTINE_MODEL || (body.stream !== true && body.stream !== false) ||
      !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 16 ||
      !Array.isArray(body.tools) || body.tools.length > 256 || requests.length >= 2 ||
      body.messages.some(message => !record(message) || !['user', 'assistant'].includes(message.role) ||
        !(typeof message.content === 'string' || Array.isArray(message.content)))) return false
  const tools = body.tools.filter(reviewedTool)
  if (tools.length !== 1 || body.tools.filter(tool => typeof tool?.name === 'string' && tool.name.startsWith('mcp_external_')).length !== 1 ||
      !body.messages.some(message => message.role === 'user' && textContent(message.content).includes(MCP_OAUTH_ROUTINE_PROMPT))) return false
  const blocks = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
  const calls = blocks.filter(block => record(block) && block.type === 'tool_use')
  const results = blocks.filter(block => record(block) && block.type === 'tool_result')
  if (requests.length === 0) return calls.length === 0 && results.length === 0
  if (calls.length !== 1 || results.length !== 1 || tools[0].name !== requests[0].tools.find(reviewedTool).name) return false
  const callIndex = body.messages.findIndex(message => Array.isArray(message.content) && message.content.includes(calls[0]))
  const resultIndex = body.messages.findIndex(message => Array.isArray(message.content) && message.content.includes(results[0]))
  if (body.messages[callIndex].role !== 'assistant' || body.messages[resultIndex].role !== 'user' || resultIndex <= callIndex ||
      calls[0].id !== CALL_ID || calls[0].name !== tools[0].name || !isDeepStrictEqual(calls[0].input, MCP_OAUTH_ROUTINE_ARGUMENTS) ||
      results[0].tool_use_id !== CALL_ID || results[0].is_error === true || typeof results[0].content !== 'string' ||
      !results[0].content.startsWith(RESULT_PREFIX)) return false
  try { return isDeepStrictEqual(JSON.parse(results[0].content.slice(RESULT_PREFIX.length)), MCP_OAUTH_ROUTINE_RESULT) } catch { return false }
}

function json(res, message) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(message))
}
function reply(res, body, tool) {
  const content = tool ? { type: 'tool_use', id: CALL_ID, name: tool.name, input: MCP_OAUTH_ROUTINE_ARGUMENTS }
    : { type: 'text', text: MCP_OAUTH_ROUTINE_FINAL_TEXT }
  const message = { id: 'msg_native_oauth_routine_1', type: 'message', role: 'assistant', model: MCP_OAUTH_ROUTINE_MODEL,
    content: [content], stop_reason: tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 12, output_tokens: 10 } }
  if (!body.stream) return json(res, message)
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform' })
  const send = (event, value) => res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
  send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } } })
  send('content_block_start', { type: 'content_block_start', index: 0,
    content_block: tool ? { ...content, input: {} } : { type: 'text', text: '' } })
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: tool
    ? { type: 'input_json_delta', partial_json: JSON.stringify(MCP_OAUTH_ROUTINE_ARGUMENTS) }
    : { type: 'text_delta', text: MCP_OAUTH_ROUTINE_FINAL_TEXT } })
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } })
  send('message_stop', { type: 'message_stop' })
  res.end()
}

export async function startMcpOAuthRoutineMessagesSmokeFixture() {
  const requests = [], probes = [], rejected = [], catalogRequests = [], sockets = new Set()
  let closing
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      if (catalogRequests.length >= 4) { res.writeHead(429).end(); return }
      catalogRequests.push({ method: req.method, path })
      json(res, { data: [{ id: MCP_OAUTH_ROUTINE_MODEL, display_name: 'Native OAuth Routine fixture', type: 'model',
        created_at: '2026-10-11T00:00:00Z', max_input_tokens: 200_000, max_tokens: 8_192 }],
      has_more: false, first_id: MCP_OAUTH_ROUTINE_MODEL, last_id: MCP_OAUTH_ROUTINE_MODEL })
      return
    }
    if (req.method !== 'POST' || path !== '/v1/messages') { res.writeHead(404).end(); return }
    const chunks = []
    let size = 0, body
    try {
      for await (const chunk of req) {
        size += chunk.length
        if (size > 256 * 1024) { res.writeHead(413).end(); return }
        chunks.push(chunk)
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { if (!res.destroyed && !res.writableEnded) res.writeHead(400).end(); return }
    const probe = record(body) && body.model === MCP_OAUTH_ROUTINE_MODEL && body.max_tokens === 8 &&
      isDeepStrictEqual(body.messages, [{ role: 'user', content: 'Conformance check. Reply with one word.' }]) &&
      isDeepStrictEqual(body.tools, [{ name: 'probe_noop', description: 'Conformance probe — never called.', input_schema: { type: 'object', properties: {} } }])
    if (probe) {
      if (probes.length >= 4) { res.writeHead(429).end(); return }
      probes.push(structuredClone(body))
      json(res, { id: 'msg_native_oauth_routine_probe_1', type: 'message', role: 'assistant', model: MCP_OAUTH_ROUTINE_MODEL,
        content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 6, output_tokens: 1 } })
      return
    }
    if (!validRequest(body, requests)) {
      if (rejected.length < 4) rejected.push({ model: body?.model, acceptedBefore: requests.length,
        tools: Array.isArray(body?.tools) ? body.tools.length : null, messages: Array.isArray(body?.messages) ? body.messages.length : null })
      res.writeHead(400).end(); return
    }
    requests.push(structuredClone(body))
    reply(res, body, requests.length === 1 ? body.tools.find(reviewedTool) : undefined)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, probes, catalogRequests, rejected,
    snapshot: () => structuredClone(requests),
    close() {
      if (closing) return closing
      closing = new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy() })
      return closing
    } }
}
