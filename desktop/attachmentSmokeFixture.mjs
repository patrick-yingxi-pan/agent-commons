import { createServer } from 'node:http'

const MAX_REQUEST_BYTES = 12 * 1024 * 1024
export const SMOKE_MODEL_ID = 'desktop-attachment-smoke-model'

function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) return { kind: 'too-large' }
      chunks.push(buffer)
    }
  } catch {
    return { kind: 'aborted' }
  }
  return { kind: 'ok', raw: Buffer.concat(chunks).toString('utf8') }
}

function extractDocument(content) {
  if (typeof content !== 'string') return undefined
  const marker = content.lastIndexOf('\n\n{"attached_files":')
  if (marker < 0) return undefined
  try {
    const document = JSON.parse(content.slice(marker + 2))
    return Array.isArray(document?.attached_files) ? document : undefined
  } catch {
    return undefined
  }
}

function streamMessage(res, reply) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    connection: 'keep-alive',
  })
  const id = `desktop_attachment_${Date.now().toString(36)}`
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  event('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: SMOKE_MODEL_ID, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  event('message_stop', { type: 'message_stop' })
  res.end()
}

export async function startAttachmentSmokeEndpoint() {
  const documents = []
  const requests = []
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      writeJson(res, 200, { data: [{ id: SMOKE_MODEL_ID, display_name: 'Desktop attachment fixture' }] })
      return
    }
    if (req.method !== 'POST' || path !== '/v1/messages') {
      writeJson(res, 404, { error: { type: 'not_found', message: 'Not found' } })
      return
    }
    const bodyResult = await readBody(req)
    if (bodyResult.kind === 'aborted') {
      res.destroy()
      return
    }
    if (bodyResult.kind === 'too-large') {
      writeJson(res, 413, { error: { type: 'request_too_large', message: 'Request exceeds 1 MiB.' } })
      return
    }
    const raw = bodyResult.raw
    let body
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      writeJson(res, 400, { error: { type: 'invalid_request', message: 'Request body must be JSON.' } })
      return
    }
    requests.push(body)
    const messages = Array.isArray(body?.messages) ? body.messages : []
    const latest = [...messages].reverse().find((message) => message?.role === 'user')?.content
    const blocks = Array.isArray(latest) ? latest : []
    const text = typeof latest === 'string' ? latest : blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    const document = extractDocument(text)
    if (document) documents.push(document)
    const ready = document?.attached_files?.find((file) => file?.status === 'ready')?.text
    const imageCount = blocks.filter((block) => block.type === 'image').length
    const reply = imageCount ? `Received ${imageCount} supplied image(s).` : typeof ready === 'string' ? `Read supplied attachment: ${ready}` : 'No supplied attachment text.'
    const result = { id: `desktop_attachment_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: SMOKE_MODEL_ID, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    if (body?.stream === true) streamMessage(res, reply)
    else writeJson(res, 200, result)
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
    documents,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
