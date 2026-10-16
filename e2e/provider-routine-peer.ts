import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export type ProviderRoutinePreset = 'anthropic' | 'deepseek' | 'openai'

export type ProviderRoutineRequest = {
  method: string
  path: string
  body?: unknown
}

export type ProviderRoutinePeer = {
  baseURL: string
  modelId: string
  modelLabel: string
  reply: string
  /** Captured protocol requests, kept in memory for the owning test only. */
  requests: ProviderRoutineRequest[]
  /** Generation turns exclude only the explicit endpoint verification probe. */
  generationRequests(): ProviderRoutineRequest[]
  close(): Promise<void>
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw) as unknown
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function usage(reply: string) {
  return { input_tokens: 3, output_tokens: Math.max(1, Math.ceil(reply.length / 4)) }
}

function messageReply(model: string, id: string, reply: string) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: reply }],
    stop_reason: 'end_turn',
    usage: usage(reply),
  }
}

function streamMessage(response: ServerResponse, model: string, id: string, reply: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  const event = (name: string, value: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', { type: 'message_start', message: {
    id, type: 'message', role: 'assistant', model, content: [], stop_reason: null,
    usage: { input_tokens: 3, output_tokens: 0 },
  } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage(reply).output_tokens } })
  event('message_stop', { type: 'message_stop' })
  response.end()
}

function textOutput(id: string, reply: string) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: reply, annotations: [] }],
  }
}

function responseObject(model: string, id: string, reply: string) {
  return {
    id,
    object: 'response',
    created_at: 1_760_000_000,
    status: 'completed',
    model,
    output: [textOutput(`${id}-message`, reply)],
    usage: usage(reply),
  }
}

function streamResponse(response: ServerResponse, result: ReturnType<typeof responseObject>): void {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
  const event = (value: Record<string, unknown>) => response.write(`event: ${String(value.type)}\ndata: ${JSON.stringify(value)}\n\n`)
  event({ type: 'response.created', response: { ...result, status: 'in_progress', output: [], usage: null } })
  for (const [outputIndex, item] of result.output.entries()) {
    event({ type: 'response.output_item.added', output_index: outputIndex, item: { ...item, status: 'in_progress' } })
    const content = item.content[0]
    if (content?.type === 'output_text' && content.text) {
      event({ type: 'response.output_text.delta', item_id: item.id, output_index: outputIndex, content_index: 0, delta: content.text })
    }
    event({ type: 'response.output_item.done', output_index: outputIndex, item })
  }
  event({ type: 'response.completed', response: result })
  response.end()
}

/**
 * Start a local-only Messages or Responses peer for rendered provider workflows.
 * This is an authored protocol fixture, not evidence of live provider compatibility.
 */
export async function startProviderRoutinePeer(preset: ProviderRoutinePreset, stamp: string): Promise<ProviderRoutinePeer> {
  const suffix = stamp.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'fixture'
  const modelId = `${preset}-routine-${suffix}`
  const modelLabel = preset === 'openai' ? modelId : `${preset} Routine fixture ${suffix}`
  const reply = `Local ${preset} fixture completed the Routine turn for ${suffix}.`
  const requests: ProviderRoutineRequest[] = []
  const rootPath = preset === 'deepseek' ? '/anthropic' : preset === 'openai' ? '/v1' : ''
  const modelPath = preset === 'openai' ? `${rootPath}/models` : `${rootPath}/v1/models`
  const generationPath = preset === 'openai' ? `${rootPath}/responses` : `${rootPath}/v1/messages`
  let sequence = 0

  const server: Server = createServer(async (request, response) => {
    let body: unknown
    try {
      body = await readBody(request)
    } catch {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: { message: 'Fixture request body must be valid JSON.' } }))
      return
    }

    const method = request.method ?? 'GET'
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const captured: ProviderRoutineRequest = { method, path, ...(body === undefined ? {} : { body }) }
    requests.push(captured)

    if (method === 'GET' && path === modelPath) {
      if (preset === 'openai') {
        sendJson(response, { object: 'list', data: [{ id: modelId, object: 'model' }] })
      } else {
        sendJson(response, { data: [{ id: modelId, display_name: modelLabel }], has_more: false })
      }
      return
    }

    if (method !== 'POST' || path !== generationPath) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: { message: `Unexpected fixture route: ${method} ${path}` } }))
      return
    }

    sequence += 1
    const requestModel = object(body).model
    const selectedModel = typeof requestModel === 'string' && requestModel ? requestModel : modelId
    const requestId = `${preset}-routine-response-${sequence}`
    if (preset === 'openai') {
      const result = responseObject(selectedModel, requestId, reply)
      if (object(body).stream === true) streamResponse(response, result)
      else sendJson(response, result)
      return
    }

    if (object(body).stream === true) streamMessage(response, selectedModel, requestId, reply)
    else sendJson(response, messageReply(selectedModel, requestId, reply))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Provider Routine fixture did not bind to loopback.')
  }

  const origin = `http://127.0.0.1:${address.port}`
  const baseURL = preset === 'deepseek' ? `${origin}/anthropic` : preset === 'openai' ? `${origin}/v1` : origin
  return {
    baseURL,
    modelId,
    modelLabel,
    reply,
    requests,
    generationRequests: () => requests.filter(({ method, path, body }) => {
      if (method !== 'POST' || path !== generationPath) return false
      const value = object(body)
      const probe = Array.isArray(value.tools) && value.tools.length === 1
        && object(value.tools[0]).name === 'probe_noop'
      return !probe
    }),
    async close() {
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    },
  }
}
