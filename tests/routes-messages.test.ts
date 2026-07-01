/** Integration tests for the message route (POST /sessions/:id/messages) — it must
 *  stream the reply, emit the tool-driven proposals (`message.relations` /
 *  `message.escalation`), and honor `ephemeral` (the tour) by NOT persisting the
 *  turn. Boots the mock model on an ephemeral port and points the backend at it. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../server/model/index.ts'
import { store } from '../server/store.ts'
import { call, callRaw } from './helpers/http.ts'

let server: Server
before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => server.on('listening', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})
after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  server.close()
})

const PROJECT_MSG = 'This is becoming a real effort. Can you give it a home of its own?'
const SAVE_MSG = 'Save the recap of this as launch-recap.md and file it under the project.'

test('a project turn streams start → escalation → end over SSE', async () => {
  const { status, body } = await callRaw('POST', '/sessions/insights-launch/messages', { text: PROJECT_MSG, ephemeral: true })
  assert.equal(status, 200)
  assert.match(body, /"type":"message\.start"/)
  assert.match(body, /"type":"message\.escalation"/)
  assert.match(body, /"kind":"project"/)
  assert.match(body, /"type":"message\.end"/)
})

test('a relation-op turn emits message.relations with the proposed op', async () => {
  const { body } = await callRaw('POST', '/sessions/insights-launch/messages', { text: SAVE_MSG, ephemeral: true })
  assert.match(body, /"type":"message\.relations"/)
  assert.match(body, /"kind":"save-artifact"/)
})

test('ephemeral turns do not persist (the tour can replay) — message count is unchanged', async () => {
  const before = (await call('GET', '/sessions/insights-launch')).json.messages?.length ?? 0
  await callRaw('POST', '/sessions/insights-launch/messages', { text: PROJECT_MSG, ephemeral: true })
  const after = (await call('GET', '/sessions/insights-launch')).json.messages?.length ?? 0
  assert.equal(after, before)
})

test('an attached connector’s tools reach the model — a naming message drives a message.toolActivity round-trip (P6)', async () => {
  const s = store.createSession('connector round-trip')
  // Attach a Slack connector context — the backend derives its tools and declares them.
  store.attachContext(s.id, { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' })
  const { status, body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'list my slack channels', ephemeral: true })
  assert.equal(status, 200)
  // The model called the derived connector tool; the backend executed it and streamed
  // the activity + fed the (fixture) result back for the final prose.
  assert.match(body, /"type":"message\.toolActivity"/, 'the tool-activity event is emitted')
  assert.match(body, /connector__slack__list/, 'the derived connector tool was the one called')
  assert.match(body, /#launch/, 'the fixture result rode back in the activity')
  assert.match(body, /"type":"message\.end"/)
})

test('with no connector attached, a naming message drives no tool activity (authority is structural)', async () => {
  const s = store.createSession('no connector attached')
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'list my slack channels', ephemeral: true })
  assert.doesNotMatch(body, /"type":"message\.toolActivity"/, 'no attached connector ⇒ no derived tool ⇒ nothing to call')
})

test('a persisted assistant turn is stamped with its driving Agent (D16 per-turn provenance)', async () => {
  const s = store.createSession('start')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello' }) // not ephemeral → persisted
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const assistant = thread.find((m: { role: string; agentId?: string }) => m.role === 'assistant')
  assert.ok(assistant, 'the assistant turn was persisted')
  assert.equal(assistant.agentId, 'agent-default') // the default driver
})
