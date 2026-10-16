import { createServer } from 'node:http'

const MAX_REQUEST_BYTES = 256 * 1024
const MAX_CAPTURED_REQUESTS = 32
const OPENAI_SMOKE_MODEL = 'desktop-openai-smoke-model'
const OPENAI_SMOKE_KEY = 'agent-commons-openai-smoke-not-a-real-key'
const OPENAI_SMOKE_REPLACEMENT_KEY = 'agent-commons-openai-rejected-not-a-real-key'
const OPENAI_SMOKE_REASONING = Object.freeze({
  id: 'rs_desktop_openai_smoke',
  type: 'reasoning',
  summary: [],
  encrypted_content: 'opaque-desktop-openai-smoke-reasoning',
})
const TEXT_REPLY = 'The restored OpenAI connection completed another turn.'
const TOOL_REPLY = 'The packaged OpenAI tool round completed.'

export { OPENAI_SMOKE_MODEL, OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY, OPENAI_SMOKE_REASONING }

function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function responseObject(id, status, output, usage) {
  return {
    id,
    object: 'response',
    created_at: 1_791_000_000,
    status,
    model: OPENAI_SMOKE_MODEL,
    output,
    usage,
  }
}

function textItem(id, text, status = 'completed') {
  return {
    id,
    type: 'message',
    role: 'assistant',
    status,
    content: [{ type: 'output_text', text, annotations: [] }],
  }
}

function writeSse(res, event, sequenceNumber) {
  if (res.destroyed || res.writableEnded) return
  res.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: sequenceNumber })}\n\n`)
}

function streamText(res, id, text) {
  const item = textItem(`msg_${id}`, text)
  const usage = { input_tokens: 17, output_tokens: 13 }
  const completed = responseObject(id, 'completed', [item], usage)
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'cache-control': 'no-store' })
  writeSse(res, { type: 'response.created', response: responseObject(id, 'in_progress', [], null) }, 0)
  writeSse(res, { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }, 1)
  writeSse(res, { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text }, 2)
  writeSse(res, { type: 'response.output_item.done', output_index: 0, item }, 3)
  writeSse(res, { type: 'response.completed', response: completed }, 4)
  res.end()
}

function streamToolCall(res, id) {
  const call = {
    id: 'fc_item_openai_smoke',
    type: 'function_call',
    call_id: 'openai-smoke-usage',
    name: 'api__get_usage',
    arguments: '{"query":{}}',
    status: 'completed',
  }
  const usage = { input_tokens: 17, output_tokens: 13 }
  const completed = responseObject(id, 'completed', [OPENAI_SMOKE_REASONING, call], usage)
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'cache-control': 'no-store' })
  writeSse(res, { type: 'response.created', response: responseObject(id, 'in_progress', [], null) }, 0)
  writeSse(res, { type: 'response.output_item.added', output_index: 0, item: OPENAI_SMOKE_REASONING }, 1)
  writeSse(res, { type: 'response.output_item.done', output_index: 0, item: OPENAI_SMOKE_REASONING }, 2)
  writeSse(res, { type: 'response.output_item.added', output_index: 1, item: { ...call, status: 'in_progress', arguments: '' } }, 3)
  writeSse(res, { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 1, delta: call.arguments }, 4)
  writeSse(res, { type: 'response.function_call_arguments.done', item_id: call.id, output_index: 1, name: call.name, arguments: call.arguments }, 5)
  writeSse(res, { type: 'response.output_item.done', output_index: 1, item: call }, 6)
  writeSse(res, { type: 'response.completed', response: completed }, 7)
  res.end()
}

async function readBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) {
        req.resume()
        return { kind: 'too-large' }
      }
      chunks.push(buffer)
    }
  } catch {
    return { kind: 'aborted' }
  }
  return { kind: 'ok', raw: Buffer.concat(chunks).toString('utf8') }
}

function isProbe(body) {
  return body?.stream === false && Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool.name === 'probe_noop')
}

function isSupportedRequest(body) {
  return body?.model === OPENAI_SMOKE_MODEL && Array.isArray(body?.input) && body.store === false
}

function probeResponse() {
  return responseObject('resp_openai_smoke_probe', 'completed', [textItem('msg_openai_smoke_probe', 'ok')], {
    input_tokens: 1,
    output_tokens: 1,
  })
}

export async function startOpenAIResponsesSmokeFixture() {
  const requests = []
  const sockets = new Set()
  let catalogCount = 0
  let sequence = 0
  let mode = 'tools'
  let closing

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method === 'GET' && path === '/v1/models') {
      if (req.headers.authorization !== `Bearer ${OPENAI_SMOKE_KEY}`) {
        json(res, 401, { error: { message: 'Unauthorized.' } })
        return
      }
      catalogCount += 1
      json(res, 200, { object: 'list', data: [{ id: OPENAI_SMOKE_MODEL, object: 'model', owned_by: 'agent-commons-smoke' }] })
      return
    }
    if (req.method !== 'POST' || path !== '/v1/responses') {
      json(res, 404, { error: { message: 'Not found.' } })
      return
    }

    const bodyResult = await readBody(req)
    if (bodyResult.kind === 'aborted') return
    if (bodyResult.kind === 'too-large') {
      json(res, 413, { error: { message: 'Request exceeds 256 KiB.' } })
      return
    }
    let body
    try {
      body = bodyResult.raw ? JSON.parse(bodyResult.raw) : {}
    } catch {
      json(res, 400, { error: { message: 'Request body must be JSON.' } })
      return
    }

    if (!isSupportedRequest(body)) {
      json(res, 400, { error: { message: 'Request must use the smoke model, array input, and store=false.' } })
      return
    }

    const authorization = req.headers.authorization
    const acceptedReplacementProbe = authorization === `Bearer ${OPENAI_SMOKE_REPLACEMENT_KEY}` &&
      mode === 'failed-probe' && isProbe(body)
    if (authorization !== `Bearer ${OPENAI_SMOKE_KEY}` && !acceptedReplacementProbe) {
      json(res, 401, { error: { message: 'Unauthorized.' } })
      return
    }
    if (requests.length >= MAX_CAPTURED_REQUESTS) {
      json(res, 429, { error: { message: 'Fixture request history is full.' } })
      return
    }
    requests.push(structuredClone(body))
    const id = `resp_openai_smoke_${++sequence}`

    if (acceptedReplacementProbe) {
      json(res, 200, {
        ...responseObject(id, 'failed', [], { input_tokens: 1, output_tokens: 1 }),
        error: { code: 'fixture_probe_failure', message: 'The replacement credential was refused by the local fixture.' },
      })
      return
    }

    if (isProbe(body)) {
      json(res, 200, probeResponse())
      return
    }
    if (body.stream !== true) {
      json(res, 400, { error: { message: 'Ordinary Responses requests must stream.' } })
      return
    }
    const hasToolOutput = Array.isArray(body.input) && body.input.some((item) => item?.type === 'function_call_output')
    if (mode === 'tools' && !hasToolOutput) {
      streamToolCall(res, id)
      return
    }
    streamText(res, id, mode === 'tools' ? TOOL_REPLY : TEXT_REPLY)
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
    origin: `http://127.0.0.1:${port}/v1`,
    requests,
    get catalogCount() { return catalogCount },
    setMode(nextMode) {
      if (!['tools', 'text', 'failed-probe'].includes(nextMode)) throw new TypeError('Unsupported OpenAI fixture mode.')
      mode = nextMode
    },
    close() {
      if (closing) return closing
      closing = new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}
