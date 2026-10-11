import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MCP_OAUTH_MESSAGES_SMOKE_MODEL,
  MCP_OAUTH_MESSAGES_SMOKE_OUTCOME,
  MCP_OAUTH_MESSAGES_SMOKE_PROMPT,
  startMcpOAuthMessagesSmokeFixture,
} from './mcpOAuthMessagesSmokeFixture.mjs'

const toolName = `mcp_external_${'a'.repeat(48)}`
const tool = { name: toolName, description: 'records.search — via Native OAuth fixture. External server.',
  input_schema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 256 } },
    required: ['query'], additionalProperties: false } }
const initial = (stream = false) => ({ model: MCP_OAUTH_MESSAGES_SMOKE_MODEL, stream, max_tokens: 64,
  messages: [{ role: 'user', content: [{ type: 'text', text: MCP_OAUTH_MESSAGES_SMOKE_PROMPT }] }], tools: [tool] })

test('local Messages fixture proposes the advertised opaque tool and returns final text after tool result', async t => {
  const fixture = await startMcpOAuthMessagesSmokeFixture()
  t.after(() => fixture.close())
  assert.equal(fixture.baseUrl, fixture.origin)
  assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/)

  const firstRequest = initial()
  firstRequest.tools.push(...Array.from({ length: 213 }, (_, index) => ({ name: `api__fixture_${index}`,
    description: 'Generated route tool.', input_schema: { type: 'object', properties: {} } })))
  const proposed = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(firstRequest) })
  assert.equal(proposed.status, 200)
  const message = await proposed.json()
  assert.equal(message.stop_reason, 'tool_use')
  assert.deepEqual(message.content, [{ type: 'tool_use', id: 'native-oauth-smoke-call-1', name: toolName,
    input: { query: MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.arguments.query } }])
  assert.equal(fixture.requests[0].tools.length, 214, 'the observed full product tool set remains within the fixture bound')

  const continuation = initial(true)
  continuation.messages = [
    continuation.messages[0],
    { role: 'assistant', content: message.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.content[0].id,
      content: 'Proposed to the user — awaiting their confirmation; not executed yet.' }] },
  ]
  const finalResponse = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(continuation) })
  assert.equal(finalResponse.status, 200)
  const frames = await finalResponse.text()
  assert.match(frames, /event: message_start/)
  assert.match(frames, /"stop_reason":"end_turn"/)
  assert.match(frames, new RegExp(MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.finalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.finalText, /awaiting your approval; it has not run yet/)
  assert.doesNotMatch(MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.finalText, /returned|approved record/i)
  assert.equal(fixture.requests.length, 2)
  assert.equal(fixture.snapshot()[0].tools[0].name, toolName)
  const detached = fixture.snapshot()
  detached[0].messages[0].content = 'mutated'
  assert.deepEqual(fixture.snapshot()[0].messages[0].content, [{ type: 'text', text: MCP_OAUTH_MESSAGES_SMOKE_PROMPT }])
})

test('fixture rejects malformed, unrelated, oversized, and over-budget Messages requests without capture', async t => {
  const fixture = await startMcpOAuthMessagesSmokeFixture()
  t.after(() => fixture.close())
  const post = body => fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body) })

  assert.equal((await fetch(`${fixture.origin}/v1/models`)).status, 200)
  assert.equal((await post('{')).status, 400)
  assert.equal((await post({ ...initial(), messages: [] })).status, 400)
  assert.equal((await post({ ...initial(), tools: [{ ...tool, name: 'search' }] })).status, 400)
  assert.equal((await post({ ...initial(), messages: [{ role: 'user', content: 'unrelated' }] })).status, 400)
  const tooManyTools = initial()
  tooManyTools.tools.push(...Array.from({ length: 256 }, (_, index) => ({ name: `api__fixture_${index}`,
    description: 'Generated route tool.', input_schema: { type: 'object', properties: {} } })))
  assert.equal((await post(tooManyTools)).status, 400, '257 declared tools exceed the explicit catalog bound')
  assert.equal((await post(' '.repeat(256 * 1024 + 1))).status, 413)
  assert.equal(fixture.requests.length, 0)

  assert.equal((await post(initial())).status, 200)
  const followup = initial()
  followup.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'native-oauth-smoke-call-1', name: tool.name,
    input: { query: MCP_OAUTH_MESSAGES_SMOKE_OUTCOME.arguments.query } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'native-oauth-smoke-call-1',
    content: 'Proposed to the user — awaiting their confirmation; not executed yet.' }] })
  assert.equal((await post(followup)).status, 200)
  assert.equal((await post(followup)).status, 400, 'a third accepted request is outside the bounded turn')
  assert.equal(fixture.requests.length, 2)
})

