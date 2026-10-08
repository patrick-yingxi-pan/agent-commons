/** Server-owned conversation turns without an HTTP/SSE view. The only external
 * boundary is the repository's local Anthropic-compatible model fixture. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from './model/index.ts'
import { DEFAULT_AGENT } from './data/workers.ts'
import { DEFAULT_PROVIDER_CONFIG, DEFAULT_PROVIDER_ID } from './data/providers.ts'
import { startConversationTurn } from './conversationExecution.ts'
import type { ReplyStreamEvent } from '../contract/index.ts'
import type { ApiToolRuntime } from './model/apiTools.ts'
import { store } from './store/index.ts'
import { turns } from './turns.ts'

let model: Server
let previousBaseUrl: string | undefined
let previousPace: string | undefined

before(async () => {
  previousBaseUrl = process.env.ANTHROPIC_BASE_URL
  previousPace = process.env.MODEL_PACE_MS
  model = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => model.once('listening', resolve))
  const address = model.address()
  assert.ok(address && typeof address === 'object')
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`
  process.env.MODEL_PACE_MS = '5'
})

after(() => {
  if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = previousBaseUrl
  if (previousPace === undefined) delete process.env.MODEL_PACE_MS
  else process.env.MODEL_PACE_MS = previousPace
  model.closeAllConnections?.()
  model.close()
})

const apiRuntime: ApiToolRuntime = { catalog: [], dispatch: async () => { throw new Error('No API tool is available in this test.') } }

function input(session: ReturnType<typeof store.createSession>, text: string, overrides: Record<string, unknown> = {}) {
  return {
    session: { id: session.id, title: session.title },
    agent: DEFAULT_AGENT,
    provider: DEFAULT_PROVIDER_CONFIG,
    providerId: DEFAULT_PROVIDER_ID,
    modelId: 'conversation-execution-test-model',
    tenantId: session.tenantId ?? store.defaultTenantId(),
    text,
    history: [],
    persist: true,
    apiRuntime,
    ...overrides,
  }
}

function capture(turnId: string) {
  const events: ReplyStreamEvent[] = []
  const attached = turns.attach(turnId, 0, (frame) => {
    if (frame) events.push(frame.event)
  })
  assert.ok(attached, 'the server-owned turn remains attachable while active')
  events.push(...attached.replay.map((frame) => frame.event))
  return { events, unsubscribe: attached.unsubscribe }
}

function waitForStart(turnId: string, events: ReplyStreamEvent[]): Promise<void> {
  if (events.some((event) => event.type === 'message.start')) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('The conversation turn did not start streaming.')), 5_000)
    const poll = () => {
      if (events.some((event) => event.type === 'message.start')) {
        clearTimeout(deadline)
        resolve()
      } else if (!turns.get(turnId)) {
        clearTimeout(deadline)
        reject(new Error('The conversation turn finished before its start frame.'))
      } else setTimeout(poll, 5)
    }
    poll()
  })
}

test('persists the user row before model completion, needs no HTTP view, and admits only one live turn per Session', async () => {
  const session = store.createSession('Conversation executor without a view')
  const committed: Array<{ outcome: string; message?: any }> = []
  const active = startConversationTurn(input(session, 'paced hello from a background initiator', {
    commit: (result: { outcome: string; message?: unknown }) => committed.push(result),
  }))
  assert.ok(active)

  const messages = store.getSession(session.id)?.messages ?? []
  assert.equal(messages.length, 1, 'the user row is stored synchronously before the model returns')
  assert.deepEqual({ role: messages[0].role, content: messages[0].content }, {
    role: 'user', content: 'paced hello from a background initiator',
  })
  assert.equal(committed.length, 0, 'the model result has not committed when the user row is already visible')
  assert.equal(turns.bySession(session.id)?.id, active.turn.id)

  const duplicate = startConversationTurn(input(session, 'a second turn must not be admitted'))
  assert.equal(duplicate, undefined, 'one Session cannot host overlapping model turns')
  assert.equal((store.getSession(session.id)?.messages ?? []).length, 1, 'refused admission adds no user row')

  const stream = capture(active.turn.id)
  await active.finished
  stream.unsubscribe()

  assert.equal(committed.length, 1, 'the durable initiator is committed exactly once')
  assert.equal(committed[0].outcome, 'ok', 'the commit receives the settled generation outcome')
  assert.ok(committed[0].message)
  assert.equal(committed[0].message.role, 'assistant')
  assert.equal(committed[0].message.agentId, DEFAULT_AGENT.id)
  assert.equal(committed[0].message.providerId, DEFAULT_PROVIDER_ID)
  assert.equal(committed[0].message.modelId, 'conversation-execution-test-model')
  const ended = stream.events.find((event) => event.type === 'message.end')
  assert.ok(ended && ended.type === 'message.end')
  assert.deepEqual(ended.message, committed[0].message, 'the view-independent event and durable callback share the stamped message')
  assert.equal(turns.bySession(session.id), undefined, 'completion releases the Session slot')
})

test('model-emitted project actions remain consent proposals, not store writes', async () => {
  const session = store.createSession('Conversation proposal remains pending')
  const name = `Executor Proposal ${Date.now()}`
  const active = startConversationTurn(input(session, `create project called ${name}`))
  assert.ok(active)
  await active.finished

  const assistant = store.getSession(session.id)?.messages?.find((message) => message.role === 'assistant')
  assert.ok(assistant?.escalation)
  assert.equal(assistant.escalation.kind, 'project')
  assert.equal(assistant.escalation.project.name, name)
  assert.equal(store.listProjects(session.tenantId).some((project) => project.name === name), false,
    'the proposal tool does not create the Project before owner confirmation')
})

test('explicit cancellation settles as aborted, persists its partial, and frees the Session slot', async () => {
  const session = store.createSession('Conversation executor cancellation')
  const before = store.generationOutcomes().aborted
  const active = startConversationTurn(input(session, 'paced cancellation should settle cleanly'))
  assert.ok(active)
  const stream = capture(active.turn.id)
  await waitForStart(active.turn.id, stream.events)

  assert.equal(turns.cancel(active.turn.id), true, 'explicit cancellation reaches the server-owned abort hook')
  await active.finished
  stream.unsubscribe()

  assert.equal(store.generationOutcomes().aborted, before + 1)
  assert.equal(turns.bySession(session.id), undefined, 'settled cancellation releases the Session slot')
  const assistant = store.getSession(session.id)?.messages?.find((message) => message.role === 'assistant')
  assert.ok(assistant, 'the partial assistant message is persisted on cancellation')
  assert.equal(assistant.agentId, DEFAULT_AGENT.id)
  const ended = stream.events.find((event) => event.type === 'message.end')
  assert.ok(ended && ended.type === 'message.end', 'the cancelled turn has a terminal event')
  assert.deepEqual(ended.message, assistant)

  const next = startConversationTurn(input(session, 'the released slot admits a fresh turn', { persist: false }))
  assert.ok(next, 'a new turn can start after explicit cancellation settles')
  await next.finished
})

test('a failed custom commit emits no message.end, is not retried, and still releases the live slot', async () => {
  const session = store.createSession('Conversation executor commit failure')
  const attempts: Array<{ outcome: string; message?: any }> = []
  const active = startConversationTurn(input(session, 'a successful model reply whose commit fails', {
    commit: (result: { outcome: string; message?: any }) => {
      attempts.push(result)
      throw new Error('durable job commit refused')
    },
  }))
  assert.ok(active)
  const stream = capture(active.turn.id)
  await active.finished
  stream.unsubscribe()

  assert.equal(attempts.length, 1, 'a durable commit failure is never retried')
  assert.equal(attempts[0].outcome, 'ok', 'the commit receives the actual model outcome')
  assert.equal(attempts[0].message?.role, 'assistant')
  assert.equal(attempts[0].message?.agentId, DEFAULT_AGENT.id)
  assert.equal(stream.events.some((event) => event.type === 'message.end'), false,
    'a failed durable commit must not claim that the assistant result is complete')
  assert.equal(turns.bySession(session.id), undefined, 'commit failure cannot wedge the Session turn slot')

  const next = startConversationTurn(input(session, 'the slot is reusable after failed commit', { persist: false }))
  assert.ok(next)
  await next.finished
})
