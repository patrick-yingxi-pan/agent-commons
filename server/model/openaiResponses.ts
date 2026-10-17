/** Native Responses wire adapter. Execution policy lives in generate/toolExecution,
 * not here. The existing Messages-shaped document is the internal vocabulary;
 * opaque Responses output stays in a WeakMap for lossless same-turn replay. */
import type Anthropic from '@anthropic-ai/sdk'
import { positiveNumberEnv } from '../env.ts'
import { fetchOpenAIWithRetry } from './openaiRequest.ts'
export { EndpointHttpError, EndpointRetryWaitError } from './openaiRequest.ts'
import { isAssistantTextItems, MAX_ASSISTANT_TEXT_ITEMS, type AssistantTextItem } from '../../contract/assistantTextItems.ts'

type Request = Anthropic.MessageCreateParamsNonStreaming
type Options = { signal?: AbortSignal | null }
type Json = Record<string, unknown>
export type EndpointMessage = Pick<Anthropic.Message, 'id' | 'role' | 'content' | 'stop_reason'> & {
  usage: Pick<Anthropic.Usage, 'input_tokens' | 'output_tokens'>
  assistantTextItems?: AssistantTextItem[]
}
type StartEvent = { type: 'message_start'; message: { id: string } }
type ListPage = { data: unknown[] }
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_STREAM_BYTES = 32 * 1024 * 1024
const replay = new WeakMap<object, unknown[]>()

/** Later turns reconstruct only visible message items. Same-turn continuation
 * still uses the original opaque output identity below, including reasoning. */
export function responsesHistoryContent(text: string, items: unknown): string | Anthropic.TextBlockParam[] {
  if (!isAssistantTextItems(items, text, MAX_ASSISTANT_TEXT_ITEMS + 1)) return text
  const content: Anthropic.TextBlockParam[] = [{ type: 'text', text }]
  replay.set(content, items.map(item => ({ role: 'assistant', content: item.text,
    ...(Object.hasOwn(item, 'phase') ? { phase: item.phase } : {}),
  })))
  return content
}

/** Deterministic protocol/size failures are not transient endpoint loss. Keep
 * their messages local and do not attach a provider body as an error cause. */
export class EndpointResponseError extends Error {}

function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointResponseError('Invalid Responses payload.')
  return value as Json
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new EndpointResponseError('Invalid Responses identifier.')
  return value
}
function parseJson(value: string): unknown {
  // V8's SyntaxError can quote input bytes. Upstream bodies may echo a key or
  // prompt, so neither probe errors nor stream failures may carry that cause.
  try { return JSON.parse(value) }
  catch { throw new EndpointResponseError('The model endpoint returned invalid JSON.') }
}

/** Do not change optional/recursive MCP schemas to satisfy strict mode. Their
 * exact schema remains the host's authority; Responses must not normalize it. */
