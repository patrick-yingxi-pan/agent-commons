/** ── The mock model server (Anthropic Messages API, compatible) ──────────────
 *  A standalone, zero-dependency HTTP server that speaks the Anthropic Messages
 *  API — `POST /v1/messages`, returning either a JSON `Message` or, for
 *  `stream: true`, the Messages streaming SSE event sequence. It holds *mock*
 *  data (canned replies in `replies.ts`), so it stands in for `api.anthropic.com`
 *  during development: the app backend talks to it through the real Anthropic SDK
 *  and, to go live, you just repoint `ANTHROPIC_BASE_URL` at the real API.
 *
 *  Run it standalone with `npm run model`; the main backend also boots it
 *  in-process in mock mode (see server/index.ts). */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { mockReplyText, chunkText } from './replies.ts'

const MODEL_PORT = Number(process.env.MODEL_PORT ?? 8788)
const MODEL_HOST = process.env.MODEL_HOST ?? '127.0.0.1'

let seq = 0
const nextMessageId = () => `msg_mock_${Date.now().toString(36)}${(seq++).toString(36)}`

/** The slice of an Anthropic Messages request the mock reads. */
interface MessagesRequest {
  model?: string
  max_tokens?: number
  system?: string | Array<{ type: string; text?: string }>
  messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
  stream?: boolean
}

/** Flatten Anthropic's `system` (string or text blocks) to a plain string. */
function systemText(system: MessagesRequest['system']): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system.map((b) => b.text ?? '').join('\n')
}

/** The last user message's text (content is a string or an array of blocks). */
function lastUserText(messages: MessagesRequest['messages']): string {
  const last = [...(messages ?? [])].reverse().find((m) => m.role === 'user')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return last.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((res) => {
    const chunks: Uint8Array[] = []
    req.on('data', (c) => chunks.push(c as Uint8Array))
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => res(''))
  })
}

/** Write one Anthropic SSE frame: an `event:` line plus a JSON `data:` line. */
function sse(res: import('node:http').ServerResponse, type: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** A full (non-streaming) Anthropic `Message` response body. */
function messageBody(id: string, model: string, text: string, inputTokens: number) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: chunkText(text).length },
  }
}

function handleMessages(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  readBody(req).then((raw) => {
    let body: MessagesRequest
    try {
      body = raw ? (JSON.parse(raw) as MessagesRequest) : {}
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON' } }))
      return
    }

    const model = body.model ?? 'claude-opus-4-8'
    const system = systemText(body.system)
    const text = mockReplyText(system, lastUserText(body.messages))
    const id = nextMessageId()
    const inputTokens = (system.length + JSON.stringify(body.messages ?? []).length) >> 2 // rough

    // Non-streaming: one JSON Message, like a real `stream: false` request.
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(messageBody(id, model, text, inputTokens)))
      return
    }

    // Streaming: the Anthropic Messages SSE event sequence, paced like a model
    // emitting tokens (a brief "thinking" beat, then word-sized deltas).
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()

    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    })

    const chunks = chunkText(text)
    let i = 0
    let aborted = false
    req.on('close', () => {
      aborted = true
    })

    const startBlock = () => {
      if (aborted || res.writableEnded) return
      sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      sse(res, 'ping', { type: 'ping' })
      tick()
    }
    const tick = () => {
      if (aborted || res.writableEnded) return
      if (i < chunks.length) {
        sse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: chunks[i] },
        })
        i += 1
        setTimeout(tick, 26)
      } else {
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
        sse(res, 'message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: chunks.length },
        })
        sse(res, 'message_stop', { type: 'message_stop' })
        res.end()
      }
    }
    setTimeout(startBlock, 110) // a brief "thinking" beat before the first token
  })
}

/** Boot the mock model server. Tolerates EADDRINUSE so an already-running
 *  standalone instance (`npm run model`) wins and the in-process boot stands down. */
export function startModelServer(port = MODEL_PORT, host = MODEL_HOST): import('node:http').Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'POST' && path === '/v1/messages') {
      handleMessages(req, res)
      return
    }
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, model: 'mock' }))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `no route ${req.method} ${path}` } }))
  })
  server.on('error', (err) => {
    if ((err as { code?: string }).code === 'EADDRINUSE') {
      console.warn(`[mock-model] :${port} in use — assuming an external model server is up; in-process boot stands down`)
    } else {
      throw err
    }
  })
  server.listen(port, host, () => {
    console.log(`[mock-model] http://${host}:${port}/v1/messages  ·  Anthropic Messages API (mock data)`)
  })
  return server
}

// Run standalone when invoked directly (`npm run model`); stay quiet when imported.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) startModelServer()
