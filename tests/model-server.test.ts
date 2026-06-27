/** Integration tests for the mock model server (server/model) — it must speak the
 *  Anthropic Messages *tool-use* wire format: turn 1 answers a matched message with
 *  `tool_use` blocks + `stop_reason: "tool_use"`; turn 2 (after the tool_result)
 *  returns the final prose. Boots a real instance on an ephemeral port. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../server/model/index.ts'

let server: Server
let base = ''

before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => server.on('listening', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})
after(() => server.close())

const TOUR_MSG = 'This is becoming a real effort. Can you give it a home of its own?'

async function post(body: unknown): Promise<{ status: number; json?: any; text: string }> {
  const res = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

test('turn 1, non-streaming: a matched message returns a tool_use block + stop_reason tool_use', async () => {
  const { status, json } = await post({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: TOUR_MSG }], stream: false })
  assert.equal(status, 200)
  assert.equal(json.stop_reason, 'tool_use')
  assert.equal(json.content[0].type, 'tool_use')
  assert.equal(json.content[0].name, 'create_project')
  assert.equal(json.content[0].input.name, 'Insights dashboard launch')
})

test('turn 1, streaming: emits content_block_start tool_use + input_json_delta + stop_reason tool_use', async () => {
  const { text } = await post({ messages: [{ role: 'user', content: TOUR_MSG }], stream: true })
  assert.match(text, /"type":"content_block_start"/)
  assert.match(text, /"type":"tool_use"/)
  assert.match(text, /"type":"input_json_delta"/)
  assert.match(text, /"stop_reason":"tool_use"/)
})

test('turn 2: a tool_result message returns the final prose (end_turn)', async () => {
  const { json } = await post({
    stream: false,
    messages: [
      { role: 'user', content: TOUR_MSG },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'create_project', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Proposed creating the project.' }] },
    ],
  })
  assert.equal(json.stop_reason, 'end_turn')
  assert.equal(json.content[0].type, 'text')
  assert.match(json.content[0].text, /Insights dashboard launch/)
})

test('an unmatched message returns plain text (no tools)', async () => {
  const { json } = await post({ stream: false, messages: [{ role: 'user', content: 'what is a vector database?' }] })
  assert.equal(json.stop_reason, 'end_turn')
  assert.equal(json.content[0].type, 'text')
  assert.ok(json.content[0].text.length > 0)
})

test('GET /health is ok', async () => {
  const res = await fetch(`${base}/health`)
  const json = await res.json()
  assert.equal(json.ok, true)
})
