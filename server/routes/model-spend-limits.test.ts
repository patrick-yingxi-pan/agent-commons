/** Authenticated Send/compaction admission must honor every inherited budget.
 * The authored loopback Messages peer proves refusal happens before model I/O;
 * its successful responses also exercise represented replay without paid calls. */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { Budget, Session } from '../../contract/index.ts'
import { accounts } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { store } from '../store/index.ts'
import { call, callFresh, callRaw } from '../testkit/http.ts'

const FIVE_HOUR = '5-hour limit'
const WEEKLY = 'Weekly · all models'
const REPLY = 'Local budget-bound reply preserves the reviewed decisions.'
let peer: Server
let baseURL = ''
const requests: Array<{ model: string; stream?: boolean }> = []

before(async () => {
  peer = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({ model: body.model, stream: body.stream })
    const result = {
      id: `budget-${requests.length}`, type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 3 },
    }
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }
    const events = [
      { type: 'message_start', message: { ...result, content: [], stop_reason: null, usage: { input_tokens: 2, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await new Promise<void>((resolve, reject) => {
    peer.once('error', reject)
    peer.listen(0, '127.0.0.1', resolve)
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  baseURL = `http://127.0.0.1:${address.port}`
})

after(async () => {
  peer.closeAllConnections()
  await new Promise<void>(resolve => peer.close(() => resolve()))
})

const budget = (fiveHour: number, weekly = 1_000): Budget => ({ windows: [
  { label: FIVE_HOUR, ceiling: fiveHour }, { label: WEEKLY, ceiling: weekly },
] })

async function fixture(label: string, parent: Budget, agentBudget?: Budget, override?: Budget) {
  const stamp = randomUUID()
  const org = accounts.createOrg('user-ada', `Budget route ${label} ${stamp}`)
  assert.ok(org)
  const headers = { cookie: `${SESSION_COOKIE}=${signSession({ userId: 'user-ada', tenantId: org.id, iat: Date.now() })}` }
  const model = `budget-model-${stamp}`
  const provider = (plan: Budget, suffix: string) => store.createProvider({
    label: `${label} ${suffix}`, modelFamily: 'claude', effortLevels: [], plan,
    models: [{ id: model, label: model }],
  }, { baseURL, model, capabilities: { toolUse: false } }, org.id)
  const parentProvider = provider(parent, 'Agent parent')
  const selectedProvider = override ? provider(override, 'explicit override') : parentProvider
  const agent = store.createAgent({
    label: `${label} Agent`, systemPrompt: 'Answer briefly without tools.', instructions: '', tools: [],
    providerId: parentProvider.id, ...(agentBudget ? { budget: agentBudget } : {}),
  }, org.id)
  const created = await call('POST', '/sessions', {
    firstMessage: label, agentId: agent.id,
    ...(override ? { providerId: selectedProvider.id } : {}),
  }, headers)
  assert.equal(created.status, 200)
  const session = created.json as Session
  assert.equal(session.agentId, agent.id)
  assert.equal(session.providerId, override ? selectedProvider.id : undefined)
  assert.equal(agent.budget, agentBudget, 'fixtures preserve genuine undefined or partial Agent budgets')
  return { tenantId: org.id, headers, session, model }
}

function longHistory(sessionId: string) {
  for (let index = 0; index < 9; index += 1) {
    const role = index % 2 ? 'assistant' : 'user'
    store.appendMessage(sessionId, {
      id: store.mintMessageId(role), role,
      content: `Reviewed decision ${index}: retain provider budget inheritance. ${'Durable context. '.repeat(50)}`,
    })
  }
}

const cases = [
  { label: 'undefined Agent budget inherits its provider ceiling', parent: budget(5), expected: FIVE_HOUR },
  { label: 'partial Agent windows inherit the omitted provider ceiling', parent: budget(5), agent: { windows: [{ label: WEEKLY, ceiling: 100 }] }, expected: FIVE_HOUR },
  { label: 'partial Agent windows inherit an omitted weekly provider ceiling', parent: budget(100, 5), agent: { windows: [{ label: FIVE_HOUR, ceiling: 50 }] }, expected: WEEKLY },
  { label: 'wider explicit provider cannot bypass the Agent parent ceiling', parent: budget(5), override: budget(1_000), expected: FIVE_HOUR },
  { label: 'wider explicit provider cannot bypass an explicit Agent ceiling', parent: budget(1_000), agent: budget(5), override: budget(1_000), expected: FIVE_HOUR },
  { label: 'stricter selected provider tightens the Agent budget', parent: budget(1_000), agent: budget(100), override: budget(5), expected: FIVE_HOUR },
] satisfies Array<{ label: string; parent: Budget; agent?: Budget; override?: Budget; expected: string }>

for (const operation of ['Send', 'compaction'] as const) {
  for (const scenario of cases) {
    test(`${operation}: ${scenario.label} refuses before model I/O or history mutation`, async () => {
      const f = await fixture(`${operation} ${scenario.label}`, scenario.parent, scenario.agent, scenario.override)
      if (operation === 'compaction') longHistory(f.session.id)
      const before = structuredClone(store.getSession(f.session.id))
      if (operation === 'compaction') {
        assert.equal(store.prepareSessionCompaction(f.session.id)?.kind, 'ready', 'this is real compaction, not the no-op fast path')
      }
      store.recordUsage(6, 0, f.tenantId)
      assert.equal(store.overSpendLimit(undefined, f.tenantId), null, 'the account plan itself still has headroom')
      const requestCount = requests.length
      const result = operation === 'Send'
        ? await callRaw('POST', `/sessions/${f.session.id}/messages`, { text: 'Do not spend beyond the inherited cap.' }, f.headers)
        : await call('POST', `/sessions/${f.session.id}/compact`, {}, f.headers)
      assert.equal(result.status, 429, `${operation} must refuse exhausted inherited budget before admission`)
      const error = 'json' in result ? result.json.error : JSON.parse(result.body).error
      assert.equal(error.code, 'limit_exceeded')
      assert.ok(error.message.includes(scenario.expected), 'the refusal names the exhausted window')
      assert.equal(requests.length, requestCount, 'no endpoint request leaves after refusal')
      assert.deepEqual(store.getSession(f.session.id), before, 'no transcript, archive, receipt or active-turn mutation occurs')
      assert.equal(store.usage(undefined, f.tenantId).limits.find(window => window.key === 'fiveHour')?.usedTokens, 6, 'refusal spends no additional tokens')
    })
  }
}

test('represented keyed Send replays before current inherited provider-budget admission', async () => {
  const f = await fixture('Send replay', budget(100))
  const headers = { ...f.headers, 'idempotency-key': randomUUID() }
  const path = `/sessions/${f.session.id}/messages`
  const first = await callRaw('POST', path, { text: 'Answer exactly once.' }, headers)
  assert.equal(first.status, 200)
  assert.match(first.body, /message\.end/)
  assert.match(first.body, /Local budget-bound reply/)
  assert.equal(requests.filter(request => request.model === f.model).length, 1)
  store.recordUsage(100, 0, f.tenantId)
  const beforeReplay = structuredClone(store.getSession(f.session.id))
  const replay = await callRaw('POST', path, { text: 'Answer exactly once.' }, headers)
  assert.equal(replay.status, 200, 'represented turns remain recoverable after exhausting their provider plan')
  assert.match(replay.body, /Local budget-bound reply/)
  assert.equal(requests.filter(request => request.model === f.model).length, 1, 'replay never regenerates')
  assert.deepEqual(store.getSession(f.session.id), beforeReplay)
  const fresh = await callRaw('POST', path, { text: 'A new billable turn.' }, { ...f.headers, 'idempotency-key': randomUUID() })
  assert.equal(fresh.status, 429, 'only a genuinely new send is budget-gated')
  assert.equal(requests.filter(request => request.model === f.model).length, 1)
  assert.deepEqual(store.getSession(f.session.id), beforeReplay)
})

test('durably represented compaction replays before current inherited provider-budget admission', async () => {
  const f = await fixture('Compaction replay', budget(100))
  longHistory(f.session.id)
  const headers = { ...f.headers, 'idempotency-key': randomUUID() }
  const path = `/sessions/${f.session.id}/compact`
  const first = await call('POST', path, {}, headers)
  assert.equal(first.status, 200)
  assert.equal(first.json.compactionReceiptIds?.length, 1)
  const modelRequests = requests.filter(request => request.model === f.model).length
  assert.ok(modelRequests > 0, 'a substantive successful summary reached the authored peer')
  assert.ok(store.getSession(f.session.id)?.compactedMessages?.length, 'the first compaction retained its source archive')
  // New history makes a different key substantive again; the old receipt must
  // still bypass admission even after middleware replay memory is discarded.
  longHistory(f.session.id)
  store.recordUsage(100, 0, f.tenantId)
  const beforeReplay = structuredClone(store.getSession(f.session.id))
  assert.equal(store.prepareSessionCompaction(f.session.id)?.kind, 'ready')
  const replay = await callFresh('POST', path, {}, headers)
  assert.equal(replay.status, 200, 'durable represented compaction remains recoverable above the provider cap')
  assert.deepEqual(replay.json.compactionReceiptIds, first.json.compactionReceiptIds)
  assert.equal(requests.filter(request => request.model === f.model).length, modelRequests)
  assert.deepEqual(store.getSession(f.session.id), beforeReplay)
  const fresh = await callFresh('POST', path, {}, { ...f.headers, 'idempotency-key': randomUUID() })
  assert.equal(fresh.status, 429, 'a new substantive compaction must be refused')
  assert.equal(requests.filter(request => request.model === f.model).length, modelRequests)
  assert.deepEqual(store.getSession(f.session.id), beforeReplay)
})
