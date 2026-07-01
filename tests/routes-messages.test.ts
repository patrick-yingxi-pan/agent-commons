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

test('a multi-tool MCP server selects the RIGHT tool + kind over the wire (write → write_file/action, only PROPOSED)', async () => {
  const s = store.createSession('mcp multi-tool')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem', ephemeral: true })
  assert.match(body, /mcp__filesystem__write_file/, 'a write message selects write_file, not the first-declared read_file')
  assert.match(body, /"kind":"action"/, 'a write is classified as an action, not a no-consent read')
  assert.match(body, /"status":"proposed"/, 'a write is only PROPOSED — consent-gated, not executed on the turn')
  assert.doesNotMatch(body, /mcp__filesystem__read_file/, 'read_file was not the one called')
  assert.match(body, /used the connected tools/i, 'the second-turn prose references the connector activity')
})

test('confirming a proposed connector action executes it (mock) + records an audit entry', async () => {
  const s = store.createSession('connector write confirm')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  // A persisted (non-ephemeral) turn so the proposed activity lives on a real message.
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const proposed = thread
    .flatMap((m: { toolActivities?: { id: string; status?: string; kind?: string }[] }) => m.toolActivities ?? [])
    .find((a: { status?: string; kind?: string }) => a.kind === 'action' && a.status === 'proposed')
  assert.ok(proposed, 'the write landed as a proposed action awaiting consent')

  const auditBefore = store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  const res = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'confirm' })
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'done', 'confirm flips the action to done')
  assert.match(res.json.summary, /\(mock\)/, 'the done summary is the mock result')
  const auditAfter = store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  assert.equal(auditAfter, auditBefore + 1, 'confirm records exactly one connector.write audit entry')

  // Idempotent: confirming again returns the already-done activity, no second audit.
  const again = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'confirm' })
  assert.equal(again.json.status, 'done')
  assert.equal(store.listAuditLog().filter((e) => e.capability === 'connector.write').length, auditAfter, 'no duplicate audit on re-confirm')
})

test('declining a proposed connector action marks it declined + records no audit', async () => {
  const s = store.createSession('connector write decline')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const proposed = thread
    .flatMap((m: { toolActivities?: { id: string; status?: string; kind?: string }[] }) => m.toolActivities ?? [])
    .find((a: { status?: string; kind?: string }) => a.kind === 'action' && a.status === 'proposed')
  const before = store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  const res = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'decline' })
  assert.equal(res.json.status, 'declined', 'decline marks it declined')
  assert.equal(store.listAuditLog().filter((e) => e.capability === 'connector.write').length, before, 'a declined action records no audit')
})

test('an attached connector the message does NOT name drives no tool activity', async () => {
  const s = store.createSession('connector attached but unnamed')
  store.attachContext(s.id, { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' })
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'what should we ship next quarter?', ephemeral: true })
  assert.doesNotMatch(body, /"type":"message\.toolActivity"/, 'naming no connector ⇒ no call, even with one attached')
})

test('a non-ephemeral connector turn persists its toolActivities (survives reload)', async () => {
  const s = store.createSession('connector persistence')
  store.attachContext(s.id, { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' })
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'list my slack channels' }) // not ephemeral → persisted
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const assistant = thread.find((m: { role: string; toolActivities?: unknown[] }) => m.role === 'assistant' && (m.toolActivities?.length ?? 0) > 0)
  assert.ok(assistant, 'the persisted assistant turn carries its toolActivities')
  assert.equal(assistant.toolActivities[0].tool, 'connector__slack__list')
})

test('a persisted assistant turn is stamped with its driving Agent (D16 per-turn provenance)', async () => {
  const s = store.createSession('start')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello' }) // not ephemeral → persisted
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const assistant = thread.find((m: { role: string; agentId?: string }) => m.role === 'assistant')
  assert.ok(assistant, 'the assistant turn was persisted')
  assert.equal(assistant.agentId, 'agent-default') // the default driver
})

test('a completed turn counts an `ok` generation outcome (route → /metrics wiring, F6 PD31)', async () => {
  const before = store.generationOutcomes().ok
  const s = store.createSession('outcome wiring')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello', ephemeral: true })
  assert.equal(store.generationOutcomes().ok, before + 1, 'the route records the turn outcome the model reported')
})
