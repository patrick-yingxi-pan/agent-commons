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
import { generateCompactionSummaryPart, generateReply, systemPrompt, type ReplySession } from '../generate.ts'
import { summarizeConversation } from '../compaction.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import type { ApiToolRuntime } from './apiTools.ts'
import { createRoutineArtifactCapture } from '../routineArtifact.ts'

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
  server.closeAllConnections?.()
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

test('each completed endpoint call reports usage before tools and a later cancellation cannot erase it', async () => {
  const reports: Array<{ inputTokens: number; outputTokens: number }> = []
  const ac = new AbortController()
  let dispatched = 0
  let reportedBeforeEffect = false
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      dispatched += 1
      reportedBeforeEffect = reports.length === 1
      ac.abort()
      return { status: 200, body: { remaining: 42 } }
    },
  }
  await assert.rejects(generateReply(session, DEFAULT_AGENT, 'Check my usage.', {
    ...collect().handlers, onUsage: (usage) => reports.push(usage),
  }, ac.signal, {}, undefined, [], api))
  assert.equal(dispatched, 1)
  assert.equal(reportedBeforeEffect, true, 'the completed response was metered before its tool effect')
  assert.equal(reports.length, 1)
  assert.ok(reports[0].inputTokens > 0)
})

test('successful endpoint rounds report exactly the returned total without a final duplicate', async () => {
  const reports: Array<{ inputTokens: number; outputTokens: number }> = []
  const result = await generateReply(session, DEFAULT_AGENT, 'Open a workspace and draft the launch assets.', {
    ...collect().handlers, onUsage: (usage) => reports.push(usage),
  })
  assert.equal(result.outcome, 'ok')
  assert.equal(reports.length, 2, 'one tool response and one final prose response')
  assert.deepEqual(result.usage, reports.reduce((sum, usage) => ({
    inputTokens: sum.inputTokens + usage.inputTokens, outputTokens: sum.outputTokens + usage.outputTokens,
  }), { inputTokens: 0, outputTokens: 0 }))
})

test('a usage recorder failure stops endpoint execution without provider fallback or tool effects', async () => {
  let dispatches = 0
  let reports = 0
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => { dispatches += 1; return { status: 200, body: {} } },
  }
  await assert.rejects(generateReply(session, DEFAULT_AGENT, 'Check my usage.', {
    ...collect().handlers,
    onUsage: () => { reports += 1; throw new Error('private persistence failure') },
  }, undefined, {}, undefined, [], api), { name: 'UsageRecordingError' })
  assert.equal(reports, 1)
  assert.equal(dispatches, 0)
})

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

test('the endpoint tool loop carries structured sheet and slide saves as proposals only', async () => {
  for (const [prompt, expectedKind, expectedBody] of [
    [
      'Save this as metrics.sheet',
      'sheet',
      { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Summary', 'Saved from this conversation']] },
    ],
    [
      'Save this as metrics.slides deck',
      'slide',
      { type: 'slides', slides: [{ title: 'Summary', bullets: ['Saved from this conversation'] }] },
    ],
  ] as const) {
    const c = collect()
    const { message } = await generateReply(session, DEFAULT_AGENT, prompt, c.handlers)
    const op = message.relationActions?.[0]
    assert.equal(op?.kind, 'save-artifact')
    if (op?.kind !== 'save-artifact') continue
    assert.equal(op.artifact.kind, expectedKind)
    assert.deepEqual(op.artifact.body, expectedBody)
    assert.equal(message.escalation, undefined)
  }
})

test('the genuine Messages tool loop captures one standing-approved structured routine body', async () => {
  const capture = createRoutineArtifactCapture({ name: 'weekly-metrics.sheet', kind: 'sheet' })
  const c = collect()
  const result = await generateReply(
    session,
    { ...DEFAULT_AGENT, tools: [] },
    'Produce the standing-approved Sheet named "weekly-metrics.sheet". Submit its complete literal content exactly once with submit_routine_artifact, then give a brief run recap.',
    c.handlers,
    undefined,
    {},
    undefined,
    [],
    undefined,
    { routineArtifact: capture },
  )
  assert.equal(result.outcome, 'ok')
  assert.deepEqual(capture.result, {
    type: 'sheet',
    columns: ['Result', 'Value'],
    rows: [['Status', 'Complete']],
  })
  assert.equal(capture.failure, undefined)
  assert.equal(result.message.relationActions, undefined)
  assert.equal(result.message.toolActivities, undefined)
  assert.ok(result.message.content.length > 0, 'the second endpoint round returned a recap')
  assert.equal(result.message.content, c.text)
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

test('the endpoint loop can read through the API, then use the result turn to propose the requested action', async () => {
  const dispatched: string[] = []
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async (method, path) => {
      dispatched.push(`${method} ${path}`)
      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: Buffer.from('{"window":"healthy"}'),
      }
    },
  }
  const c = collect()
  const { message: msg, outcome } = await generateReply(
    session,
    DEFAULT_AGENT,
    'Check my usage, then create a project called Round Trip.',
    c.handlers,
    undefined,
    {},
    undefined,
    [],
    api,
  )

  assert.equal(outcome, 'ok')
  assert.deepEqual(dispatched, ['GET /usage'], 'the dependent read ran exactly once')
  assert.equal(msg.toolActivities?.[0]?.tool, 'api__get_usage', 'the read keeps its provenance')
  assert.equal(msg.escalation?.kind, 'project', 'the second tool batch proposed the dependent action')
  assert.ok(msg.escalation?.kind === 'project' && msg.escalation.project.name === 'Round Trip')
  assert.ok(c.text.length > 0, 'a third model response concluded in prose')
})

test('completed tool provenance survives when a later endpoint call fails before streaming prose', async () => {
  const liveBase = process.env.ANTHROPIC_BASE_URL
  assert.ok(liveBase)
  const api: ApiToolRuntime = {
    catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
    dispatch: async () => {
      // The first model call already returned its tool_use. Move only the next
      // loop call onto a closed endpoint after the admitted read settles.
      process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: Buffer.from('{"window":"healthy"}'),
      }
    },
  }
  try {
    const c = collect()
    const { message: msg, outcome, failure } = await generateReply(
      session,
      DEFAULT_AGENT,
      'Check my usage.',
      c.handlers,
      undefined,
      {},
      undefined,
      [],
      api,
    )
    assert.equal(outcome, 'fallback')
    assert.equal(failure, 'endpoint_unavailable')
    assert.equal(msg.toolActivities?.[0]?.tool, 'api__get_usage', 'settled provenance is not erased by the later failure')
    assert.match(msg.content, /couldn’t finish that turn/i)
    assert.equal(msg.content, c.text)
  } finally {
    process.env.ANTHROPIC_BASE_URL = liveBase
  }
})

