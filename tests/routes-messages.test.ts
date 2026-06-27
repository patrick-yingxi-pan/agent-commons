/** Integration tests for the message route (POST /sessions/:id/messages) — it must
 *  stream the reply, emit the tool-driven proposals (`message.relations` /
 *  `message.escalation`), and honor `ephemeral` (the tour) by NOT persisting the
 *  turn. Boots the mock model on an ephemeral port and points the backend at it. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../server/model/index.ts'
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
