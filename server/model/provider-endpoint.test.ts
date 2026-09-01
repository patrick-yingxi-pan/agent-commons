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
    seen.push({ path: (req.url ?? '').split('?')[0], apiKey: Array.isArray(apiKey) ? apiKey[0] : apiKey, body: raw ? JSON.parse(raw) : undefined })
    const upstream = await fetch(`${mockUrl}${req.url}`, {
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
  // The ambient default endpoint is the mock itself (NOT the recorder), so a
  // default-config turn landing zero recorder hits proves per-provider client isolation.
  process.env.ANTHROPIC_BASE_URL = mockUrl
})

after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.PROVIDER_B_KEY
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
