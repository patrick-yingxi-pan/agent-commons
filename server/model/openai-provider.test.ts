/** Integration locks for the native OpenAI Responses provider protocol.
 *
 * The peer below is a local HTTP server. These tests exercise the public model
 * generation seam and never call a paid or remote provider. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { generateCompactionSummaryPart, generateContributionReview, generateReply, fetchProviderModels, probeProviderEndpoint, type ReplySession } from '../generate.ts'
import { ProviderProbeError, type ProviderConfig } from '../data/providers.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import type { ApiToolRuntime } from './apiTools.ts'
import type { ChangesetVersion } from '../../contract/contributions.ts'

type SeenRequest = { method: string; path: string; authorization?: string; body?: any }
type Script = (request: SeenRequest, response: ServerResponse) => void | Promise<void>

const requests: SeenRequest[] = []
let server: Server
let baseURL = ''
let script: Script = defaultScript
let accepted: (() => void) | undefined

function address(): string {
  const value = server.address()
  return typeof value === 'object' && value ? `http://127.0.0.1:${value.port}/v1` : ''
}

async function readRequest(req: IncomingMessage): Promise<SeenRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return {
    method: req.method ?? 'GET',
    path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
    authorization: req.headers.authorization,
    ...(raw ? { body: JSON.parse(raw) } : {}),
  }
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function responseObject(output: unknown[], model: string, usage = { input_tokens: 11, output_tokens: 7 }) {
  return {
    id: `resp-${requests.length}`,
    object: 'response',
    created_at: 1_760_000_000,
    status: 'completed',
    model,
    output,
    usage,
  }
}

function sse(response: ServerResponse, event: Record<string, unknown>): void {
  response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
}

function streamResponse(response: ServerResponse, result: ReturnType<typeof responseObject>): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  sse(response, { type: 'response.created', response: { ...result, status: 'in_progress', output: [], usage: null } })
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
          sse(response, { type: 'response.output_text.delta', item_id: item.id, output_index, content_index, delta: part.text })
        }
      }
    }
    sse(response, { type: 'response.output_item.done', output_index, item })
  })
  sse(response, { type: 'response.completed', response: result })
  response.end()
}

function textOutput(text: string) {
  return {
    id: `msg-${requests.length}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
}

async function defaultScript(request: SeenRequest, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.path === '/v1/models') {
    json(response, { object: 'list', data: [{ id: 'gpt-test', object: 'model', created: 1_760_000_000, owned_by: 'test' }] })
    return
  }
  const model = request.body?.model ?? 'gpt-test'
  if (request.body?.stream === true) {
    streamResponse(response, responseObject([textOutput('A concise test answer.')], model))
    return
  }
  json(response, responseObject([textOutput('A concise test answer.')], model))
}

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const seen = await readRequest(req)
      requests.push(seen)
      accepted?.()
      accepted = undefined
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
  baseURL = address()
  process.env.PROVIDER_OPENAI_TEST_KEY = 'openai-local-test-key'
})

after(() => {
  delete process.env.PROVIDER_OPENAI_TEST_KEY
  server.closeAllConnections?.()
  server.close()
})

function provider(model = 'gpt-test'): ProviderConfig {
  return { protocol: 'openai-responses', baseURL, apiKeyEnv: 'PROVIDER_OPENAI_TEST_KEY', model, capabilities: { toolUse: true } }
}

const session: ReplySession = { id: 'openai-responses-integration', title: 'OpenAI Responses integration' }
function collect() {
  let text = ''
  return { handlers: { onStart: () => {}, onDelta: (delta: string) => { text += delta } }, get text() { return text } }
}

test('malformed provider JSON never exposes upstream response fragments in a connection error', async () => {
  requests.length = 0
  script = async (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('fake-private-response-marker')
  }
  await assert.rejects(probeProviderEndpoint(provider()), error => {
    assert.ok(error instanceof ProviderProbeError)
    assert.doesNotMatch(error.message, /fake-private/)
    assert.match(error.message, /invalid JSON/)
    return true
  })
  assert.equal(requests.length, 1, 'malformed output is not a capability retry')
})

test('a rejected authorization header never exposes the supplied key in a probe error', async () => {
  requests.length = 0
  const previous = process.env.PROVIDER_OPENAI_TEST_KEY
  process.env.PROVIDER_OPENAI_TEST_KEY = 'synthetic-private-header-marker\ninvalid'
  try {
    await assert.rejects(probeProviderEndpoint(provider()), error => {
      assert.ok(error instanceof ProviderProbeError)
      assert.doesNotMatch(error.message, /synthetic-private-header-marker/)
      return true
    })
    assert.equal(requests.length, 0, 'invalid headers are rejected before network I/O')
  } finally {
    process.env.PROVIDER_OPENAI_TEST_KEY = previous
  }
})

test('Responses endpoint is probed and listed through authenticated native routes', async () => {
  requests.length = 0
  script = async (request, response) => {
    if (request.method === 'GET') {
      json(response, { object: 'list', data: [{ id: 'gpt-test', object: 'model', created: 1_760_000_000, owned_by: 'openai' }] })
      return
    }
    json(response, responseObject([textOutput('ok')], request.body.model))
  }

  assert.deepEqual(await probeProviderEndpoint(provider()), { toolUse: true })
  assert.deepEqual(await fetchProviderModels(provider()), [{ id: 'gpt-test', label: 'gpt-test' }])
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.path, '/v1/responses')
  assert.equal(requests[0]?.authorization, 'Bearer openai-local-test-key')
  assert.equal(requests[0]?.body.model, 'gpt-test')
  assert.equal(requests[0]?.body.store, false)
  assert.equal(requests[1]?.method, 'GET')
  assert.equal(requests[1]?.path, '/v1/models')
  assert.equal(requests[1]?.authorization, 'Bearer openai-local-test-key')
})

test('a 401 during OpenAI probing is terminal and is not retried as a no-tools probe', async () => {
  requests.length = 0
  script = async (_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'fixture auth failure' } }))
  }
  await assert.rejects(probeProviderEndpoint(provider()), ProviderProbeError)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.path, '/v1/responses')
  assert.equal(requests[0]?.authorization, 'Bearer openai-local-test-key')
})

test('streamed function calls use the shared tool loop, meter before effect, and replay opaque reasoning', async () => {
  requests.length = 0
  const reasoning = { id: 'rs_opaque_123', type: 'reasoning', summary: [], encrypted_content: 'opaque-provider-payload-DO-NOT-REWRITE' }
  let dispatched = 0
  let usageSeenBeforeDispatch = false
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      dispatched += 1
      usageSeenBeforeDispatch = usage.length === 1
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"remaining":42}') }
    },
  }
  script = async (request, response) => {
    const model = request.body.model
    if (request.body.input?.some((item: any) => item.type === 'function_call_output')) {
      streamResponse(response, responseObject([textOutput('The account has 42 units remaining.')], model, { input_tokens: 13, output_tokens: 8 }))
      return
    }
    const fn = request.body.tools.find((tool: any) => tool.type === 'function')
    assert.ok(fn, 'the API catalog is translated into a Responses function tool')
    streamResponse(response, responseObject([
      reasoning,
      { id: 'fc_item_1', type: 'function_call', call_id: 'call_1', name: fn.name, arguments: '{"query":{}}', status: 'completed' },
    ], model, { input_tokens: 11, output_tokens: 5 }))
  }

  const c = collect()
  const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', {
    ...c.handlers,
    onUsage: row => usage.push(row),
  }, undefined, provider(), undefined, [], api)

  assert.equal(result.outcome, 'ok')
  assert.equal(c.text, 'The account has 42 units remaining.')
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 5 }, { inputTokens: 13, outputTokens: 8 }])
  assert.equal(dispatched, 1)
  assert.equal(usageSeenBeforeDispatch, true)
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.method, 'POST')
    assert.equal(request.path, '/v1/responses')
    assert.equal(request.authorization, 'Bearer openai-local-test-key')
    assert.equal(request.body.store, false, 'requests do not create server-side provider state')
    assert.equal(request.body.model, 'gpt-test')
  }
  const first = requests[0]!.body
  assert.equal(first.stream, true)
  assert.ok(first.tools.some((tool: any) => tool.type === 'function' && tool.name === 'api__get_usage'))
  const continuation = requests[1]!.body.input as any[]
  assert.ok(continuation.some(item => item.type === 'function_call_output' && item.call_id === 'call_1'))
  assert.deepEqual(continuation.find(item => item.id === reasoning.id), reasoning, 'encrypted reasoning is forwarded byte-for-byte as provider-owned opaque data')
})

test('OpenAI image input is translated into a Responses input_image data URL', async () => {
  requests.length = 0
  script = defaultScript
  const image = {
    mimeType: 'image/png' as const,
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1, height: 1, byteLength: 68,
  }
  const imageId = `img-${'a'.repeat(64)}`
  const result = await generateReply({
    ...session,
    attachments: [{ id: 'photo', label: 'diagram.png', kind: 'photo', image: { id: imageId, mimeType: image.mimeType, width: 1, height: 1, byteLength: image.byteLength } }],
    images: { [imageId]: image },
  }, DEFAULT_AGENT, 'Describe the attached image.', collect().handlers, undefined, provider('gpt-image'))

  assert.equal(result.outcome, 'ok')
  const request = requests[0]!
  assert.equal(request.path, '/v1/responses')
  const user = request.body.input.find((item: any) => item.role === 'user')
  assert.ok(user)
  const imagePart = user.content.find((part: any) => part.type === 'input_image')
  assert.deepEqual(imagePart, { type: 'input_image', image_url: `data:image/png;base64,${image.data}` })
  assert.ok(user.content.some((part: any) => part.type === 'input_text' && /diagram\.png/.test(part.text)))
})

test('tool-free compaction uses Responses, streams no side effects, and records its settled usage', async () => {
  requests.length = 0
  script = async (request, response) => {
    json(response, responseObject([textOutput('A compact summary.')], request.body.model, { input_tokens: 19, output_tokens: 6 }))
  }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateCompactionSummaryPart('Summarize this frozen history.', provider('gpt-compactor'), undefined, row => usage.push(row))
  assert.equal(result.text, 'A compact summary.')
  assert.deepEqual(usage, [{ inputTokens: 19, outputTokens: 6 }])
  assert.equal(requests.length, 1)
  const request = requests[0]!
  assert.equal(request.method, 'POST')
  assert.equal(request.path, '/v1/responses')
  assert.equal(request.body.model, 'gpt-compactor')
  assert.equal(request.body.store, false)
  assert.equal(Object.hasOwn(request.body, 'tools'), false)
})

test('tool-free contribution review accepts typed JSON from a response containing opaque reasoning', async () => {
  requests.length = 0
  const reasoning = { id: 'rs_review_opaque', type: 'reasoning', summary: [], encrypted_content: 'opaque-review-reasoning' }
  const review = { summary: 'The proposed rule leaves one edge case open.', findings: [{ entryId: 'entry-review', body: 'Specify whether the rule applies during recovery.' }] }
  script = async (request, response) => {
    json(response, responseObject([
      reasoning,
      textOutput(JSON.stringify(review)),
    ], request.body.model, { input_tokens: 31, output_tokens: 12 }))
  }
  const changeset: ChangesetVersion = {
    version: 3,
    at: 1_760_000_000_000,
    by: 'review-author',
    entries: [{ id: 'entry-review', kind: 'instructions', target: 'release policy', before: 'old wording', after: 'new wording' }],
  }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateContributionReview(changeset, DEFAULT_AGENT, provider('gpt-review'), row => usage.push(row))

  assert.deepEqual(result, review)
  assert.deepEqual(usage, [{ inputTokens: 31, outputTokens: 12 }])
  assert.equal(requests.length, 1)
  const request = requests[0]!
  assert.equal(request.path, '/v1/responses')
  assert.equal(request.body.store, false)
  assert.equal(request.body.model, 'gpt-review')
  assert.equal(Object.hasOwn(request.body, 'tools'), false)
  assert.equal(request.body.include.includes('reasoning.encrypted_content'), true)
  assert.equal(request.body.input.length, 1)
  assert.equal(request.body.input[0].role, 'user')
  assert.deepEqual(JSON.parse(request.body.input[0].content), { version: 3, entries: changeset.entries })
  assert.match(request.body.instructions, /Return exactly one JSON object/)
})

test('incomplete terminal tool response records usage but never dispatches its call', async () => {
  requests.length = 0
  let dispatches = 0
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
  }
  script = async (request, response) => {
    const fn = request.body.tools.find((tool: any) => tool.type === 'function')
    const call = { id: 'fc_incomplete', type: 'function_call', call_id: 'call_incomplete', name: fn.name, arguments: '{"query":{}}', status: 'completed' }
    const terminal = responseObject([call], request.body.model, { input_tokens: 21, output_tokens: 9 })
    terminal.status = 'incomplete'
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    sse(response, { type: 'response.created', response: { ...terminal, status: 'in_progress', output: [], usage: null } })
    sse(response, { type: 'response.output_item.added', output_index: 0, item: { ...call, status: 'in_progress' } })
    sse(response, { type: 'response.function_call_arguments.done', output_index: 0, item_id: call.id, name: call.name, arguments: call.arguments })
    sse(response, { type: 'response.incomplete', response: { ...terminal, incomplete_details: { reason: 'max_output_tokens' } } })
    response.end()
  }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', {
    ...collect().handlers, onUsage: row => usage.push(row),
  }, undefined, provider('gpt-incomplete-terminal'), undefined, [], api)

  assert.equal(result.outcome, 'fallback')
  assert.equal(requests[0]?.path, '/v1/responses')
  assert.deepEqual(usage, [{ inputTokens: 21, outputTokens: 9 }], 'settled usage is recorded before terminal-status handling')
  assert.equal(dispatches, 0)
})

test('malformed arguments and duplicate call ids refuse the entire tool batch', async t => {
  for (const scenario of ['malformed-arguments', 'duplicate-call-id'] as const) {
    await t.test(scenario, async () => {
      requests.length = 0
      let dispatches = 0
      const api: ApiToolRuntime = {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
      }
      script = async (request, response) => {
        const fn = request.body.tools.find((tool: any) => tool.type === 'function')
        const calls = scenario === 'malformed-arguments'
          ? [{ id: 'fc_bad', type: 'function_call', call_id: 'call_bad', name: fn.name, arguments: '{"query":', status: 'completed' }]
          : [
              { id: 'fc_dup_1', type: 'function_call', call_id: 'call_dup', name: fn.name, arguments: '{"query":{}}', status: 'completed' },
              { id: 'fc_dup_2', type: 'function_call', call_id: 'call_dup', name: fn.name, arguments: '{"query":{}}', status: 'completed' },
            ]
        streamResponse(response, responseObject(calls, request.body.model, { input_tokens: 17, output_tokens: 8 }))
      }
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', {
        ...collect().handlers, onUsage: row => usage.push(row),
      }, undefined, provider(`gpt-${scenario}`), undefined, [], api)
      assert.equal(result.outcome, 'fallback')
      assert.equal(result.failure, 'invalid_model_response')
      assert.equal(requests[0]?.path, '/v1/responses')
      assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 8 }])
      assert.equal(dispatches, 0, 'invalid output does not partially execute valid-looking sibling calls')
    })
  }
})

test('completed and incomplete invalid Responses output is classified as a terminal model failure', async t => {
  for (const scenario of ['completed-malformed-call', 'incomplete-call'] as const) {
    await t.test(scenario, async () => {
      requests.length = 0
      let dispatches = 0
      const api: ApiToolRuntime = {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
      }
      script = async (request, response) => {
        const fn = request.body.tools.find((tool: any) => tool.type === 'function')
        const incomplete = scenario === 'incomplete-call'
        const call = {
          id: `fc_${scenario}`,
          type: 'function_call',
          call_id: `call_${scenario}`,
          name: fn.name,
          arguments: incomplete ? '{"query":{}}' : '{"query":',
          ...(incomplete ? { status: 'in_progress' } : { status: 'completed' }),
        }
        const terminal = responseObject([call], request.body.model, { input_tokens: 23, output_tokens: 10 })
        if (incomplete) terminal.status = 'incomplete'
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        sse(response, { type: 'response.created', response: { ...terminal, status: 'in_progress', output: [], usage: null } })
        sse(response, { type: 'response.output_item.added', output_index: 0, item: { ...call, status: 'in_progress' } })
        sse(response, { type: 'response.function_call_arguments.done', output_index: 0, item_id: call.id, name: call.name, arguments: call.arguments })
        sse(response, { type: incomplete ? 'response.incomplete' : 'response.completed', response: terminal })
        response.end()
      }
      const usage: Array<{ inputTokens: number; outputTokens: number }> = []
      const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', {
        ...collect().handlers, onUsage: row => usage.push(row),
      }, undefined, provider(`gpt-${scenario}`), undefined, [], api)
      assert.equal(result.outcome, 'fallback')
      assert.equal(result.failure, 'invalid_model_response')
      assert.match(result.message.content, /invalid|incomplete|could not complete/i)
      assert.doesNotMatch(result.message.content, /endpoint became unreachable|couldn’t reach the model endpoint/i)
      assert.equal(requests[0]?.path, '/v1/responses')
      assert.deepEqual(usage, [{ inputTokens: 23, outputTokens: 10 }])
      assert.equal(dispatches, 0)
    })
  }
})

test('incomplete streamed function output is never executed without response.completed', async () => {
  requests.length = 0
  let dispatches = 0
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
  }
  script = async (request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    sse(response, { type: 'response.created', response: { id: 'resp-truncated', status: 'in_progress', output: [], usage: null } })
    const fn = request.body.tools.find((tool: any) => tool.type === 'function')
    const item = { id: 'fc_truncated', type: 'function_call', call_id: 'call_truncated', name: fn.name, arguments: '{"query":{}}' }
    sse(response, { type: 'response.output_item.added', output_index: 0, item })
    sse(response, { type: 'response.function_call_arguments.done', output_index: 0, item_id: item.id, name: item.name, arguments: item.arguments })
    response.end()
  }
  const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', collect().handlers,
    undefined, provider('gpt-truncated'), undefined, [], api)
  assert.equal(requests[0]?.path, '/v1/responses', 'the incomplete frame came from the native Responses route')
  assert.equal(result.outcome, 'fallback')
  assert.equal(result.failure, 'invalid_model_response')
  assert.equal(dispatches, 0, 'the partial stream did not authorize a tool effect')
})

test('malformed Responses streams are terminal invalid-model failures and never dispatch tools', async t => {
  const scenarios = [
    'malformed-sse-json',
    'missing-terminal-id',
    'empty-terminal-id',
    'unsupported-content-type',
    'clean-eof-without-terminal',
    'invalid-utf8',
  ] as const

  for (const scenario of scenarios) {
    await t.test(scenario, async () => {
      requests.length = 0
      let dispatches = 0
      const api: ApiToolRuntime = {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
      }
      script = async (_request, response) => {
        const marker = `UPSTREAM_PRIVATE_${scenario}`
        if (scenario === 'unsupported-content-type') {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(marker)
          return
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        if (scenario === 'malformed-sse-json') {
          response.write(`data: {"private":"${marker}\n\n`)
        } else if (scenario === 'missing-terminal-id' || scenario === 'empty-terminal-id') {
          sse(response, { type: 'response.created', response: { id: 'resp-created', status: 'in_progress', output: [], usage: null } })
          const terminal = responseObject([textOutput('answer')], _request.body.model)
          if (scenario === 'missing-terminal-id') delete (terminal as any).id
          else terminal.id = ''
          sse(response, { type: 'response.completed', response: terminal })
        } else if (scenario === 'clean-eof-without-terminal') {
          sse(response, { type: 'response.created', response: { id: 'resp-eof', status: 'in_progress', output: [], usage: null } })
        } else if (scenario === 'invalid-utf8') {
          response.write(Buffer.from([0xff, 0xfe, 0x80]))
        }
        response.end()
      }

      const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', collect().handlers,
        undefined, provider(`gpt-${scenario}`), undefined, [], api)

      assert.equal(result.outcome, 'fallback')
      assert.equal(result.failure, 'invalid_model_response')
      assert.doesNotMatch(result.message.content, /UPSTREAM_PRIVATE_/)
      assert.equal(requests[0]?.path, '/v1/responses')
      assert.equal(dispatches, 0)
    })
  }
})

test('genuine Responses HTTP and connection failures remain retryable endpoint failures', async t => {
  for (const scenario of ['http-503', 'connection-reset'] as const) {
    await t.test(scenario, async () => {
      requests.length = 0
      script = async (_request, response) => {
        if (scenario === 'http-503') {
          response.writeHead(503, { 'content-type': 'application/json' })
          response.end('{"error":"UPSTREAM_PRIVATE_HTTP_503"}')
        } else {
          response.destroy(new Error('UPSTREAM_PRIVATE_CONNECTION_RESET'))
        }
      }
      let dispatches = 0
      const api: ApiToolRuntime = {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
      }
      const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', collect().handlers,
        undefined, provider(`gpt-${scenario}`), undefined, [], api)

      assert.equal(result.outcome, 'fallback')
      assert.equal(result.failure, 'endpoint_unavailable')
      assert.doesNotMatch(result.message.content, /UPSTREAM_PRIVATE_/)
      assert.equal(requests[0]?.path, '/v1/responses')
      assert.equal(dispatches, 0)
    })
  }
})

test('caller cancellation aborts an in-flight Responses stream before any tool effect', async () => {
  requests.length = 0
  let dispatches = 0
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => { dispatches += 1; return { status: 200, headers: {}, body: Buffer.from('{}') } },
  }
  script = async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    sse(response, { type: 'response.created', response: { id: 'resp-cancel', status: 'in_progress', output: [], usage: null } })
    await new Promise<void>(resolve => { accepted = resolve })
  }
  const controller = new AbortController()
  let requestStarted!: () => void
  const started = new Promise<void>(resolve => { requestStarted = resolve })
  accepted = requestStarted
  const work = generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check my usage.', collect().handlers,
    controller.signal, provider('gpt-cancel'), undefined, [], api)
  await started
  controller.abort()
  await assert.rejects(work)
  assert.equal(requests[0]?.path, '/v1/responses', 'the cancelled request used the native Responses route')
  assert.equal(dispatches, 0)
})
