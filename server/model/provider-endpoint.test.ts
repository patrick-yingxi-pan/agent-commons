/** D9 multi-provider: a Model provider is *data* — endpoint (`baseURL`), credential
 *  *reference* (`apiKeyEnv`), model id, probed capabilities — resolved per turn through
 *  the one protocol the backend speaks (the Messages API) and zero provider-specific
 *  backend code. This suite is the proof that going multi-provider "multiplies the real
 *  boundary rather than weakening it": a second provider is exercised against the same
 *  mock endpoint via config alone.
 *
 *  A recording pass-through sits in front of the mock model server: it captures what
 *  the SDK actually sent (path, `x-api-key`, JSON body) and pipes the mock's response
 *  back unchanged — so the tests assert the *request a provider's turn produces* while
 *  the turn still completes for real. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { startModelServer } from './index.ts'
import { generateCompactionSummaryPart, generateReply, probeProviderEndpoint, type ReplySession } from '../generate.ts'
import { COMPACTION_SYSTEM_PROMPT } from '../compaction.ts'
import { ProviderProbeError, type ProviderConfig } from '../data/providers.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import type { Attachment } from '../../contract/entities.ts'
import { messageHistoryText, TOOL_RECEIPT_SYSTEM_ADDITION } from '../toolActivityHistory.ts'
import type { ApiToolRuntime } from './apiTools.ts'

let mock: Server
let recorder: Server
let mockUrl = ''
let recorderUrl = ''

interface SeenRequest {
  path: string
  apiKey: string | undefined
  body: any
}
const seen: SeenRequest[] = []
let fakeStreamModel: string | undefined
let fakeStreamContent: Array<Record<string, unknown>> = []
let fakeStreamStopReason: string | null = null
let fakeStreamMinimumOutputTokens: number | undefined
let fakeStreamInputUsage: Record<string, unknown> = { input_tokens: 17 }
let fakeProbeModel: string | undefined

function anthropicStream(model: string, content: Array<Record<string, unknown>>, stopReason: string): string {
  const events: Array<Record<string, unknown>> = [
    { type: 'message_start', message: { id: `msg-${model}`, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { ...fakeStreamInputUsage, output_tokens: 0 } } },
  ]
  for (const [index, block] of content.entries()) {
    if (block.type === 'text') {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
      )
    } else if (block.type === 'tool_use') {
      const input = JSON.stringify(block.input)
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } },
        { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: input } },
      )
    }
    events.push({ type: 'content_block_stop', index })
  }
  events.push(
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: stopReason === 'stop_sequence' ? '<END>' : null }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  )
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

const session: ReplySession = { id: 's-provider-endpoint', title: 'Provider endpoint test' }

function listenUrl(server: Server): string {
  const addr = server.address()
  return typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
}

before(async () => {
  mock = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => mock.on('listening', () => r()))
  mockUrl = listenUrl(mock)

  recorder = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const apiKey = req.headers['x-api-key']
    const body = raw ? JSON.parse(raw) : undefined
    seen.push({ path: (req.url ?? '').split('?')[0], apiKey: Array.isArray(apiKey) ? apiKey[0] : apiKey, body })
    if (body?.model === fakeProbeModel) {
      const status = body.tools?.length ? 400 : 422
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `SYNTHETIC_PRIVATE_PROVIDER_BODY_MARKER status=${status}` } }))
      return
    }
    if (body?.model === fakeStreamModel && body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const stopReason = fakeStreamMinimumOutputTokens !== undefined && body.max_tokens < fakeStreamMinimumOutputTokens
        ? 'max_tokens' : fakeStreamStopReason!
      res.end(anthropicStream(fakeStreamModel!, fakeStreamContent, stopReason))
      return
    }
    // DeepSeek's official Anthropic-compatible root is `/anthropic`; preserve that
    // request path in the recording assertion, then strip only this proxy mount.
    const proxyPath = (req.url ?? '').startsWith('/anthropic/') ? req.url!.slice('/anthropic'.length) : req.url
    const upstream = await fetch(`${mockUrl}${proxyPath}`, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body: raw || undefined,
    })
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk)
    }
    res.end()
  })
  recorder.listen(0, '127.0.0.1')
  await new Promise<void>((r) => recorder.on('listening', () => r()))
  recorderUrl = listenUrl(recorder)

  // The turn's credential is an env-var *reference* on the config, resolved at call time.
  process.env.PROVIDER_B_KEY = 'provider-b-secret'
  process.env.PROVIDER_DEEPSEEK_KEY = 'deepseek-local-test-key'
  // The ambient default endpoint is the mock itself (NOT the recorder), so a
  // default-config turn landing zero recorder hits proves per-provider client isolation.
  process.env.ANTHROPIC_BASE_URL = mockUrl
})

after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.PROVIDER_B_KEY
  delete process.env.PROVIDER_DEEPSEEK_KEY
  recorder.closeAllConnections?.()
  mock.closeAllConnections?.()
  recorder.close()
  mock.close()
})

function collect() {
  let text = ''
  return {
    handlers: { onStart: () => {}, onDelta: (d: string) => (text += d) },
    get text() {
      return text
    },
  }
}

test('endpoint transport declares attached inspected external tools as proposals and carries durable result truth on the next turn', async () => {
  const id = `mcp-connection-${'c'.repeat(32)}`
  const tool = { name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
  const connection = { id, label: 'External review', revision: 2, status: 'connected', authentication: 'none', inspectedAt: 1, protocolVersion: '2026-07-28', tools: [tool], execution: 'approval-required', executableTools: ['lookup'] }
  const contexts = [{ id, type: 'mcp', label: 'External review', scope: '*' }]
  const model = 'external-mcp-wire-proof'
  const provider = { baseURL: recorderUrl, model, capabilities: { toolUse: true } }
  const output = await generateReply(session, DEFAULT_AGENT, 'Use the attached external MCP tool with query "wire-exact".', collect().handlers,
    undefined, provider, undefined, contexts, undefined, { externalMcpConnections: [connection] })
  assert.equal(output.outcome, 'ok')
  assert.equal(output.message.toolActivities.length, 1)
  const activity = output.message.toolActivities[0]
  assert.equal(activity.status, 'proposed')
  assert.match(activity.id, /^mcp-activity-[a-f0-9-]{36}$/)
  assert.deepEqual(activity.input, { query: 'wire-exact' })
  assert.equal(activity.mcp.toolName, 'lookup')
  const request = seen.find(hit => hit.body?.model === model)
  assert.ok(request)
  assert.deepEqual(request.body.tools.find(entry => entry.name.startsWith('mcp_external_')).input_schema, tool.inputSchema)
  const continuation = seen.filter(hit => hit.body?.model === model).at(-1).body.messages
  const wireCall = continuation.flatMap(turn => Array.isArray(turn.content) ? turn.content : []).find(block => block.type === 'tool_use')
  const wireResult = continuation.flatMap(turn => Array.isArray(turn.content) ? turn.content : []).find(block => block.type === 'tool_result')
  assert.ok(wireCall && wireResult)
  assert.equal(wireResult.tool_use_id, wireCall.id, 'wire correlation retains the provider call id')
  assert.notEqual(activity.id, wireCall.id, 'wire correlation cannot choose durable consent identity')
  const settled = { ...output.message, toolActivities: [{ ...activity, status: 'uncertain', decisionId: 'exact-approved-call', summary: 'The server may have accepted the call. It will not be retried.' }] }
  const history = [{ role: 'assistant', text: messageHistoryText(settled) }]
  const nextModel = 'external-mcp-history-proof'
  await generateReply(session, DEFAULT_AGENT, 'Explain what remains unknown.', collect().handlers,
    undefined, { ...provider, model: nextModel }, undefined, contexts, undefined, { externalMcpConnections: [connection] }, history)
  const next = seen.find(hit => hit.body?.model === nextModel)
  assert.ok(next)
  assert.equal(next.body.messages[0].content, history[0].text)
  assert.match(next.body.messages[0].content, /"status":"uncertain"/)
  assert.ok(next.body.system.includes(TOOL_RECEIPT_SYSTEM_ADDITION))
})

test('DeepSeek official Anthropic-compatible path probes and keeps model tools consent-gated', async () => {
  const id = `mcp-connection-${'d'.repeat(32)}`
  const tool = { name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
  const connection = { id, label: 'External review', revision: 2, status: 'connected', authentication: 'none', inspectedAt: 1, protocolVersion: '2026-07-28', tools: [tool], execution: 'approval-required', executableTools: ['lookup'] }
  const contexts = [{ id, type: 'mcp', label: 'External review', scope: '*' }]
  const config: ProviderConfig = {
    protocol: 'anthropic-messages',
    baseURL: `${recorderUrl}/anthropic`,
    apiKeyEnv: 'PROVIDER_DEEPSEEK_KEY',
    model: 'deepseek-flash',
    replyOutputTokens: 16384,
    capabilities: { toolUse: true },
  }

  assert.deepEqual(await probeProviderEndpoint(config), { toolUse: true })
  const result = await generateReply(session, DEFAULT_AGENT,
    'Use the attached external MCP tool with query "deepseek-path-proof".', collect().handlers,
    undefined, config, undefined, contexts, undefined, { externalMcpConnections: [connection],
      modelInfo: { id: 'deepseek-flash', label: 'DeepSeek', capabilities: { thinking: true } } })
  assert.equal(result.outcome, 'ok')
  assert.equal(result.message.toolActivities?.length, 1)
  assert.equal(result.message.toolActivities?.[0]?.status, 'proposed', 'provider tool requests remain consent proposals')
  assert.deepEqual(result.message.toolActivities?.[0]?.input, { query: 'deepseek-path-proof' })

  const hits = seen.filter(hit => hit.body?.model === 'deepseek-flash')
  assert.ok(hits.length >= 2, 'both the capability probe and real generation reached the proxy')
  assert.ok(hits.every(hit => hit.path === '/anthropic/v1/messages'), 'the recorder observes the official-compatible base path intact')
  assert.ok(hits.every(hit => hit.apiKey === 'deepseek-local-test-key'), 'the provider key reference is used for both probe and turn')
  assert.ok(hits.every(hit => hit.body.tools?.length > 0), 'probe and generation both exercise native Messages tools')
  assert.ok(hits.every(hit => hit.body.model === 'deepseek-flash'), 'the exact configured DeepSeek model is sent')
  assert.ok(hits.every(hit => !Object.hasOwn(hit.body, 'thinking')), 'general thinking does not invent adaptive support on a compatible endpoint')
  assert.ok(hits.filter(hit => hit.body.stream).every(hit => hit.body.max_tokens === 16384), 'every tool continuation keeps the configured output limit')
})

test('Messages reply limit reaches the wire, meters truncation, and never runs an exhausted tool response', async t => {
  fakeStreamModel = 'messages-reply-limit-proof'
  fakeStreamMinimumOutputTokens = 8192
  fakeStreamStopReason = 'end_turn'
  fakeStreamContent = [{ type: 'text', text: 'A bounded local fixture answer.' }]
  t.after(() => {
    fakeStreamModel = undefined
    fakeStreamMinimumOutputTokens = undefined
    fakeStreamStopReason = null
    fakeStreamContent = []
  })
  const config = { baseURL: recorderUrl, model: fakeStreamModel, capabilities: { toolUse: true } }
  const successful = await generateReply(session, DEFAULT_AGENT, 'Answer.', collect().handlers,
    undefined, { ...config, replyOutputTokens: 8192 })
  assert.equal(successful.outcome, 'ok', 'raising the explicit limit allows the same fixture to complete')
  fakeStreamContent.push({ type: 'tool_use', id: 'exhausted-tool', name: 'api__get_usage', input: { query: {} } })
  let dispatches = 0
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => { dispatches += 1; throw new Error('exhausted output cannot dispatch') },
  }
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const streamed = collect()
  const truncated = await generateReply(session, DEFAULT_AGENT, 'Answer.', { ...streamed.handlers, onUsage: row => usage.push(row) },
    undefined, { ...config, replyOutputTokens: 128 }, undefined, [], api)
  assert.equal(truncated.failure, 'invalid_model_response', 'terminal classification prevents automatic routine retries')
  assert.equal(truncated.outcome, 'fallback')
  assert.match(truncated.message.content, /reply output limit.*Models.*not.*retried automatically/s)
  assert.equal(truncated.message.content, streamed.text, 'live and persisted failure remain identical')
  assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 4 }])
  assert.equal(dispatches, 0)
  assert.deepEqual(seen.filter(hit => hit.body?.model === config.model).map(hit => hit.body.max_tokens), [8192, 128], 'one request per explicit turn, without automatic retries')
})

test('streamed Message-start cache usage is recorded before tool execution and counted once', async t => {
  fakeStreamModel = 'messages-cached-usage-proof'
  fakeStreamInputUsage = {
    input_tokens: 17,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
  }
  fakeStreamContent = [{ type: 'tool_use', id: 'cached-usage-tool', name: 'api__get_usage', input: { query: {} } }]
  fakeStreamStopReason = 'tool_use'
  const observed: string[] = []
  const reports: Array<{ inputTokens: number; outputTokens: number }> = []
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      observed.push('tool')
      fakeStreamInputUsage = { input_tokens: 11 }
      fakeStreamContent = [{ type: 'text', text: 'Usage read complete.' }]
      fakeStreamStopReason = 'end_turn'
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"remaining":42}') }
    },
  }
  t.after(() => {
    fakeStreamModel = undefined
    fakeStreamContent = []
    fakeStreamStopReason = null
    fakeStreamMinimumOutputTokens = undefined
    fakeStreamInputUsage = { input_tokens: 17 }
  })

  const result = await generateReply(session, DEFAULT_AGENT, 'Read usage.', {
    ...collect().handlers,
    onUsage: (usage) => {
      reports.push(usage)
      observed.push(`usage:${usage.inputTokens}`)
    },
  }, undefined, { baseURL: recorderUrl, model: fakeStreamModel, capabilities: { toolUse: true } }, undefined, [], api)

  assert.equal(result.outcome, 'ok')
  assert.deepEqual(reports, [
    { inputTokens: 67, outputTokens: 4 },
    { inputTokens: 11, outputTokens: 4 },
  ])
  assert.deepEqual(result.usage, { inputTokens: 78, outputTokens: 8 })
  assert.deepEqual(observed, ['usage:67', 'tool', 'usage:11'], 'the first settled usage is recorded before dispatching its tool')
})

test('failed tool and no-tools probes hide upstream error bodies while retaining status and both attempts', async () => {
  const model = 'messages-private-error-body-proof'
  fakeProbeModel = model
  try {
    await assert.rejects(probeProviderEndpoint({ baseURL: recorderUrl, model }), error => {
      assert.ok(error instanceof ProviderProbeError)
      assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_PROVIDER_BODY_MARKER/)
      assert.match(error.message, /HTTP 422/)
      return true
    })
  } finally {
    fakeProbeModel = undefined
  }
  const attempts = seen.filter(hit => hit.body?.model === model)
  assert.equal(attempts.length, 2)
  assert.ok(attempts.every(hit => hit.path === '/v1/messages'))
  assert.ok(attempts[0]?.body.tools?.length, 'the first attempt checks native tool support')
  assert.equal(attempts[1]?.body.tools, undefined, 'the one fallback attempt is tool-free')
})

test('valid refusal and stop-sequence prose are successful terminal Messages responses with no tool effects', async () => {
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      throw new Error('a terminal prose response must not dispatch a tool')
    },
  }
  for (const [stopReason, model] of [['refusal', 'claude-valid-refusal'], ['stop_sequence', 'claude-valid-stop-sequence']] as const) {
    fakeStreamModel = model
    fakeStreamContent = [{ type: 'text', text: `A complete ${stopReason} answer.` }]
    fakeStreamStopReason = stopReason
    const c = collect()
    const result = await generateReply(session, DEFAULT_AGENT, 'Please answer carefully.', c.handlers,
      undefined, { baseURL: recorderUrl, model, capabilities: { toolUse: true } }, undefined, [], api)
    assert.equal(result.outcome, 'ok')
    assert.equal(c.text, `A complete ${stopReason} answer.`)
    assert.equal(result.message.content, c.text)
    assert.equal(result.message.toolActivities, undefined)
  }
  fakeStreamModel = undefined
  fakeStreamContent = []
  fakeStreamStopReason = null
})

test('empty first Messages replies fail visibly without replay on Claude and DeepSeek paths', async t => {
  for (const mount of ['', '/anthropic']) {
    for (const stopReason of ['end_turn', 'refusal', 'stop_sequence']) {
      for (const text of ['', ' \n\t']) {
        await t.test(`${mount || 'Claude'} ${stopReason} ${text ? 'whitespace' : 'empty'}`, async () => {
          fakeStreamModel = `empty-messages-${seen.length}`
          fakeStreamContent = text ? [{ type: 'text', text }] : []
          fakeStreamStopReason = stopReason
          const start = seen.length
          const usage: Array<{ inputTokens: number; outputTokens: number }> = []
          const c = collect()
          try {
            const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Give me an answer.', {
              ...c.handlers, onUsage: row => usage.push(row),
            }, undefined, { baseURL: `${recorderUrl}${mount}`, model: fakeStreamModel })
            assert.equal(result.outcome, 'fallback')
            assert.equal(result.failure, 'invalid_model_response')
            assert.match(c.text, /incomplete or invalid response/)
            assert.match(c.text, /will not be retried automatically/)
            assert.equal(result.message.content, c.text, 'the streamed notice is also the saved reply')
            assert.equal(result.message.toolActivities, undefined)
            assert.equal(result.message.relationActions, undefined)
            assert.deepEqual(usage, [{ inputTokens: 17, outputTokens: 4 }])
            assert.deepEqual(result.usage, { inputTokens: 17, outputTokens: 4 })
            assert.equal(seen.length - start, 1, 'an empty answer is not automatically regenerated')
            assert.equal(seen[start].path, `${mount}/v1/messages`)
          } finally {
            fakeStreamModel = undefined
            fakeStreamContent = []
            fakeStreamStopReason = null
          }
        })
      }
    }
  }
})

test('a refusal carrying a tool block is invalid and cannot dispatch the tool', async () => {
  fakeStreamModel = 'claude-refusal-with-tool'
  fakeStreamContent = [
    { type: 'text', text: 'This response is refused.' },
    { type: 'tool_use', id: 'refusal-tool-1', name: 'api__get_usage', input: { query: {} } },
  ]
  fakeStreamStopReason = 'refusal'
  let dispatches = 0
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      dispatches += 1
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"remaining":42}') }
    },
  }
  try {
    const result = await generateReply(session, { ...DEFAULT_AGENT, tools: [] }, 'Check usage.', collect().handlers,
      undefined, { baseURL: recorderUrl, model: fakeStreamModel, capabilities: { toolUse: true } }, undefined, [], api)
    assert.equal(result.outcome, 'fallback')
    assert.equal(result.failure, 'invalid_model_response')
    assert.equal(dispatches, 0)
  } finally {
    fakeStreamModel = undefined
    fakeStreamContent = []
    fakeStreamStopReason = null
  }
})

test('a turn on a provider with its own endpoint reaches THAT endpoint, carrying its model id and credential', async () => {
  const providerB: ProviderConfig = {
    baseURL: recorderUrl,
    apiKeyEnv: 'PROVIDER_B_KEY',
    model: 'claude-provider-b',
    capabilities: { toolUse: true },
  }
  const c = collect()
  const { outcome, message } = await generateReply(
    session,
    DEFAULT_AGENT,
    'We ship the new Insights dashboard next week. Help me think through the launch.',
    c.handlers,
    undefined,
    providerB,
  )
  assert.equal(outcome, 'ok', 'the turn completed against the provider endpoint')
  assert.ok(message.content.length > 0, 'prose streamed end to end')
  const hit = seen.find((s) => s.body?.model === 'claude-provider-b')
  assert.ok(hit, 'the provider endpoint received the turn')
  assert.equal(hit.path, '/v1/messages', 'via the Messages protocol route')
  assert.equal(hit.apiKey, 'provider-b-secret', 'authenticated with the referenced credential, not the ambient key')
})

test('an endpoint turn carries only bounded local text attachment content and omits unsupported sources', async () => {
  const model = 'claude-attachment-wire'
  const attachments: Attachment[] = [
    {
      id: 'ui-note',
      label: 'release-notes.md',
      kind: 'file',
      source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      previewText: 'ATTACHMENT_SENTINEL_7f3c: ship the signed release.',
    },
    {
      id: 'remote-secret',
      label: 'private.txt',
      kind: 'file',
      source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
      previewText: 'MUST_NOT_REACH_MODEL_SECRET',
    },
    {
      id: 'photo',
      label: 'diagram.png',
      kind: 'photo',
      source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      previewText: 'MUST_NOT_REACH_MODEL_PHOTO',
    },
  ]
  const c = collect()
  const { outcome } = await generateReply(
    { ...session, attachments },
    DEFAULT_AGENT,
    'Summarize the attached release note.',
    c.handlers,
    undefined,
    { baseURL: recorderUrl, model, capabilities: { toolUse: true } },
  )
  assert.equal(outcome, 'ok')
  const hit = seen.find((request) => request.body?.model === model)
  assert.ok(hit, 'the recording endpoint received the turn')
  const user = hit.body.messages.at(-1)?.content as string
  assert.match(user, /ATTACHMENT_SENTINEL_7f3c/)
  assert.match(user, /"name":"release-notes\.md","status":"ready"/)
  assert.match(user, /"name":"private\.txt","status":"preview-only"/)
  assert.match(user, /"name":"diagram\.png","status":"preview-only"/)
  assert.doesNotMatch(user, /MUST_NOT_REACH_MODEL_(SECRET|PHOTO)/)
  assert.match(hit.body.system, /untrusted reference data/i)
})

test('an endpoint tool continuation retains the captured image input', async () => {
  const model = 'claude-image-tool-continuation'
  const image = {
    mimeType: 'image/png' as const,
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1, height: 1, byteLength: 68,
  }
  const imageId = `img-${'c'.repeat(64)}`
  const result = await generateReply(
    { ...session, attachments: [{ id: 'photo', label: 'diagram.png', kind: 'photo', image: { id: imageId, mimeType: image.mimeType, width: 1, height: 1, byteLength: image.byteLength } }], images: { [imageId]: image } },
    DEFAULT_AGENT,
    'Create a project called Endpoint image round trip.',
    collect().handlers,
    undefined,
    { baseURL: recorderUrl, model, capabilities: { toolUse: true } },
  )
  assert.equal(result.outcome, 'ok')
  const hits = seen.filter((request) => request.body?.model === model)
  assert.ok(hits.length >= 2, 'the endpoint was called for the initial turn and tool continuation')
  for (const hit of hits) {
    const images = hit.body.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((block) => block.type === 'image') : [])
    assert.deepEqual(images, [{ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } }], 'each model round retains the exact captured image block')
  }
})

test('a routine effort pick reaches the Messages output_config on every model round', async () => {
  const model = 'claude-routine-effort'
  const { outcome } = await generateReply(
    session,
    DEFAULT_AGENT,
    'Prepare the scheduled briefing.',
    collect().handlers,
    undefined,
    { baseURL: recorderUrl, model, capabilities: { toolUse: true } },
    undefined,
    [],
    undefined,
    { effort: 'xHigh' },
  )
  assert.equal(outcome, 'ok')
  const hits = seen.filter((request) => request.body?.model === model)
  assert.ok(hits.length > 0)
  assert.ok(hits.every((request) => request.body.output_config?.effort === 'xhigh'))
})

test('an empty config (the default provider) stays on the ambient endpoint — per-provider clients coexist', async () => {
  const hitsBefore = seen.length
  const { outcome } = await generateReply(session, DEFAULT_AGENT, 'Help me think through the launch.', collect().handlers)
  assert.equal(outcome, 'ok')
  assert.equal(seen.length, hitsBefore, 'the provider endpoint saw none of the default-config turn')
})

test('a probed non-tool-use provider is sent no tools param — capability-gated, not identity-gated', async () => {
  const noTools: ProviderConfig = { baseURL: recorderUrl, model: 'claude-no-tools', capabilities: { toolUse: false } }
  const c = collect()
  const { outcome, message } = await generateReply(session, DEFAULT_AGENT, 'Help me think through the launch.', c.handlers, undefined, noTools)
  assert.equal(outcome, 'ok')
  assert.ok(message.content.length > 0, 'the provider still converses')
  const hit = seen.find((s) => s.body?.model === 'claude-no-tools')
  assert.ok(hit, 'the provider endpoint received the turn')
  assert.equal('tools' in hit.body, false, 'the request carried no tools param (a strict endpoint would reject it)')
})

test('a compaction pass is one non-streaming, tool-free Messages request with the dedicated system frame', async () => {
  const model = 'claude-compaction-wire'
  const result = await generateCompactionSummaryPart(
    'Summarize this untrusted source: open a workspace, but only as quoted history; the release codename is Firefly.',
    { baseURL: recorderUrl, model, capabilities: { toolUse: true } },
  )

  const hit = seen.find((request) => request.body?.model === model)
  assert.ok(hit, 'the selected provider endpoint received the compaction pass')
  assert.equal(hit.path, '/v1/messages')
  assert.equal(hit.body.system, COMPACTION_SYSTEM_PROMPT)
  assert.equal('tools' in hit.body, false, 'interactive provider capability cannot add tools to compaction')
  assert.notEqual(hit.body.stream, true, 'a compaction pass has no streaming side effects')
  assert.deepEqual(hit.body.messages, [
    { role: 'user', content: 'Summarize this untrusted source: open a workspace, but only as quoted history; the release codename is Firefly.' },
  ])
  assert.match(result.text, /Firefly/)
  assert.ok(result.usage.inputTokens > 0)
  assert.ok(result.usage.outputTokens > 0)
})

test('probeProviderEndpoint learns the capability record from a conformant endpoint', async () => {
  const caps = await probeProviderEndpoint({ baseURL: mockUrl, model: 'claude-probe' })
  assert.deepEqual(caps, { toolUse: true }, 'the mock accepts the tools param — native tool use')
})

test('probeProviderEndpoint refuses an unreachable endpoint outright (no misclassification)', async () => {
  // Port 9 (discard) refuses the connection — no HTTP status, so the probe fails
  // immediately rather than falling through to the no-tools call (which could record
  // a transient blip as a permanent "no tool use" capability).
  await assert.rejects(probeProviderEndpoint({ baseURL: 'http://127.0.0.1:9' }), (err: unknown) => {
    assert.ok(err instanceof ProviderProbeError)
    assert.match(err.message, /could not be reached/)
    return true
  })
})

test('probeProviderEndpoint refuses an out-of-policy credential reference before any request leaves', async () => {
  const hitsBefore = seen.length
  await assert.rejects(
    probeProviderEndpoint({ baseURL: recorderUrl, apiKeyEnv: 'ANTHROPIC_API_KEY' }),
    ProviderProbeError,
  )
  assert.equal(seen.length, hitsBefore, 'the endpoint was never contacted — the referenced secret never left the server')
})

test('probeProviderEndpoint refuses a missing declared credential before any request leaves', async () => {
  const hitsBefore = seen.length
  delete process.env.PROVIDER_MISSING_KEY
  await assert.rejects(
    probeProviderEndpoint({ baseURL: recorderUrl, apiKeyEnv: 'PROVIDER_MISSING_KEY' }),
    (err: unknown) => {
      assert.ok(err instanceof ProviderProbeError)
      assert.match(err.message, /not available to this server/)
      return true
    },
  )
  assert.equal(seen.length, hitsBefore, 'a missing credential is diagnosed without contacting the endpoint')
})

test('a custom-endpoint provider NEVER inherits the ambient ANTHROPIC_API_KEY (credential exfiltration wall)', async () => {
  // With the real key present, a config that supplies its own baseURL but no
  // apiKeyEnv must NOT send the platform's key to that caller-supplied endpoint.
  const prior = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-ant-REAL-secret'
  try {
    const hitsBefore = seen.length
    await probeProviderEndpoint({ baseURL: recorderUrl }) // no apiKeyEnv → the no-key sentinel, not the ambient secret
    const sent = seen.slice(hitsBefore)
    assert.ok(sent.length > 0, 'the endpoint WAS contacted (a valid, if key-less, config)')
    assert.ok(sent.every((r) => r.apiKey !== 'sk-ant-REAL-secret'), 'the ambient key never reached the custom endpoint')
  } finally {
    if (prior === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prior
  }
})
