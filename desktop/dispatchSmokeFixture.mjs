import { createServer } from 'node:http'

export const DISPATCH_SMOKE_MODEL = 'desktop-dispatch-smoke-model'
const MAX_REQUEST_BYTES = 256 * 1024

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_REQUEST_BYTES) return { kind: 'too-large' }
      chunks.push(bytes)
    }
  } catch {
    return { kind: 'aborted' }
  }
  return { kind: 'ok', raw: Buffer.concat(chunks).toString('utf8') }
}

function responseFor(request) {
  const user = [...(request.messages ?? [])].reverse().find((message) => message.role === 'user')
  return {
    id: `msg_dispatch_smoke_${request.messages?.length ?? 0}`,
    type: 'message',
    role: 'assistant',
    model: DISPATCH_SMOKE_MODEL,
    content: [{ type: 'text', text: replyText(user) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 17, output_tokens: 13 },
  }
}

function replyText(user) {
  const prompt = typeof user?.content === 'string'
    ? user.content
    : Array.isArray(user?.content)
      ? user.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
      : ''
  return `Local Dispatch fixture reply: ${prompt.slice(0, 240)}`
}

function streamMessage(res, message) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  const id = `msg_dispatch_smoke_${Date.now().toString(36)}`
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  event('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: DISPATCH_SMOKE_MODEL, content: [], stop_reason: null, usage: { input_tokens: 17, output_tokens: 0 } } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: message.content[0].text } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 13 } })
  event('message_stop', { type: 'message_stop' })
  res.end()
}

function sendResponse(res, body) {
  const message = responseFor(body)
  if (body.stream === true) streamMessage(res, message)
  else json(res, 200, message)
}

/** Local Anthropic-compatible endpoint for packaged Dispatch acceptance.
 * It captures only model request bodies and can deliberately hold one response
 * so process-exit recovery is observed against the real persisted SQLite row.
 */
export async function startDispatchSmokeFixture() {
  const requests = []
  const held = new Set()
  const sockets = new Set()
  let mode = 'reply'
  let closing
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      json(res, 200, { data: [{ id: DISPATCH_SMOKE_MODEL, display_name: 'Dispatch smoke fixture' }] })
      return
    }
    if (req.method !== 'POST' || path !== '/v1/messages') {
      json(res, 404, { error: { type: 'not_found', message: 'Not found' } })
      return
    }
    const read = await readBody(req)
    if (read.kind === 'aborted') return
    if (read.kind === 'too-large') {
      json(res, 413, { error: { type: 'request_too_large', message: 'Request exceeds 256 KiB.' } })
      req.resume()
      return
    }
    let body
    try { body = read.raw ? JSON.parse(read.raw) : {} } catch {
      json(res, 400, { error: { type: 'invalid_request', message: 'Request body must be JSON.' } })
      return
    }
    if (body?.model !== DISPATCH_SMOKE_MODEL || !Array.isArray(body.messages)) {
      json(res, 400, { error: { type: 'invalid_request', message: 'A Dispatch Messages request is required.' } })
      return
    }
    if (body.tools?.some((tool) => tool.name === 'probe_noop')) {
      sendResponse(res, body)
      return
    }
    requests.push(structuredClone(body))
    if (mode !== 'hold') {
      sendResponse(res, body)
      return
    }
    await new Promise((resolve) => {
      const entry = { res, request: body, resolve }
      held.add(entry)
      const finish = () => {
        held.delete(entry)
        resolve()
      }
      res.once('close', finish)
      entry.release = () => {
        if (!held.has(entry)) return
        res.off('close', finish)
        sendResponse(res, body)
        finish()
      }
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    get heldCount() { return held.size },
    setMode(next) {
      if (!['reply', 'hold'].includes(next)) throw new TypeError('Unsupported Dispatch fixture mode.')
      mode = next
    },
    releaseHeld() {
      const pending = [...held]
      for (const entry of pending) entry.release()
      return pending.length
    },
    close() {
      if (closing) return closing
      closing = new Promise((resolve, reject) => {
        for (const entry of [...held]) {
          entry.res.destroy()
          entry.resolve()
        }
        server.close((error) => error ? reject(error) : resolve())
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}
