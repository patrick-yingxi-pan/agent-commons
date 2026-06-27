/** Integration test for the backend tool-use loop (server/generate.ts) driving the
 *  real Anthropic SDK against the mock model server: a turn streams prose AND runs
 *  the model's tool calls, surfacing the consent-gated proposals (escalations +
 *  relation ops). The only mock is the model endpoint — this is the production path.
 *
 *  We boot the mock model on an ephemeral port and point generate.ts at it via
 *  `ANTHROPIC_BASE_URL` (read lazily per call), so the test is hermetic. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../server/model/index.ts'
import { generateReply, type ReplySession } from '../server/generate.ts'

let server: Server
const session: ReplySession = { id: 'insights-launch', title: 'Insights dashboard launch', isDemo: true }

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

function collect() {
  let text = ''
  let started = ''
  return {
    handlers: { onStart: (id: string) => (started = id), onDelta: (d: string) => (text += d) },
    get text() {
      return text
    },
    get started() {
      return started
    },
  }
}

test('a workspace turn streams prose AND yields a workspace escalation (the tool ran)', async () => {
  const c = collect()
  const msg = await generateReply(
    session,
    'Yes — turn that into a one-pager and a launch email, plus a hero image. Pull from our brand kit and the last launch’s assets so it stays on-brand.',
    c.handlers,
  )
  assert.equal(msg.escalation?.kind, 'workspace')
  assert.equal(msg.relationActions, undefined)
  assert.ok(c.text.length > 0, 'streamed final prose')
  assert.equal(msg.id, c.started, 'final message id matches the streamed start id')
  assert.equal(msg.content, c.text, 'returned content == streamed text')
})

test('a relation-op turn yields the relation proposal (save-artifact)', async () => {
  const c = collect()
  const msg = await generateReply(session, 'Save the recap of this as launch-recap.md and file it under the project.', c.handlers)
  assert.equal(msg.escalation, undefined)
  assert.ok(msg.relationActions && msg.relationActions[0].kind === 'save-artifact')
  assert.ok(c.text.length > 0)
})

test('a project turn yields a project escalation (create_project, unfiled for the tour)', async () => {
  const c = collect()
  const msg = await generateReply(session, 'This is becoming a real effort. Can you give it a home of its own?', c.handlers)
  assert.equal(msg.escalation?.kind, 'project')
  assert.ok(msg.escalation?.kind === 'project' && msg.escalation.fileSession === false)
})

test('a plain-chat turn yields prose only — no escalation, no relations', async () => {
  const c = collect()
  const msg = await generateReply(session, 'We ship the new Insights dashboard next week. Help me think through the launch.', c.handlers)
  assert.equal(msg.escalation, undefined)
  assert.equal(msg.relationActions, undefined)
  assert.ok(msg.content.length > 0)
})
