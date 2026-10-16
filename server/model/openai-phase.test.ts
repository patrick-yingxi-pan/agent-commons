/** Phase persistence locks for the native Responses adapter.
 *
 * A loopback peer exercises the real generation seam without contacting a paid
 * provider. Phase is scoped to provider MESSAGE items; app and host prose stays
 * readable as text without inventing provider metadata.
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { generateReply, type ReplyHistoryTurn, type ReplySession } from '../generate.ts'
import type { ProviderConfig } from '../data/providers.ts'
import { MAX_ASSISTANT_TEXT_ITEMS } from '../../contract/assistantTextItems.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import type { ApiToolRuntime } from './apiTools.ts'

type SeenRequest = { method: string; path: string; body?: any }
type Script = (request: SeenRequest, response: ServerResponse) => void | Promise<void>

const requests: SeenRequest[] = []
let server: Server
let baseURL = ''
let script: Script = defaultScript

async function readRequest(req: IncomingMessage): Promise<SeenRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return {
    method: req.method ?? 'GET',
    path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
    ...(raw ? { body: JSON.parse(raw) } : {}),
  }
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function responseObject(output: unknown[], model: string) {
  return {
    id: `resp-${requests.length}`,
    object: 'response',
    created_at: 1_760_000_000,
    status: 'completed',
    model,
    output,
    usage: { input_tokens: 11, output_tokens: 7 },
  }
}

function sse(response: ServerResponse, event: Record<string, unknown>): void {
  response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
}

function streamResponse(
  response: ServerResponse,
  result: ReturnType<typeof responseObject> & { incomplete_details?: unknown },
  streamedText?: string,
  terminalEventType = result.status === 'completed' ? 'response.completed' : `response.${result.status}`,
): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  sse(response, { type: 'response.created', response: { ...result, status: 'in_progress', output: [], usage: null } })
  let emittedOverride = false
  result.output.forEach((item: any, output_index: number) => {
    sse(response, { type: 'response.output_item.added', output_index, item: { ...item, status: 'in_progress' } })
    if (item.type === 'function_call') {
      const argumentsText = item.arguments ?? '{}'
      sse(response, { type: 'response.function_call_arguments.delta', item_id: item.id, output_index, delta: argumentsText })
      sse(response, { type: 'response.function_call_arguments.done', item_id: item.id, output_index, name: item.name, arguments: argumentsText })
    }
    if (item.type === 'message') {
      for (const [content_index, part] of (item.content ?? []).entries()) {
        if (part.type === 'output_text' && part.text) {
          const delta = streamedText !== undefined && !emittedOverride ? streamedText : part.text
          emittedOverride ||= streamedText !== undefined
          sse(response, { type: 'response.output_text.delta', item_id: item.id, output_index, content_index, delta })
        } else if (part.type === 'refusal' && part.refusal) {
          sse(response, { type: 'response.refusal.delta', item_id: item.id, output_index, content_index, delta: part.refusal })
        }
      }
    }
    sse(response, { type: 'response.output_item.done', output_index, item })
  })
  sse(response, { type: terminalEventType, response: result })
  response.end()
}

function messageItem(id: string, phase: unknown, parts: Array<Record<string, unknown>>) {
  return { id, type: 'message', role: 'assistant', status: 'completed', ...(phase === undefined ? {} : { phase }), content: parts }
}

function streamCompactMessages(response: ServerResponse, result: ReturnType<typeof responseObject>, streamedText: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  sse(response, { type: 'response.created', response: { ...result, status: 'in_progress', output: [], usage: null } })
  if (streamedText) sse(response, { type: 'response.output_text.delta', item_id: 'compact-text', output_index: 0, content_index: 0, delta: streamedText })
  sse(response, { type: 'response.completed', response: result })
  response.end()
}

function messagesStream(response: ServerResponse): void {
  const events = [
    { type: 'message_start', message: { id: 'msg-plain-protocol', type: 'message', role: 'assistant', content: [], model: 'messages-phase-test', stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Messages reply.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

function textPart(text: string) {
  return { type: 'output_text', text, annotations: [] }
}

function functionCall(id: string, name: string, argumentsText = '{"query":{}}') {
  return { id: `item-${id}`, type: 'function_call', call_id: id, name, arguments: argumentsText, status: 'completed' }
}

async function defaultScript(request: SeenRequest, response: ServerResponse): Promise<void> {
  if (request.body?.stream === true) {
    streamResponse(response, responseObject([messageItem('msg-default', 'final_answer', [textPart('A concise test answer.')])], request.body.model))
    return
  }
  json(response, responseObject([messageItem('msg-default', 'final_answer', [textPart('A concise test answer.')])], request.body?.model ?? 'gpt-test'))
}

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const seen = await readRequest(req)
      requests.push(seen)
      await script(seen, res)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(error instanceof Error ? error.message : String(error))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  baseURL = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}/v1` : ''
  process.env.PROVIDER_OPENAI_PHASE_TEST_KEY = 'openai-phase-loopback-key'
  process.env.PROVIDER_MESSAGES_PHASE_TEST_KEY = 'messages-phase-loopback-key'
})

after(() => {
  delete process.env.PROVIDER_OPENAI_PHASE_TEST_KEY
  delete process.env.PROVIDER_MESSAGES_PHASE_TEST_KEY
  server.closeAllConnections?.()
  server.close()
})

function provider(): ProviderConfig {
  return { protocol: 'openai-responses', baseURL, apiKeyEnv: 'PROVIDER_OPENAI_PHASE_TEST_KEY', model: 'gpt-phase-test', capabilities: { toolUse: true } }
}

function messagesProvider(): ProviderConfig {
  return { protocol: 'anthropic-messages', baseURL: baseURL.replace(/\/v1$/, ''), apiKeyEnv: 'PROVIDER_MESSAGES_PHASE_TEST_KEY', model: 'messages-phase-test', capabilities: { toolUse: false } }
}

const session: ReplySession = { id: 's-openai-phase', title: 'OpenAI phase test' }

function collect() {
  let text = ''
  return { handlers: { onStart: () => {}, onDelta: (delta: string) => { text += delta } }, get text() { return text } }
}

function apiRuntime(onDispatch: () => void = () => {}): ApiToolRuntime {
  return {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      onDispatch()
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"remaining":42}') }
    },
  }
}

function assertItemsMatchContent(message: { content: string; assistantTextItems?: Array<{ text: string; phase?: string | null }> }) {
  assert.ok(message.assistantTextItems, 'completed native Responses prose records ordered assistant message items')
  assert.equal(message.assistantTextItems!.map(item => item.text).join(''), message.content)
}

test('Responses assistant message items preserve item boundaries, phases, and joined multipart text', async () => {
  requests.length = 0
  script = (request, response) => {
    streamResponse(response, responseObject([
      messageItem('msg-commentary', 'commentary', [textPart('Thinking aloud. '), textPart('Still commentary. ')]),
      messageItem('msg-final', 'final_answer', [textPart('The answer.')]),
    ], request.body.model))
  }
  const result = await generateReply(session, DEFAULT_AGENT, 'Explain.', collect().handlers, undefined, provider())

  assert.equal(result.message.content, 'Thinking aloud. Still commentary. The answer.')
  assert.deepEqual(result.message.assistantTextItems, [
    { text: 'Thinking aloud. Still commentary. ', phase: 'commentary' },
    { text: 'The answer.', phase: 'final_answer' },
  ], 'content parts within one provider message join, while distinct message items remain distinct')
  assertItemsMatchContent(result.message)
})

test('tool continuation replays opaque output, preserves phases across rounds, then reconstructs later assistant history', async () => {
  requests.length = 0
  const opaqueReasoning = { id: 'rs_phase_opaque', type: 'reasoning', summary: [], encrypted_content: 'DO-NOT-PERSIST-OPAQUE-REASONING' }
  let dispatches = 0
  script = (request, response) => {
    const model = request.body.model
    if (request.body.input.some((item: any) => item.type === 'function_call_output')) {
      streamResponse(response, responseObject([
        messageItem('msg-final-round', 'final_answer', [textPart('Done.')]),
      ], model))
      return
    }
    if (request.body.input.some((item: any) => item.role === 'assistant' && item.phase)) {
      streamResponse(response, responseObject([messageItem('msg-next', 'final_answer', [textPart('Next turn.')])], model))
      return
    }
    const name = request.body.tools.find((tool: any) => tool.name === 'api__get_usage').name
    streamResponse(response, responseObject([
      messageItem('msg-commentary-round', 'commentary', [textPart('Checking. ')]),
      opaqueReasoning,
      functionCall('call-phase', name),
    ], model))
  }
  const first = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check usage.', collect().handlers, undefined, provider(), undefined, [], apiRuntime(() => { dispatches += 1 }))
  assert.equal(first.outcome, 'ok')
  assert.equal(dispatches, 1)
  assert.deepEqual(first.message.assistantTextItems, [
    { text: 'Checking. ', phase: 'commentary' },
    { text: 'Done.', phase: 'final_answer' },
  ])
  const continuation = requests[1]!.body.input as any[]
  assert.deepEqual(continuation.find(item => item.id === opaqueReasoning.id), opaqueReasoning, 'same-turn tool continuation keeps opaque provider output byte-for-byte')
  assertItemsMatchContent(first.message)
  assert.doesNotMatch(JSON.stringify(first.message), /DO-NOT-PERSIST-OPAQUE-REASONING/)

  const history: ReplyHistoryTurn[] = [{ role: 'assistant', text: first.message.content, assistantTextItems: first.message.assistantTextItems }]
  await generateReply(session, DEFAULT_AGENT, 'Continue.', collect().handlers, undefined, provider(), undefined, [], undefined, {}, history)
  const laterInput = requests.at(-1)!.body.input as any[]
  assert.deepEqual(laterInput.slice(0, 2), [
    { role: 'assistant', content: 'Checking. ', phase: 'commentary' },
    { role: 'assistant', content: 'Done.', phase: 'final_answer' },
  ], 'later turns reconstruct each completed provider message item and phase')
  assert.doesNotMatch(JSON.stringify(laterInput), /DO-NOT-PERSIST-OPAQUE-REASONING/)
})

test('legacy assistant history omits phase, null stays null, and user history cannot acquire phase metadata', async () => {
  requests.length = 0
  script = (request, response) => streamResponse(response, responseObject([messageItem('msg-history', null, [textPart('ok')])], request.body.model))
  const history: ReplyHistoryTurn[] = [
    { role: 'assistant', text: 'Legacy answer.' },
    { role: 'assistant', text: 'Explicit null.', assistantTextItems: [{ text: 'Explicit null.', phase: null }] },
    { role: 'user', text: 'User text.', assistantTextItems: [{ text: 'User text.', phase: 'final_answer' }] } as any,
  ]
  await generateReply(session, DEFAULT_AGENT, 'New turn.', collect().handlers, undefined, provider(), undefined, [], undefined, {}, history)
  const input = requests[0]!.body.input as any[]
  assert.deepEqual(input.slice(0, 4), [
    { role: 'assistant', content: 'Legacy answer.' },
    { role: 'assistant', content: 'Explicit null.', phase: null },
    { role: 'user', content: 'User text.' },
    { role: 'user', content: 'New turn.' },
  ])
})

test('host fallback suffix is a separate unphased item and visible text matches exactly', async () => {
  requests.length = 0
  script = (request, response) => {
    if (request.body.input.some((item: any) => item.type === 'function_call_output')) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"error":"private endpoint body"}')
      return
    }
    const name = request.body.tools.find((tool: any) => tool.name === 'api__get_usage').name
    streamResponse(response, responseObject([
      messageItem('msg-before-failure', 'commentary', [textPart('I checked. ')]),
      functionCall('call-before-failure', name),
    ], request.body.model))
  }
  const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check usage.', collect().handlers, undefined, provider(), undefined, [], apiRuntime())
  assert.equal(result.outcome, 'fallback')
  assert.ok(result.message.content.startsWith('I checked. '))
  assert.deepEqual(result.message.assistantTextItems?.[0], { text: 'I checked. ', phase: 'commentary' })
  assertItemsMatchContent(result.message)
  assert.ok(result.message.assistantTextItems!.slice(1).every(item => item.phase === undefined || item.phase === null), 'host-authored endpoint recovery prose is unphased')
  assert.doesNotMatch(result.message.content, /private endpoint body/)
})

test('an unknown output phase rejects the whole tool response after usage and runs no tools', async () => {
  requests.length = 0
  let dispatches = 0
  script = (request, response) => {
    const name = request.body.tools.find((tool: any) => tool.name === 'api__get_usage').name
    streamResponse(response, responseObject([
      messageItem('msg-bad-phase', 'analysis', [textPart('must not be trusted')]),
      functionCall('call-bad-phase', name),
    ], request.body.model))
  }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Unsafe phase.', {
    ...collect().handlers,
    onUsage: value => usage.push(value),
  }, undefined, provider(), undefined, [], apiRuntime(() => { dispatches += 1 }))

  assert.equal(result.outcome, 'fallback')
  assert.equal(dispatches, 0)
  assert.equal(requests.length, 1, 'invalid phase is terminal; the call is not retried or continued')
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 7 }], 'completed invalid output still records validated usage')
  assertItemsMatchContent(result.message)
  assert.ok(result.message.assistantTextItems!.every(item => item.phase === undefined || item.phase === null), 'invalid provider metadata is never persisted')
})

test('contradictory streamed and terminal text cannot mint trusted phase metadata', async () => {
  requests.length = 0
  script = (request, response) => streamResponse(response, responseObject([
    messageItem('msg-terminal', 'final_answer', [textPart('terminal text')]),
  ], request.body.model), 'streamed text')
  const result = await generateReply(session, DEFAULT_AGENT, 'Mismatch.', collect().handlers, undefined, provider())

  assert.equal(result.outcome, 'fallback')
  assert.equal(requests.length, 1)
  assertItemsMatchContent(result.message)
  assert.ok(result.message.assistantTextItems!.every(item => item.phase === undefined || item.phase === null), 'mismatched terminal text invalidates provider phase metadata')
})

test('malformed stored assistant item metadata falls back to exact prose without a phase', async () => {
  requests.length = 0
  script = (request, response) => streamResponse(response, responseObject([messageItem('msg-malformed-history', null, [textPart('ok')])], request.body.model))
  const exactText = 'Keep this exact historical prose.'
  const history: ReplyHistoryTurn[] = [{
    role: 'assistant',
    text: exactText,
    assistantTextItems: [{ text: 'Keep this exact historical prose.', phase: 'analysis' } as any],
  }]
  await generateReply(session, DEFAULT_AGENT, 'Continue.', collect().handlers, undefined, provider(), undefined, [], undefined, {}, history)

  const input = requests[0]!.body.input as any[]
  assert.deepEqual(input[0], { role: 'assistant', content: exactText }, 'invalid metadata is discarded as a unit; prose is not truncated or assigned a phase')
})

test('4095 native message items fit while 4096 are rejected before tools with exact unphased prose and usage', async () => {
  const runCount = async (count: number, withTool: boolean) => {
    requests.length = 0
    let dispatches = 0
    script = (request, response) => {
      const output = Array.from({ length: count }, (_, index) => messageItem(`msg-${index}`, 'commentary', [textPart('x')]))
      if (withTool) {
        const name = request.body.tools.find((tool: any) => tool.name === 'api__get_usage').name
        output.push(functionCall('call-over-limit', name) as any)
      }
      const result = responseObject(output, request.body.model)
      streamCompactMessages(response, result, 'x'.repeat(count))
    }
    const usage: Array<{ inputTokens: number; outputTokens: number }> = []
    const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Long item sequence.', {
      ...collect().handlers,
      onUsage: value => usage.push(value),
    }, undefined, provider(), undefined, [], withTool ? apiRuntime(() => { dispatches += 1 }) : undefined)
    return { result, usage, dispatches }
  }

  const allowed = await runCount(MAX_ASSISTANT_TEXT_ITEMS - 1, false)
  assert.equal(allowed.result.outcome, 'ok')
  assert.equal(allowed.result.message.assistantTextItems?.length, MAX_ASSISTANT_TEXT_ITEMS - 1)
  assert.equal(allowed.result.message.content, 'x'.repeat(MAX_ASSISTANT_TEXT_ITEMS - 1))
  assert.deepEqual(allowed.usage, [{ inputTokens: 11, outputTokens: 7 }])

  const refused = await runCount(MAX_ASSISTANT_TEXT_ITEMS, true)
  assert.equal(refused.result.outcome, 'fallback')
  assert.equal(refused.dispatches, 0, 'the over-limit response cannot execute its otherwise valid tool')
  assert.deepEqual(refused.usage, [{ inputTokens: 11, outputTokens: 7 }], 'completed over-limit response usage is retained')
  assert.equal(refused.result.message.content.slice(0, MAX_ASSISTANT_TEXT_ITEMS), 'x'.repeat(MAX_ASSISTANT_TEXT_ITEMS))
  assert.equal(refused.result.message.assistantTextItems?.length, 1, 'one reserved item holds the full visible fallback transcript')
  assert.deepEqual(refused.result.message.assistantTextItems?.[0], { text: refused.result.message.content }, 'provider phases are dropped after metadata-limit refusal')
  assertItemsMatchContent(refused.result.message)
})

test('native output phase absence and explicit null persist as distinct metadata', async () => {
  requests.length = 0
  script = (request, response) => streamResponse(response, responseObject([
    messageItem('msg-null-phase', null, [textPart('Explicitly null.')]),
    messageItem('msg-absent-phase', undefined, [textPart('Omitted phase.')]),
  ], request.body.model))
  const result = await generateReply(session, DEFAULT_AGENT, 'Preserve null.', collect().handlers, undefined, provider())

  assert.deepEqual(result.message.assistantTextItems, [
    { text: 'Explicitly null.', phase: null },
    { text: 'Omitted phase.' },
  ])
  assertItemsMatchContent(result.message)
})

test('output-limit fallback prose is retained without trusted native phase', async () => {
  requests.length = 0
  script = (request, response) => {
    const result = {
      ...responseObject([messageItem('msg-limited', 'final_answer', [textPart('Partial provider prose.')])], request.body.model),
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }
    streamResponse(response, result, undefined, 'response.incomplete')
  }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateReply(session, DEFAULT_AGENT, 'Be concise.', {
    ...collect().handlers,
    onUsage: value => usage.push(value),
  }, undefined, provider())

  assert.equal(result.outcome, 'fallback')
  assert.ok(result.message.content.startsWith('Partial provider prose.'))
  assert.match(result.message.content, /reply output limit/i)
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 7 }])
  assert.deepEqual(result.message.assistantTextItems, [{ text: result.message.content }], 'partial stream and host limit note are kept together as unphased transcript prose')
  assertItemsMatchContent(result.message)
})

test('immediate native endpoint failure stores exact host fallback prose as one unphased assistant item', async () => {
  requests.length = 0
  script = (_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{"error":"private endpoint diagnostic"}')
  }
  const result = await generateReply(session, DEFAULT_AGENT, 'Try the unavailable model.', collect().handlers, undefined, provider())

  assert.equal(result.outcome, 'fallback')
  assert.equal(requests.length, 1)
  assert.ok(result.message.content.length > 0)
  assert.deepEqual(result.message.assistantTextItems, [{ text: result.message.content }])
  assertItemsMatchContent(result.message)
  assert.doesNotMatch(result.message.content, /private endpoint diagnostic/)
})

test('Messages protocol receives exact plain-text assistant history without native item metadata', async () => {
  requests.length = 0
  script = (request, response) => {
    assert.equal(request.path, '/v1/messages')
    messagesStream(response)
  }
  const exactText = 'Commentary. Final answer. Host receipt.'
  const history: ReplyHistoryTurn[] = [{
    role: 'assistant',
    text: exactText,
    assistantTextItems: [
      { text: 'Commentary. ', phase: 'commentary' },
      { text: 'Final answer.', phase: 'final_answer' },
      { text: ' Host receipt.' },
    ],
  }]
  const result = await generateReply(session, DEFAULT_AGENT, 'Continue.', collect().handlers, undefined, messagesProvider(), undefined, [], undefined, {}, history)

  assert.equal(result.outcome, 'ok')
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]!.body.messages[0], { role: 'assistant', content: exactText })
  assert.deepEqual(requests[0]!.body.messages[1], { role: 'user', content: 'Continue.' })
  assert.doesNotMatch(JSON.stringify(requests[0]!.body.messages), /assistantTextItems|commentary|final_answer|phase/)
})