test('a non-concluding endpoint is stopped after the configured tool-batch budget', async () => {
  const previous = process.env.MODEL_MAX_TOOL_ROUNDS
  process.env.MODEL_MAX_TOOL_ROUNDS = '2'
  try {
    const c = collect()
    const { message: msg, outcome, failure } = await generateReply(
      session,
      DEFAULT_AGENT,
      'Save this recap as runaway.md. Keep requesting tools forever.',
      c.handlers,
    )
    assert.equal(outcome, 'fallback')
    assert.equal(failure, 'tool_loop_limit')
    assert.match(msg.content, /kept requesting more tools/i)
    assert.match(msg.content, /no further tools were run/i)
    assert.equal(msg.relationActions?.length, 2, 'exactly the configured two batches executed; the third ran nothing')
    assert.equal(msg.content, c.text, 'the honest stop is part of both the stream and persisted message')
  } finally {
    if (previous === undefined) delete process.env.MODEL_MAX_TOOL_ROUNDS
    else process.env.MODEL_MAX_TOOL_ROUNDS = previous
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

test('endpoint-backed turns send prior active context to the model', async () => {
  const c = collect()
  const { message } = await generateReply(
    session,
    DEFAULT_AGENT,
    'Recall earlier context.',
    c.handlers,
    undefined,
    {},
    undefined,
    [],
    undefined,
    {},
    [{ role: 'user', text: 'The release codename is Firefly.' }, { role: 'assistant', text: 'I will remember Firefly.' }],
  )
  assert.match(message.content, /Firefly/, 'the endpoint received and used the earlier turns')
})

test('compaction is a source-derived, metered Messages call with no canned fallback', async () => {
  const generated = await summarizeConversation(
    [
      { id: 'old-user', role: 'user', content: 'Ship direct signed downloads under codename Firefly.' },
      { id: 'old-assistant', role: 'assistant', content: 'Decision recorded; notarization remains next.' },
    ],
    (prompt) => generateCompactionSummaryPart(prompt),
  )
  assert.match(generated.text, /Firefly/, 'the brief derives from the supplied conversation')
  assert.match(generated.text, /notarization/, 'open work survives the summary')
  assert.match(generated.text, /## Retained context/, 'the development fixture uses the provider-facing Markdown shape')
  assert.doesNotMatch(generated.text, /\{"id":/, 'wire metadata remains model input, not user-facing fixture prose')
  assert.ok(generated.usage.inputTokens > 0)
  assert.ok(generated.usage.outputTokens > 0)
})

test('systemPrompt composes the worker Agent prompt + instructions', () => {
  const agent = { id: 'a', label: 'A', systemPrompt: 'BASE PROMPT', tools: [], instructions: 'CUSTOM RULES' }
  const composed = systemPrompt({ id: 's', title: 'T' }, agent)
  assert.ok(composed.includes('BASE PROMPT') && composed.includes('CUSTOM RULES'), 'agent prompt + instructions present')
  // The default Agent reproduces the original framing verbatim — no behavior drift.
  assert.equal(systemPrompt({ id: 's', title: 'T' }, DEFAULT_AGENT), DEFAULT_AGENT.systemPrompt)
})
