import { createServer } from 'node:http'

export const ROUTINE_MESSAGES_SMOKE_MODEL = 'desktop-routine-mcp-smoke-model'
const MAX_REQUEST_BYTES = 256 * 1024

function send(res, event, value) { res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`) }
function respond(res, body, tool) {
  const useTool = !!tool
  const id = `msg_routine_smoke_${Date.now().toString(36)}`
  const text = 'Routine MCP local acceptance completed.'
  const content = useTool
    ? [{ type: 'tool_use', id: 'routine-smoke-call-1', name: tool.name, input: { query: 'routine-native-smoke' } }]
    : [{ type: 'text', text }]
  const message = { id, type: 'message', role: 'assistant', model: ROUTINE_MESSAGES_SMOKE_MODEL, content,
    stop_reason: useTool ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 8 } }
  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(message))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  message.content = []
  message.stop_reason = null
  message.usage.output_tokens = 0
  send(res, 'message_start', { type: 'message_start', message })
  if (useTool) {
    send(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'routine-smoke-call-1', name: tool.name, input: {} } })
    send(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: 'routine-native-smoke' }) } })
    send(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  } else {
    send(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    send(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    send(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  }
  send(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
  send(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

/** Local Messages peer. It asks for exactly one reviewed tool, then returns a
 * final answer; the final request can be held across process-exit recovery. */
export async function startRoutineMessagesSmokeFixture() {
  const requests = []
  const held = new Set()
  const sockets = new Set()
  let holdFinal = false
  let closing
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: ROUTINE_MESSAGES_SMOKE_MODEL, display_name: 'Routine smoke fixture' }] }))
      return
    }
    if (req.method !== 'POST' || path !== '/v1/messages') { res.writeHead(404).end(); return }
    const chunks = []
    let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > MAX_REQUEST_BYTES) { res.writeHead(413).end(); return }; chunks.push(chunk) }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
    if (body?.model !== ROUTINE_MESSAGES_SMOKE_MODEL || !Array.isArray(body.messages)) { res.writeHead(400).end(); return }
    if (body.tools?.some(row => row.name === 'probe_noop')) {
      respond(res, body, null)
      return
    }
    requests.push(structuredClone(body))
    const tool = body.tools?.find(row => row.description?.includes('Unattended Routine permission'))
    const hasToolResult = body.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'))
    const useTool = !!tool && !hasToolResult
    if (holdFinal && hasToolResult) {
      await new Promise(resolve => {
        const entry = { res, resolve }
        held.add(entry)
        const finish = () => { held.delete(entry); resolve() }
        res.once('close', finish)
        entry.release = () => { if (!held.has(entry)) return; res.off('close', finish); respond(res, body, null); finish() }
      })
      return
    }
    respond(res, body, useTool ? tool : null)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`, requests,
    get heldCount() { return held.size },
    holdFinal() { holdFinal = true },
    close() {
      if (closing) return closing
      closing = new Promise(resolve => { for (const entry of [...held]) entry.res.destroy(); server.close(resolve); for (const socket of sockets) socket.destroy() })
      return closing
    },
  }
}
