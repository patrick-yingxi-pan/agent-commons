/** Authored loopback Messages peer for ordinary packaged acceptance only. */
import { createServer } from 'node:http'

export const MESSAGES_SMOKE_KEY = 'agent-commons-messages-smoke-not-a-real-key'
export const MESSAGES_SMOKE_MODEL = 'messages-smoke-page-two-model'
export const MESSAGES_SMOKE_PRIVATE_ERROR = 'AUTHORED_MESSAGES_PRIVATE_PROVIDER_DIAGNOSTIC'
export const MESSAGES_SMOKE_TOOL_REPLY = 'The packaged Messages tool round completed.'
export const MESSAGES_SMOKE_TEXT_REPLY = 'The restored Messages connection completed another turn.'
const DECOY = 'messages-smoke-first-page-decoy'
const CALL_ID = 'messages-smoke-usage'
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_CAPTURED_REQUESTS = 32

function json(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return false
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(value))
  return true
}

function stream(res, id, tool, text) {
  const event = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' })
  event({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: MESSAGES_SMOKE_MODEL,
    content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 11, output_tokens: 0, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } } })
  event({ type: 'content_block_start', index: 0, content_block: tool
    ? { type: 'tool_use', id: CALL_ID, name: 'api__get_usage', input: {} }
    : { type: 'text', text: '' } })
  event({ type: 'content_block_delta', index: 0, delta: tool
    ? { type: 'input_json_delta', partial_json: '{"query":{}}' }
    : { type: 'text_delta', text } })
  event({ type: 'content_block_stop', index: 0 })
  event({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
  event({ type: 'message_stop' })
  res.end()
}

async function readBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) { req.resume(); return { kind: 'too-large' } }
      chunks.push(buffer)
    }
  } catch { return { kind: 'aborted' } }
  try { return { kind: 'ok', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) } }
  catch { return { kind: 'malformed' } }
}

export async function startMessagesSmokeFixture({ family }) {
  if (!['claude', 'deepseek'].includes(family)) throw new TypeError('Unsupported Messages fixture family.')
  const mount = family === 'deepseek' ? '/anthropic' : ''
  const requests = []
  const sockets = new Set()
  let catalogCount = 0, sequence = 0, continuationFailures = 0, retryWaitResponses = 0, retryWaitStartedAt = 0
  let mode = 'retry-tools', closing
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const catalog = req.method === 'GET' && url.pathname === `${mount}/v1/models`
    const messages = req.method === 'POST' && url.pathname === `${mount}/v1/messages`
    if (!catalog && !messages) { json(res, 404, { error: { message: 'Not found.' } }); return }
    if (req.headers['x-api-key'] !== MESSAGES_SMOKE_KEY) { json(res, 401, { error: { message: 'Unauthorized.' } }); return }
    if (catalog) {
      const cursor = url.searchParams.get('after_id')
      if (cursor !== null && cursor !== DECOY) { json(res, 400, { error: { message: 'Unknown catalog cursor.' } }); return }
      catalogCount++
      const id = cursor === null ? DECOY : MESSAGES_SMOKE_MODEL
      json(res, 200, { data: [{ id, type: 'model', display_name: cursor === null ? 'Messages decoy' : 'Messages smoke model',
        capabilities: { effort: { supported: false } } }], has_more: cursor === null, first_id: id, last_id: id })
      return
    }
    const parsed = await readBody(req)
    if (parsed.kind === 'aborted') return
    if (parsed.kind !== 'ok') { json(res, parsed.kind === 'too-large' ? 413 : 400, { error: { message: 'Request must be JSON within 256 KiB.' } }); return }
    const body = parsed.value
    const probe = body?.stream !== true && Array.isArray(body?.tools) && body.tools.some(tool => tool?.name === 'probe_noop')
    if (body?.model !== MESSAGES_SMOKE_MODEL || !Array.isArray(body?.messages) || body?.output_config !== undefined || (!probe && body?.stream !== true)) {
      json(res, 400, { error: { message: 'Request must use the smoke model, array messages and streaming except probes.' } }); return
    }
    if (requests.length >= MAX_CAPTURED_REQUESTS) { json(res, 429, { error: { message: 'Fixture request history is full.' } }); return }
    requests.push(structuredClone(body))
    const id = `msg_messages_smoke_${++sequence}`
    if (probe) {
      json(res, 200, { id, type: 'message', role: 'assistant', model: MESSAGES_SMOKE_MODEL,
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
      return
    }
    if (mode === 'quota') {
      json(res, 429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: MESSAGES_SMOKE_PRIVATE_ERROR } }); return
    }
    if (mode === 'retry-wait') {
      if (json(res, 503, { error: { type: 'overloaded_error', message: MESSAGES_SMOKE_PRIVATE_ERROR } }, { 'retry-after': '5' })) {
        retryWaitResponses++
        retryWaitStartedAt ||= Date.now()
      }
      return
    }
    const continuation = body.messages.some(message => message?.role === 'user' && Array.isArray(message.content) &&
      message.content.some(block => block?.type === 'tool_result' && block.tool_use_id === CALL_ID))
    if (mode === 'retry-tools' && continuation && continuationFailures++ === 0) {
      json(res, 503, { error: { type: 'service_unavailable_error', code: 'server_is_overloaded', message: MESSAGES_SMOKE_PRIVATE_ERROR } }, { 'retry-after': '0' }); return
    }
    stream(res, id, mode === 'retry-tools' && !continuation, mode === 'retry-tools' ? MESSAGES_SMOKE_TOOL_REPLY : MESSAGES_SMOKE_TEXT_REPLY)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  return {
    baseURL: `http://127.0.0.1:${address.port}${mount}`,
    requests,
    get catalogCount() { return catalogCount },
    get retryWaitResponses() { return retryWaitResponses },
    get retryWaitStartedAt() { return retryWaitStartedAt },
    setMode(next) {
      if (!['retry-tools', 'text', 'quota', 'retry-wait'].includes(next)) throw new TypeError('Unsupported Messages fixture mode.')
      mode = next; continuationFailures = 0; retryWaitResponses = 0; retryWaitStartedAt = 0
    },
    close() {
      if (!closing) closing = new Promise(resolve => { server.close(() => resolve()); for (const socket of sockets) socket.destroy() })
      return closing
    },
  }
}
