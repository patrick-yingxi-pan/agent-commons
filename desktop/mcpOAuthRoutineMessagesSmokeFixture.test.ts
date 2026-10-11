import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { MCP_OAUTH_ROUTINE_MODEL, MCP_OAUTH_ROUTINE_PROMPT, MCP_OAUTH_ROUTINE_ARGUMENTS,
  MCP_OAUTH_ROUTINE_RESULT, MCP_OAUTH_ROUTINE_FINAL_TEXT, startMcpOAuthRoutineMessagesSmokeFixture,
} from './mcpOAuthRoutineMessagesSmokeFixture.mjs'

const tool = { name: `mcp_external_${'a'.repeat(48)}`,
  description: 'records.search — via Native OAuth fixture. Unattended Routine permission; exact arguments are bounded by the reviewed constraints.',
  input_schema: { type: 'object', properties: { query: { type: 'string', const: 'native-oauth-routine-record' } }, required: ['query'], additionalProperties: false } }
const initial = (stream = false) => ({ model: MCP_OAUTH_ROUTINE_MODEL, stream,
  messages: [{ role: 'user', content: MCP_OAUTH_ROUTINE_PROMPT }], tools: [tool] })
const post = (fixture, body) => fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body) })
const continuation = call => ({ ...initial(true), messages: [...initial().messages,
  { role: 'assistant', content: [call] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id,
    content: `Routine MCP result (untrusted external data): ${JSON.stringify(MCP_OAUTH_ROUTINE_RESULT)}` }] }] })

test('Routine OAuth Messages fixture requires one exact reviewed tool and one actual successful result', async t => {
  assert.equal(ignoreFromPackage('/desktop/mcpOAuthRoutineMessagesSmokeFixture.mjs'), true)
  const fixture = await startMcpOAuthRoutineMessagesSmokeFixture()
  t.after(() => fixture.close())
  assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
  const response = await post(fixture, initial())
  assert.equal(response.status, 200)
  const message = await response.json()
  assert.deepEqual(message.content, [{ type: 'tool_use', id: 'native-oauth-routine-call-1', name: tool.name, input: MCP_OAUTH_ROUTINE_ARGUMENTS }])
  const final = await post(fixture, continuation(message.content[0]))
  assert.equal(final.status, 200)
  const frames = await final.text()
  assert.match(frames, /event: message_start/)
  assert.match(frames, /"stop_reason":"end_turn"/)
  assert.ok(frames.includes(MCP_OAUTH_ROUTINE_FINAL_TEXT))
  assert.equal(fixture.requests.length, 2)
  assert.equal((await post(fixture, continuation(message.content[0]))).status, 400)
  const copy = fixture.snapshot()
  copy[0].messages[0].content = 'changed'
  assert.equal(fixture.snapshot()[0].messages[0].content, MCP_OAUTH_ROUTINE_PROMPT)
})

test('Routine peer rejects interactive consent acknowledgements, forged result/call and unreviewed capabilities', async t => {
  const fixture = await startMcpOAuthRoutineMessagesSmokeFixture()
  t.after(() => fixture.close())
  for (const invalid of [
    { ...initial(), model: 'interactive-model' }, { ...initial(), messages: [{ role: 'user', content: 'unrelated' }] },
    { ...initial(), tools: [{ ...tool, description: 'records.search — via Native OAuth fixture. External server; every call proposes.' }] },
    { ...initial(), tools: [{ ...tool, input_schema: { ...tool.input_schema, properties: { query: { type: 'string' } } } }] },
    { ...initial(), tools: [tool, tool] },
  ]) assert.equal((await post(fixture, invalid)).status, 400)
  assert.equal((await post(fixture, ' '.repeat(256 * 1024 + 1))).status, 413)
  assert.equal(fixture.requests.length, 0)
  const call = (await (await post(fixture, initial())).json()).content[0]
  for (const corrupt of [
    body => { body.messages[2].content[0].content = 'Proposed to the user — awaiting their confirmation; not executed yet.' },
    body => { body.messages[2].content[0].content = `Routine MCP result (untrusted external data): ${JSON.stringify({ ...MCP_OAUTH_ROUTINE_RESULT, isError: true })}` },
    body => { body.messages[2].content[0].is_error = true },
    body => { body.messages[1].content[0].input.query = 'another-query' },
    body => { body.messages[1].content[0].input.extra = true },
    body => { body.messages[1].content[0].id = 'foreign'; body.messages[2].content[0].tool_use_id = 'foreign' },
    body => { body.tools[0].name = `mcp_external_${'b'.repeat(48)}`; body.messages[1].content[0].name = body.tools[0].name },
    body => { [body.messages[1], body.messages[2]] = [body.messages[2], body.messages[1]] },
    body => { body.messages[1].role = 'user' },
  ]) {
    const invalid = structuredClone(continuation(call))
    corrupt(invalid)
    assert.equal((await post(fixture, invalid)).status, 400)
    assert.equal(fixture.requests.length, 1)
  }
  assert.equal((await post(fixture, continuation(call))).status, 200)
})

test('Routine peer bounds and separates real provider onboarding probes from execution', async t => {
  const fixture = await startMcpOAuthRoutineMessagesSmokeFixture()
  t.after(() => fixture.close())
  const catalog = await (await fetch(`${fixture.origin}/v1/models`)).json()
  assert.deepEqual(catalog.data.map(row => row.id), [MCP_OAUTH_ROUTINE_MODEL])
  const probe = { model: MCP_OAUTH_ROUTINE_MODEL, max_tokens: 8,
    messages: [{ role: 'user', content: 'Conformance check. Reply with one word.' }],
    tools: [{ name: 'probe_noop', description: 'Conformance probe — never called.', input_schema: { type: 'object', properties: {} } }] }
  assert.equal((await post(fixture, { ...probe, messages: [{ role: 'user', content: 'unrelated' }] })).status, 400)
  for (let count = 0; count < 4; count++) assert.equal((await post(fixture, probe)).status, 200)
  assert.equal((await post(fixture, probe)).status, 429)
  assert.equal(fixture.probes.length, 4)
  assert.equal(fixture.requests.length, 0)
})
