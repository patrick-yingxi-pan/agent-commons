/** ── The mock model server (Anthropic Messages API, compatible) ──────────────
 *  A standalone, zero-dependency HTTP server that speaks the Anthropic Messages
 *  API — `POST /v1/messages`, returning either a JSON `Message` or, for
 *  `stream: true`, the Messages streaming SSE event sequence. It is the *only*
 *  fake part of the system: it stands in for `api.anthropic.com`, deciding which
 *  resource-manipulation **tools** a turn calls (intents.ts) and wrapping prose
 *  around them (replies.ts). The app backend talks to it through the real
 *  Anthropic SDK; to go live you repoint `ANTHROPIC_BASE_URL` at the real API.
 *
 *  It implements the real tool-use loop: a matched message answers with
 *  `tool_use` blocks and `stop_reason: "tool_use"`; once the backend has executed
 *  the tools and sent the `tool_result`s back, the model may call another tool
 *  whose input depends on those results, or return final prose. Run standalone
 *  with `npm run model`; the main backend also boots it in-process in mock mode
 *  (see server/index.ts). */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { matchIntents, matchConnectorTools } from './intents.ts'
import { finalReplyText, plainReplyText, chunkText } from './replies.ts'
import { wireModels } from './catalog.ts'

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

/** The initiating user's text survives every tool round. The deterministic mock
 *  reads it when exercising a dependent read→act plan; a real model would reason
 *  over the same complete `messages` document. */
function firstUserText(messages: ReqMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return ''
  if (typeof first.content === 'string') return first.content
  return first.content
    .filter((b): b is { type: 'text'; text?: string } => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

/** Whether this is a post-tool exchange — the last user message carries
 *  `tool_result` blocks (the backend reporting what the tools did). */
function isToolResultTurn(messages: ReqMessage[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return !!last && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')
}

/** The tool names called in the most recent batch — read from the latest
 *  assistant message's `tool_use` blocks so the next exchange can continue. */
function priorToolNames(messages: ReqMessage[]): string[] {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  if (!lastAssistant || !Array.isArray(lastAssistant.content)) return []
  return lastAssistant.content
    .filter((b): b is { type: 'tool_use'; name?: string } => b.type === 'tool_use')
    .map((b) => b.name ?? '')
    .filter(Boolean)
}

/** The `tool_result` texts the backend fed back — a real model reads these before
 *  continuing (an executor REFUSAL must not be narrated as a proposal), so the
 *  mock does too. */
function priorToolResults(messages: ReqMessage[]): string[] {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last || !Array.isArray(last.content)) return []
  return last.content
    .filter((b): b is { type: 'tool_result'; content?: unknown } => b.type === 'tool_result')
    .map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')))
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
function toolUseBlocks(messages: ReqMessage[], availableToolNames: string[], toolsDeclared: boolean): Array<{ id: string; name: string; input: unknown }> | null {
  if (isToolResultTurn(messages)) {
    const original = firstUserText(messages)
    const prior = priorToolNames(messages)
    const declared = new Set(availableToolNames)
    const mayCall = (name: string) => !toolsDeclared || declared.has(name)

    // A deterministic dependent plan for the real multi-round wire shape: the
    // first request reads usage; only after receiving that result does the mock
    // propose the requested project. This is intentionally a normal prompt
    // behavior, not a hidden test endpoint.
    const project = original.match(
      /\bthen\s+create\s+(?:a\s+)?project\s+(?:called\s+)?["“]?([A-Za-z0-9][A-Za-z0-9 -]*?)["”]?(?:[.,!]|$)/i,
    )?.[1]?.trim()
    if (project && prior.includes('api__get_usage') && mayCall('create_project')) {
      return [{ id: nextToolId(), name: 'create_project', input: { name: project, file_session: 'true' } }]
    }

    // Dev-mock liveness probe: a non-concluding model keeps requesting a valid
    // tool so the backend's bounded-loop stop is executable and regression-tested.
    if (/\bkeep requesting tools forever\b/i.test(original) && prior.includes('save_artifact') && mayCall('save_artifact')) {
      return [
        {
          id: nextToolId(),
          name: 'save_artifact',
          input: { name: 'runaway.md', body: 'Runaway loop probe.', meta: 'Document' },
        },
      ]
    }
    return null
  }
  const text = lastUserText(messages)
  // Wire fidelity: a real Anthropic endpoint only emits `tool_use` for tools the
  // request DECLARED. When the caller sent a `tools` array (the generate.ts path
  // always does — even the empty grant `tools: []`), obey it, so an agent's
  // restricted/empty allowlist can't be widened by the keyword matcher. A request
  // with NO `tools` key at all is the standalone-mock dev convenience: fire the
  // full intent catalog (backward compatible; the real security wall is the
  // declared-set guard in generate.ts's executor).
  const declared = new Set(availableToolNames)
  const matched = matchIntents(text)
  const calls = toolsDeclared ? matched.filter((c) => declared.has(c.name)) : matched
  const all = calls.length ? calls : matchConnectorTools(text, availableToolNames)
  if (!all.length) return null
  return all.map((c) => ({ id: nextToolId(), name: c.name, input: c.input }))
}

/** The prose for a text turn (no tools, or a post-tool concluding turn). */
function replyText(messages: ReqMessage[]): string {
  if (isToolResultTurn(messages)) return finalReplyText(priorToolNames(messages), priorToolResults(messages))
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
    const tools = toolUseBlocks(messages, availableToolNames, body.tools !== undefined)

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

    // A text turn: a brief "thinking" beat, then word-sized deltas. A message
    // containing "paced" stretches the delta cadence (`MODEL_PACE_MS`, default
    // 150 ms) so tests can act deterministically *mid-generation* — e.g. switch
    // accounts or cancel while the turn streams (design §5.7). Dev-mock-only knob;
    // no contract change.
    const paceMs = /\bpaced\b/i.test(lastUserText(messages)) ? Number(process.env.MODEL_PACE_MS) || 150 : 26
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
        setTimeout(tick, paceMs)
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
    // The Anthropic Models API face (`GET /v1/models`, cursor-paginated in the real
    // thing; the mock's whole catalog fits one page). The backend fetches this
    // through the same SDK/base-URL seam it generates through, so a provider's
    // model catalog is genuinely *listed from its endpoint*, never a client const.
    if (req.method === 'GET' && path === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ data: wireModels(), has_more: false, first_id: null, last_id: null }))
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