function requestBody(request: Request, stream: boolean): Json {
  const input: unknown[] = []
  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      input.push({ role: message.role, content: message.content })
      continue
    }
    const original = replay.get(message.content)
    if (message.role === 'assistant' && original) {
      input.push(...original)
      continue
    }
    let parts: unknown[] = []
    const flush = () => {
      if (parts.length) input.push({ role: message.role, content: parts })
      parts = []
    }
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ type: message.role === 'user' ? 'input_text' : 'output_text', text: block.text })
      } else if (block.type === 'image' && message.role === 'user') {
        if (block.source.type === 'base64') {
          parts.push({ type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}` })
        } else if (block.source.type === 'url') {
          parts.push({ type: 'input_image', image_url: block.source.url })
        } else throw new EndpointResponseError('Unsupported image source for Responses.')
      } else if (block.type === 'tool_result') {
        flush()
        if (typeof block.content !== 'string') throw new EndpointResponseError('Unsupported tool result for Responses.')
        input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.content })
      } else if (block.type === 'tool_use') {
        flush()
        input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) })
      } else throw new EndpointResponseError('Unsupported message block for Responses.')
    }
    flush()
  }
  const tools = request.tools?.map((tool) => {
    if (!('input_schema' in tool)) throw new EndpointResponseError('Only host-owned function tools are supported.')
    return { type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false }
  })
  return {
    model: request.model,
    max_output_tokens: request.max_tokens,
    store: false,
    stream,
    // Accepted by both older and newer Responses servers. Reasoning is opaque,
    // never exposed as prose, persisted or converted to a system instruction.
    include: ['reasoning.encrypted_content'],
    ...(request.system ? { instructions: typeof request.system === 'string' ? request.system : request.system.map(b => b.text).join('\n\n') } : {}),
    ...(request.output_config?.effort ? { reasoning: { effort: request.output_config.effort } } : {}),
    ...(tools?.length ? { tools } : {}),
    input,
  }
}

function normalize(value: unknown): EndpointMessage {
  const raw = object(value)
  const id = string(raw.id)
  const content: Anthropic.ContentBlock[] = []
  const assistantTextItems: AssistantTextItem[] = []
  let invalid = !Array.isArray(raw.output)
  const calls = new Set<string>()
  const output = Array.isArray(raw.output) ? raw.output : []
  for (const value of output) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid = true; continue }
    const item = value as Json
    if (item.type === 'reasoning') continue
    if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
      let text = ''
      if (Object.hasOwn(item, 'phase') && item.phase !== null && item.phase !== 'commentary' && item.phase !== 'final_answer') invalid = true
      for (const value of item.content) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid = true; continue }
        const part = value as Json
        if (part.type === 'output_text' && typeof part.text === 'string') { text += part.text; content.push({ type: 'text', text: part.text, citations: [] }) }
        else if (part.type === 'refusal' && typeof part.refusal === 'string') { text += part.refusal; content.push({ type: 'text', text: part.refusal, citations: [] }) }
        else invalid = true
      }
      assistantTextItems.push({ text, ...(Object.hasOwn(item, 'phase') ? { phase: item.phase as AssistantTextItem['phase'] } : {}) })
    } else if (item.type === 'function_call') {
      try {
        const callId = string(item.call_id), name = string(item.name)
        if (calls.has(callId) || typeof item.arguments !== 'string' || (item.status !== undefined && item.status !== 'completed')) throw new Error()
        calls.add(callId)
        const args: unknown = JSON.parse(item.arguments)
        object(args)
        content.push({ type: 'tool_use', id: callId, name, input: args, caller: { type: 'direct' } })
      } catch { invalid = true }
    } else invalid = true // never execute provider-hosted tools or unknown output
  }
  const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage as Json : {}
  // Preserve invalid/missing counts as NaN so every caller's usage wall refuses
  // them. Never invent zero usage from an incomplete or malformed response.
  const tokens = (value: unknown) => typeof value === 'number' ? value : Number.NaN
  // Null is our invalid sentinel; `refusal` is a legitimate completed Messages
  // answer and must not double as a wire-validation error in the shared loop.
  const tokenLimited = raw.status === 'incomplete' && raw.incomplete_details !== null &&
    typeof raw.incomplete_details === 'object' && (raw.incomplete_details as Json).reason === 'max_output_tokens'
  const stop: EndpointMessage['stop_reason'] = invalid || (raw.status !== 'completed' && !tokenLimited) ? null
    : tokenLimited ? 'max_tokens'
    : content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  replay.set(content, output)
  return { id, role: 'assistant', content, assistantTextItems, stop_reason: stop, usage: {
    input_tokens: tokens(usage.input_tokens), output_tokens: tokens(usage.output_tokens),
  } }
}

/** Bounded byte decoding also covers a peer without Content-Length and a single
 * oversized event. Cancel the reader on terminal frames, failure or deadlines. */
async function* chunks(response: Response, limit: number): AsyncGenerator<string> {
  if (!response.body) throw new EndpointResponseError('The model endpoint returned no body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = (value?: Uint8Array, stream = false) => {
    try { return decoder.decode(value, { stream }) }
    catch { throw new EndpointResponseError('The model endpoint returned invalid UTF-8.') }
  }
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new EndpointResponseError('The model response exceeded its size limit.')
      yield decode(value, true)
    }
    yield decode()
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
async function json(response: Response): Promise<unknown> {
  let body = ''
  for await (const chunk of chunks(response, MAX_RESPONSE_BYTES)) body += chunk
  return parseJson(body)
}

class ResponsesStream {
  private textListeners: Array<(delta: string) => void> = []
  private eventListeners: Array<(event: StartEvent) => void> = []
  private result?: Promise<EndpointMessage>
  private run: (start: (id: string) => void, delta: (text: string) => void) => Promise<EndpointMessage>
  constructor(run: ResponsesStream['run']) { this.run = run }
  on(event: 'text', listener: (delta: string) => void): this
  on(event: 'streamEvent', listener: (event: StartEvent) => void): this
  on(event: 'text' | 'streamEvent', listener: ((delta: string) => void) | ((event: StartEvent) => void)): this {
    if (event === 'text') this.textListeners.push(listener as (delta: string) => void)
    else this.eventListeners.push(listener as (event: StartEvent) => void)
    return this
  }
  finalMessage(): Promise<EndpointMessage> {
    return this.result ??= this.run(
      id => this.eventListeners.forEach(fn => fn({ type: 'message_start', message: { id } })),
      text => this.textListeners.forEach(fn => fn(text)),
    )
  }
}

export function openaiResponsesClient(baseURL: string, key: string, fetcher: typeof fetch = fetch, maxRetries = 0) {
  const request = async (path: string, body: Json | undefined, options: Options): Promise<Response> => {
    // Callers own tighter operation deadlines. Otherwise use the same bounded
    // default as generation; a tool-free call must not wait indefinitely either.
    const signal = options.signal ?? AbortSignal.timeout(positiveNumberEnv(process.env.MODEL_TIMEOUT_MS, 60_000))
    return fetchOpenAIWithRetry(`${baseURL.replace(/\/+$/, '')}/${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, fetcher, maxRetries)
  }
  return {
    messages: {
      async create(body: Request, options: Options = {}): Promise<EndpointMessage> {
        return normalize(await json(await request('responses', requestBody(body, false), options)))
      },
      stream(body: Request, options: Options = {}): ResponsesStream {
        return new ResponsesStream(async (start, delta) => {
          const response = await request('responses', requestBody(body, true), options)
          if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
            await response.body?.cancel().catch(() => {})
            throw new EndpointResponseError('The model endpoint did not return a Responses stream.')
          }
          let buffer = '', lines: string[] = [], streamed = '', responseId = ''
          const dispatch = (): EndpointMessage | undefined => {
            const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
            lines = []
            if (!data) return
            const event = object(parseJson(data))
            if (event.type === 'response.created' && !responseId) { responseId = string(object(event.response).id); start(responseId) }
            if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
              if (!responseId) throw new EndpointResponseError('Responses text arrived before its identity.')
              if (typeof event.delta !== 'string') throw new EndpointResponseError('Invalid Responses text delta.')
              streamed += event.delta
              delta(event.delta)
            }
            if (event.type === 'error') throw new EndpointResponseError('The model stream reported an error.')
            if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
              const message = normalize(event.response)
              if (!responseId) start(message.id)
              if ((responseId && responseId !== message.id) || object(event.response).status !== event.type.slice('response.'.length)) {
                message.stop_reason = null
              }
              const finalText = message.content.filter(b => b.type === 'text').map(b => b.text).join('')
              // Do not duplicate text when a server emits both deltas and terminal
              // output. A missing suffix is safe; contradictory output is not.
              if (!finalText.startsWith(streamed)) message.stop_reason = null
              else if (finalText.length > streamed.length) delta(finalText.slice(streamed.length))
              return message
            }
          }
          for await (const chunk of chunks(response, MAX_STREAM_BYTES)) {
            buffer += chunk
            let newline: number
            while ((newline = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newline).replace(/\r$/, '')
              buffer = buffer.slice(newline + 1)
              if (line) lines.push(line)
              else {
                const message = dispatch()
                if (message) return message
              }
            }
            if (buffer.length + lines.reduce((n, l) => n + l.length, 0) > MAX_RESPONSE_BYTES) throw new EndpointResponseError('The model stream event exceeded its size limit.')
          }
          throw new EndpointResponseError('The model stream ended before a terminal response.')
        })
      },
    },
    models: {
      async list(_params: { limit: number }, options: Options = {}): Promise<ListPage> {
        const raw = object(await json(await request('models', undefined, options)))
        if (!Array.isArray(raw.data)) throw new EndpointResponseError('Invalid model catalog.')
        return { data: raw.data }
      },
    },
  }
}
