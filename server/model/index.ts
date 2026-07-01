/** ── The mock model server (Anthropic Messages API, compatible) ──────────────
 *  A standalone, zero-dependency HTTP server that speaks the Anthropic Messages
 *  API — `POST /v1/messages`, returning either a JSON `Message` or, for
 *  `stream: true`, the Messages streaming SSE event sequence. It is the *only*
 *  fake part of the system: it stands in for `api.anthropic.com`, deciding which
 *  resource-manipulation **tools** a turn calls (intents.ts) and wrapping prose
 *  around them (replies.ts). The app backend talks to it through the real
 *  Anthropic SDK; to go live you repoint `ANTHROPIC_BASE_URL` at the real API.
 *
 *  It implements the real tool-use loop: on the first turn it answers a matched
 *  message with `tool_use` blocks and `stop_reason: "tool_use"`; once the backend
 *  has executed the tools and sent the `tool_result`s back, the second turn
 *  returns the final prose. Run standalone with `npm run model`; the main backend
 *  also boots it in-process in mock mode (see server/index.ts). */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { matchIntents, matchConnectorTools } from './intents.ts'
import { finalReplyText, plainReplyText, chunkText } from './replies.ts'

const MODEL_PORT = Number(process.env.MODEL_PORT ?? 8788)
const MODEL_HOST = process.env.MODEL_HOST ?? '127.0.0.1'

let seq = 0
const nextMessageId = () => `msg_mock_${Date.now().toString(36)}${(seq++).toString(36)}`
const nextToolId = () => `toolu_mock_${Date.now().toString(36)}${(seq++).toString(36)}`

type ContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; id?: string; name?: string; input?: unknown }
  | { type: 'tool_result'; tool_use_id?: string; content?: unknown }
  | { type: string; [k: string]: unknown }

interface ReqMessage {
  role: string
  content: string | ContentBlock[]
}

/** The slice of an Anthropic Messages request the mock reads. */
interface MessagesRequest {
  model?: string
  max_tokens?: number
  system?: string | Array<{ type: string; text?: string }>
  messages?: ReqMessage[]
  tools?: Array<{ name: string }>
  stream?: boolean
}

/** The last user message's plain text (ignoring tool_result blocks). */
function lastUserText(messages: ReqMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return last.content
    .filter((b): b is { type: 'text'; text?: string } => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

/** Whether this is the *second* turn of a tool-use loop — the last user message
 *  carries `tool_result` blocks (the backend reporting what the tools did). */
function isToolResultTurn(messages: ReqMessage[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return !!last && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')
}

/** The tool names called earlier in the conversation — read from the most recent
 *  assistant message's `tool_use` blocks, so the second turn can pick its prose. */
function priorToolNames(messages: ReqMessage[]): string[] {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  if (!lastAssistant || !Array.isArray(lastAssistant.content)) return []
  return lastAssistant.content
    .filter((b): b is { type: 'tool_use'; name?: string } => b.type === 'tool_use')
    .map((b) => b.name ?? '')
    .filter(Boolean)
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

/** Decide what a turn returns: a list of `tool_use` blocks (first turn, message
 *  matched), or `null` to return text. Built-in catalog intents first; failing those,
 *  a connector/MCP tool declared in *this* request (P6 — per-session tools the backend
 *  derived from the attached contexts). */
function toolUseBlocks(messages: ReqMessage[], availableToolNames: string[]): Array<{ id: string; name: string; input: unknown }> | null {
  if (isToolResultTurn(messages)) return null // second turn → prose
  const text = lastUserText(messages)
  const calls = matchIntents(text)
  const all = calls.length ? calls : matchConnectorTools(text, availableToolNames)
  if (!all.length) return null
  return all.map((c) => ({ id: nextToolId(), name: c.name, input: c.input }))
}

/** The prose for a text turn (no tools, or the post-tool second turn). */
function replyText(messages: ReqMessage[]): string {
  if (isToolResultTurn(messages)) return finalReplyText(priorToolNames(messages))
  return plainReplyText(lastUserText(messages))
}

/** A full (non-streaming) Anthropic `Message` response body. */
function messageBody(id: string, model: string, content: ContentBlock[], stopReason: string | null, inputTokens: number, outputTokens: number) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
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
    const messages = body.messages ?? []
    // `input_tokens`, in the Messages-API sense, is the WHOLE prompt the model
    // reads: the `system` prompt + the `tools` schema + the `messages` array —
    // three distinct inputs, summed. (The earlier version counted only `messages`,
    // dropping the system prompt + tools entirely.) Rough estimate, ≈ 4 chars/token.
    const promptChars =
      JSON.stringify(body.system ?? '').length + JSON.stringify(body.tools ?? []).length + JSON.stringify(messages).length
    const inputTokens = promptChars >> 2
    const id = nextMessageId()
    const availableToolNames = (body.tools ?? []).map((t) => t.name)
    const tools = toolUseBlocks(messages, availableToolNames)

    // ── Non-streaming: one JSON Message (tool_use or text) ───────────────────
    if (!body.stream) {
      if (tools) {
        const content: ContentBlock[] = tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input }))
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(messageBody(id, model, content, 'tool_use', inputTokens, tools.length)))
        return
      }
      const text = replyText(messages)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(messageBody(id, model, [{ type: 'text', text }], 'end_turn', inputTokens, chunkText(text).length)))
      return
    }

    // ── Streaming: the Anthropic Messages SSE event sequence ─────────────────
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()

    sse(res, 'message_start', {
      type: 'message_start',
      message: messageBody(id, model, [], null, inputTokens, 0),
    })

    let aborted = false
    req.on('close', () => {
      aborted = true
    })

    if (tools) {
      // A tool-use turn: emit each tool_use block, then stop_reason: tool_use.
      // The whole input arrives as one input_json_delta (the SDK accumulates the
      // partial_json — sending it in one frame is valid).
      tools.forEach((t, i) => {
        if (aborted || res.writableEnded) return
        sse(res, 'content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } })
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input ?? {}) } })
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: i })
      })
      sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: tools.length } })
      sse(res, 'message_stop', { type: 'message_stop' })
      res.end()
      return
    }

    // A text turn: a brief "thinking" beat, then word-sized deltas.
    const chunks = chunkText(replyText(messages))
    let i = 0
    const startBlock = () => {
      if (aborted || res.writableEnded) return
      sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      sse(res, 'ping', { type: 'ping' })
      tick()
    }
    const tick = () => {
      if (aborted || res.writableEnded) return
      if (i < chunks.length) {
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[i] } })
        i += 1
        setTimeout(tick, 26)
      } else {
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
        sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: chunks.length } })
        sse(res, 'message_stop', { type: 'message_stop' })
        res.end()
      }
    }
    setTimeout(startBlock, 110)
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
