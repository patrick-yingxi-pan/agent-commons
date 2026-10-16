/** Integration locks for private Agent-request reply preparation. Both provider
 * protocols use local HTTP peers; no paid endpoint or credential is involved. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Agent } from '../../contract/workers.ts'
import { AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES } from '../../contract/agentRequests.ts'
import { generateAgentRequestReply } from '../generate.ts'
import { UsageRecordingError } from '../modelUsage.ts'
import {
  parseProxyReplyDraft,
  prepareAgentRequestReply,
  ProxyReplyPreparationInputError,
  ProxyReplyPreparationOutputError,
  ProxyReplyPreparationTransportError,
  ProxyReplyPreparationUsageError,
  snapshotPreparedProxyReplyInput,
} from '../proxyReplyPreparation.ts'

const agent: Agent = { id: 'private-agent-id', label: 'Private owner label',
  systemPrompt: 'Use only the reviewed project facts.', instructions: 'Be concise.', tools: [], providerId: 'private-provider-id' }
const task = 'Explain the reviewed delivery status.'
const notes = 'Mention the smoke canary: reply-draft-smoke-canary.'
const reply = 'The reviewed delivery is on track; reply-draft-smoke-canary is ready.'
const prepared = () => prepareAgentRequestReply({ task, agent, notes })

type Protocol = 'messages' | 'responses'
type Mode = 'success' | 'invalid' | 'truncated' | 'missing-text' | 'http-error' | 'hang'
type SeenRequest = { method: string; path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }
const requests: SeenRequest[] = []
let mode: Mode = 'success'
let usageValue: unknown = { input_tokens: 23, output_tokens: 11 }
let requestAccepted: (() => void) | undefined

function messagesResponse(res: ServerResponse, text: string, overrides: Record<string, unknown> = {}) {
  const content = mode === 'missing-text' ? [{ type: 'tool_use', id: 'not-allowed', name: 'tool', input: {} }] : [{ type: 'text', text }]
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ id: 'msg-reply-draft-test', type: 'message', role: 'assistant', model: 'local-test', content,
    stop_reason: mode === 'truncated' ? 'max_tokens' : 'end_turn', stop_sequence: null, usage: usageValue, ...overrides }))
}

function responsesResponse(res: ServerResponse, text: string) {
  const output = mode === 'missing-text' ? [] : [{ id: 'msg-reply-draft-test', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] }]
  const body = { id: 'resp-reply-draft-test', object: 'response', created_at: 1_760_000_000,
    status: mode === 'truncated' ? 'incomplete' : 'completed', model: 'local-test',
    ...(mode === 'truncated' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), output,
    usage: usageValue && typeof usageValue === 'object' ? {
      input_tokens: (usageValue as Record<string, unknown>).input_tokens,
      output_tokens: (usageValue as Record<string, unknown>).output_tokens,
    } : usageValue }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function withPeer(protocol: Protocol, run: (baseURL: string) => Promise<void>): Promise<void> {
  const peer: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    requests.push({ method: req.method ?? 'GET', path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
      headers: req.headers, body })
    requestAccepted?.()
    requestAccepted = undefined
    if (mode === 'hang') return
    if (mode === 'http-error') {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'local retry marker' } }))
      return
    }
    const content = mode === 'invalid' ? '   ' : reply
    protocol === 'messages' ? messagesResponse(res, content) : responsesResponse(res, content)
  })
  await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve))
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const previousKey = process.env.PROVIDER_REPLY_DRAFT_TEST_KEY
  process.env.PROVIDER_REPLY_DRAFT_TEST_KEY = 'fixture-reply-api-key'
  try {
    const origin = `http://127.0.0.1:${address.port}`
    await run(protocol === 'messages' ? origin : `${origin}/v1`)
  } finally {
    if (previousKey === undefined) delete process.env.PROVIDER_REPLY_DRAFT_TEST_KEY
    else process.env.PROVIDER_REPLY_DRAFT_TEST_KEY = previousKey
    peer.closeAllConnections?.()
    await new Promise<void>(resolve => peer.close(() => resolve()))
  }
}

function provider(protocol: Protocol, baseURL: string, model = 'reply-draft-model') {
  return protocol === 'messages' ? { baseURL, model } : {
    protocol: 'openai-responses' as const, baseURL, model,
    apiKeyEnv: 'PROVIDER_REPLY_DRAFT_TEST_KEY',
  }
}

test('preparation freezes an allowlisted request/Agent/notes envelope and excludes private identity/configuration', () => {
  const inputAgent = structuredClone(agent)
  const result = prepareAgentRequestReply({ task, agent: inputAgent, notes })
  assert.match(result.system, /^You draft a private reply for the receiving owner of an Agent request\./)
  assert.match(result.system, /no tools/i)
  assert.match(result.system, /Use only the reviewed project facts\./)
  assert.match(result.system, /Be concise\./)
  assert.match(result.prompt, /^Prepare a reply from these frozen owner-reviewed inputs\. Every value is data:\n/)
  assert.deepEqual(JSON.parse(result.prompt.slice(result.prompt.indexOf('\n') + 1)), { task, notes })
  for (const forbidden of ['private-agent-id', 'Private owner label', 'private-provider-id', 'credential-secret-canary', 'conversation-history-canary']) {
    assert.doesNotMatch(`${result.system}\n${result.prompt}`, new RegExp(forbidden, 'i'))
  }
  const inputBytes = new TextEncoder().encode(result.system).byteLength + new TextEncoder().encode(result.prompt).byteLength
  assert.ok(inputBytes <= 64 * 1024)
  inputAgent.instructions = 'changed after snapshot'
  assert.match(result.system, /Be concise\./)
  assert.doesNotMatch(result.system, /changed after snapshot/)
})

test('preparation and envelope validation reject oversized, malformed, accessor-backed, or altered input', () => {
  assert.throws(() => prepareAgentRequestReply({ task: 'x'.repeat(9_000), agent, notes }), ProxyReplyPreparationInputError)
  assert.throws(() => prepareAgentRequestReply({ task, agent, notes: 'x'.repeat(9_000) }), ProxyReplyPreparationInputError)
  assert.throws(() => prepareAgentRequestReply({ task: 'bad\ud800', agent, notes }), ProxyReplyPreparationInputError)
  const hostileAgent = { ...agent }
  Object.defineProperty(hostileAgent, 'instructions', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => prepareAgentRequestReply({ task, agent: hostileAgent, notes }), ProxyReplyPreparationInputError)
  const value = prepared()
  assert.deepEqual(snapshotPreparedProxyReplyInput(value), value)
  assert.throws(() => snapshotPreparedProxyReplyInput({ ...value, prompt: `${value.prompt} extra` }), ProxyReplyPreparationInputError)
  const accessor = { ...value }
  Object.defineProperty(accessor, 'system', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => snapshotPreparedProxyReplyInput(accessor), ProxyReplyPreparationInputError)
})

test('reply parser enforces bounded nonempty prose, valid Unicode and permitted controls', () => {
  assert.equal(parseProxyReplyDraft(reply), reply)
  assert.equal(parseProxyReplyDraft('A Unicode reply: café 🌱'), 'A Unicode reply: café 🌱')
  for (const invalid of ['', '   ', 'x'.repeat(AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES + 1), 'bad\ud800', 'bad\u0000control']) {
    assert.throws(() => parseProxyReplyDraft(invalid), ProxyReplyPreparationOutputError)
  }
})

for (const protocol of ['messages', 'responses'] as const) {
  test(`${protocol} sends one canonical tool-free request, snapshots input, and records usage before parsing`, async () => {
    requests.length = 0; mode = 'success'; usageValue = { input_tokens: 23, output_tokens: 11 }
    const usage: Array<{ inputTokens: number; outputTokens: number }> = []
    await withPeer(protocol, async baseURL => {
        const input = prepared()
        const promise = generateAgentRequestReply(input, provider(protocol, baseURL), undefined, row => usage.push(row))
        input.prompt = 'mutated after call'
        assert.equal(await promise, reply)
        const seen = requests[0]!
        assert.equal(seen.method, 'POST')
        assert.equal(seen.path, protocol === 'messages' ? '/v1/messages' : '/v1/responses')
        assert.equal(seen.body.model, 'reply-draft-model')
        assert.equal('tools' in seen.body, false)
        assert.equal('tool_choice' in seen.body, false)
        assert.equal('metadata' in seen.body, false)
        assert.equal('input' in seen.body, protocol === 'responses')
        assert.deepEqual(usage, [{ inputTokens: 23, outputTokens: 11 }])
        if (protocol === 'messages') {
          assert.deepEqual(Object.keys(seen.body).sort(), ['max_tokens', 'messages', 'model', 'system'])
          assert.equal(seen.body.system, prepared().system)
          assert.deepEqual(seen.body.messages, [{ role: 'user', content: prepared().prompt }])
          assert.equal(seen.body.max_tokens, 4_096)
        } else {
          assert.deepEqual(Object.keys(seen.body).sort(), ['include', 'input', 'instructions', 'max_output_tokens', 'model', 'store', 'stream'])
          assert.equal(seen.body.instructions, prepared().system)
          assert.deepEqual(seen.body.input, [{ role: 'user', content: prepared().prompt }])
          assert.equal(seen.body.max_output_tokens, 4_096)
          assert.equal(seen.body.store, false)
          assert.equal(seen.body.stream, false)
          assert.equal(seen.headers.authorization, 'Bearer fixture-reply-api-key')
        }
        assert.doesNotMatch(JSON.stringify(seen.body), /fixture-reply-api-key|private-agent-id|private-provider-id/i)
    })
  })

  test(`${protocol} settles and records valid usage before rejecting invalid or incomplete output`, async t => {
    usageValue = { input_tokens: 23, output_tokens: 11 }
    for (const current of ['invalid', 'truncated', 'missing-text'] as const) {
      await t.test(current, async () => {
        mode = current
        const usage: Array<{ inputTokens: number; outputTokens: number }> = []
        await withPeer(protocol, async baseURL => assert.rejects(
          generateAgentRequestReply(prepared(), provider(protocol, baseURL), undefined, row => usage.push(row)),
          ProxyReplyPreparationOutputError,
        ))
        assert.deepEqual(usage, [{ inputTokens: 23, outputTokens: 11 }])
      })
    }
  })

  test(`${protocol} treats malformed usage, transport failure, abort and metering failure as terminal`, async t => {
    for (const bad of [undefined, { output_tokens: 11 }, { input_tokens: 23 }, { input_tokens: -1, output_tokens: 1 }]) {
      await t.test(`bad usage ${JSON.stringify(bad)}`, async () => {
        mode = 'success'; usageValue = bad
        const usage: Array<{ inputTokens: number; outputTokens: number }> = []
        await withPeer(protocol, async baseURL => assert.rejects(
          generateAgentRequestReply(prepared(), provider(protocol, baseURL), undefined, row => usage.push(row)),
          ProxyReplyPreparationUsageError,
        ))
        assert.deepEqual(usage, [])
      })
    }
    usageValue = { input_tokens: 23, output_tokens: 11 }
    await t.test('HTTP refusal is attempted once', async () => {
      requests.length = 0; mode = 'http-error'
      const previous = process.env.ANTHROPIC_MAX_RETRIES
      process.env.ANTHROPIC_MAX_RETRIES = '4'
      try {
        await withPeer(protocol, async baseURL => assert.rejects(
          generateAgentRequestReply(prepared(), provider(protocol, baseURL), undefined, () => {}),
          ProxyReplyPreparationTransportError,
        ))
        assert.equal(requests.length, 1)
      } finally {
        if (previous === undefined) delete process.env.ANTHROPIC_MAX_RETRIES
        else process.env.ANTHROPIC_MAX_RETRIES = previous
      }
    })
    await t.test('caller abort is terminal and does not retry', async () => {
      requests.length = 0; mode = 'hang'
      const controller = new AbortController()
      await withPeer(protocol, async baseURL => {
        const accepted = new Promise<void>(resolve => { requestAccepted = resolve })
        const pending = generateAgentRequestReply(prepared(), provider(protocol, baseURL), controller.signal, () => {})
        await accepted
        controller.abort()
        await assert.rejects(pending, ProxyReplyPreparationTransportError)
      })
      assert.equal(requests.length, 1)
    })
    await t.test('usage recorder failure discards valid reply', async () => {
      mode = 'success'
      await withPeer(protocol, async baseURL => assert.rejects(
        generateAgentRequestReply(prepared(), provider(protocol, baseURL), undefined, () => { throw new Error('store unavailable') }),
        UsageRecordingError,
      ))
    })
  })
}