test('provider onboarding uses a bounded model catalog and the actual Messages conformance probe', async t => {
  const fixture = await startMcpOAuthMessagesSmokeFixture()
  t.after(() => fixture.close())
  const catalogResponse = await fetch(`${fixture.baseUrl}/v1/models?limit=100`)
  assert.equal(catalogResponse.status, 200)
  const catalog = await catalogResponse.json()
  assert.deepEqual(catalog.data.map(row => row.id), [MCP_OAUTH_MESSAGES_SMOKE_MODEL])
  assert.equal(catalog.has_more, false)
  assert.equal(fixture.catalogRequests.length, 1)

  const probeBody = { model: MCP_OAUTH_MESSAGES_SMOKE_MODEL, max_tokens: 8,
    messages: [{ role: 'user', content: 'Conformance check. Reply with one word.' }],
    tools: [{ name: 'probe_noop', description: 'Conformance probe — never called.',
      input_schema: { type: 'object', properties: {} } }] }
  const badProbe = await fetch(`${fixture.baseUrl}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...probeBody, messages: [{ role: 'user', content: 'different prompt' }] }) })
  assert.equal(badProbe.status, 400, 'a probe-shaped request must satisfy the real product probe contract')
  const probeResponse = await fetch(`${fixture.baseUrl}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(probeBody) })
  assert.equal(probeResponse.status, 200)
  const message = await probeResponse.json()
  assert.equal(message.stop_reason, 'end_turn')
  assert.deepEqual(message.content, [{ type: 'text', text: 'OK' }])
  assert.equal(fixture.probes.length, 1)
  assert.equal(fixture.requests.length, 0, 'onboarding probes stay outside interactive request evidence')
})

test('Messages continuation retains the prompt and ordered assistant call/user acknowledgement from this turn', async t => {
  const fixture = await startMcpOAuthMessagesSmokeFixture()
  t.after(() => fixture.close())
  const post = body => fetch(`${fixture.origin}/v1/messages`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const proposed = await (await post(initial())).json()
  const continuation = initial()
  continuation.messages.push({ role: 'assistant', content: proposed.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: proposed.content[0].id,
      content: 'Proposed to the user — awaiting their confirmation; not executed yet.' }] })
  const wrongRoles = structuredClone(continuation)
  wrongRoles.messages[1].role = 'user'
  wrongRoles.messages[2].role = 'assistant'
  const reversed = structuredClone(continuation)
  ;[reversed.messages[1], reversed.messages[2]] = [reversed.messages[2], reversed.messages[1]]
  const noPrompt = structuredClone(continuation)
  noPrompt.messages.shift()
  const foreignCall = structuredClone(continuation)
  foreignCall.messages[1].content[0].id = 'unissued-call'
  foreignCall.messages[2].content[0].tool_use_id = 'unissued-call'
  for (const [label, body] of [['wrong roles', wrongRoles], ['reversed order', reversed],
    ['missing original prompt', noPrompt], ['unissued call identity', foreignCall], ['repeated proposal', initial()]]) {
    assert.equal((await post(body)).status, 400, label)
    assert.equal(fixture.requests.length, 1, 'invalid continuations do not consume accepted-turn evidence')
  }
  assert.equal((await post(continuation)).status, 200)
  assert.equal(fixture.requests.length, 2)
})
