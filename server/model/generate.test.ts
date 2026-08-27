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
import { startModelServer } from './index.ts'
import { generateReply, systemPrompt, type ReplySession } from '../generate.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'

let server: Server
const session: ReplySession = { id: 'auth-refactor', title: 'Refactor auth middleware' }

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
  const { message: msg } = await generateReply(
    session,
    DEFAULT_AGENT,
    'Open a workspace and draft the launch assets.',
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
  const { message: msg } = await generateReply(session, DEFAULT_AGENT, 'Save the recap of this as launch-recap.md', c.handlers)
  assert.equal(msg.escalation, undefined)
  assert.ok(msg.relationActions && msg.relationActions[0].kind === 'save-artifact')
  assert.ok(c.text.length > 0)
})

test('a project turn yields a project escalation (create_project, filing this session)', async () => {
  const c = collect()
  const { message: msg } = await generateReply(session, DEFAULT_AGENT, 'Create a project called Auth hardening.', c.handlers)
  assert.equal(msg.escalation?.kind, 'project')
  assert.ok(msg.escalation?.kind === 'project' && msg.escalation.fileSession === true)
})

test('the dial-out path enforces the shared per-batch call ceiling without collapsing the reply', async () => {
  const previous = process.env.MODEL_MAX_TOOL_CALLS
  process.env.MODEL_MAX_TOOL_CALLS = '1'
  try {
    const c = collect()
    const { message: msg, outcome } = await generateReply(
      session,
      DEFAULT_AGENT,
      'Connect the repo and save the recap as guarded.md.',
      c.handlers,
    )
    assert.equal(outcome, 'ok', 'the refused excess call is model-visible recovery, not a turn fallback')
    assert.equal(msg.escalation?.kind, 'repo', 'the admitted prefix still executed')
    assert.equal(msg.relationActions, undefined, 'the excess save_artifact call did not execute')
    assert.ok(c.text.length > 0, 'the second model call still concluded in prose')
  } finally {
    if (previous === undefined) delete process.env.MODEL_MAX_TOOL_CALLS
    else process.env.MODEL_MAX_TOOL_CALLS = previous
  }
})

test('a plain-chat turn yields prose only — no escalation, no relations', async () => {
  const c = collect()
  const { message: msg } = await generateReply(session, DEFAULT_AGENT, 'We ship the new Insights dashboard next week. Help me think through the launch.', c.handlers)
  assert.equal(msg.escalation, undefined)
  assert.equal(msg.relationActions, undefined)
  assert.ok(msg.content.length > 0)
})

test('a turn reports the real token usage it consumed (fed to the meter)', async () => {
  const c = collect()
  const { usage } = await generateReply(session, DEFAULT_AGENT, 'We ship the new Insights dashboard next week. Help me think through the launch.', c.handlers)
  assert.ok(usage.inputTokens > 0, 'input tokens metered')
  assert.ok(usage.outputTokens > 0, 'output tokens metered')
})

test('systemPrompt composes the worker Agent prompt + instructions', () => {
  const agent = { id: 'a', label: 'A', systemPrompt: 'BASE PROMPT', tools: [], instructions: 'CUSTOM RULES' }
  const composed = systemPrompt({ id: 's', title: 'T' }, agent)
  assert.ok(composed.includes('BASE PROMPT') && composed.includes('CUSTOM RULES'), 'agent prompt + instructions present')
  // The default Agent reproduces the original framing verbatim — no behavior drift.
  assert.equal(systemPrompt({ id: 's', title: 'T' }, DEFAULT_AGENT), DEFAULT_AGENT.systemPrompt)
})
