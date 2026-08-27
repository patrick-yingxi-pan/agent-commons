/** Idempotent send (multi-account design §5.4, invariant I4): a retry of the
 *  same logical send — same session + `Idempotency-Key` — never double-appends
 *  the user turn or double-generates. Mid-turn retry ATTACHES to the live turn
 *  (replay from the top, then the live tail); post-completion retry replays the
 *  persisted `message.end`; a key the server never saw generates normally. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from './model/index.ts'
import { store } from './store/index.ts'
import { turns } from './turns.ts'
import { call, callRaw } from './testkit/http.ts'
import { buildRouter } from './routes/index.ts'

let server: Server
before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => server.on('listening', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.MODEL_PACE_MS = '25'
})
after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.MODEL_PACE_MS
  server.close()
})

function frames(body: string): Array<Record<string, any>> {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(5).trim()))
}

/** callRaw with request headers (the shared helper doesn't take them). */
async function callRawWithHeaders(method: string, path: string, bodyObj: unknown, headers: Record<string, string>) {
  const router = buildRouter()
  let status = 0
  let body = ''
  let ended = false
  const res: any = {
    writeHead: (s: number) => ((status = s), res),
    setHeader: () => {},
    write: (c: string) => ((body += c), true),
    end: (c?: string) => {
      if (c) body += c
      ended = true
    },
    flushHeaders: () => {},
    on: () => {},
    get writableEnded() {
      return ended
    },
  }
  const handlers: Record<string, (arg?: any) => void> = {}
  let emitted = false
  const req: any = {
    method,
    headers,
    on(ev: string, cb: (arg?: any) => void) {
      handlers[ev] = cb
      if (ev === 'end' && !emitted) {
        emitted = true
        queueMicrotask(() => {
          if (bodyObj !== undefined) handlers.data?.(Buffer.from(JSON.stringify(bodyObj)))
          handlers.end?.()
        })
      }
      return req
    },
  }
  await router.handle(req, res, new URL(`http://test${path}`))
  return { status, body }
}

async function waitForLiveTurn(sessionId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const turn = turns.bySession(sessionId)
    if (turn && turn.messageId) return turn
    assert.ok(Date.now() < deadline, `no live turn appeared for ${sessionId}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

const userTurns = (sessionId: string) => (store.getSession(sessionId)?.messages ?? []).filter((m) => m.role === 'user')
const assistantTurns = (sessionId: string) => (store.getSession(sessionId)?.messages ?? []).filter((m) => m.role === 'assistant')

test('a mid-turn retry with the same key attaches to the live turn — one user turn, one generation (I4)', async () => {
  const s = store.createSession('retry attaches')
  const okBefore = store.generationOutcomes().ok
  const key = 'idem-live-1'

  const first = callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'paced reply please' }, { 'idempotency-key': key })
  await waitForLiveTurn(s.id)

  // The "transport retry": same session, same key, while the turn streams.
  const retry = await callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'paced reply please' }, { 'idempotency-key': key })
  assert.equal(retry.status, 200, 'the retry is served, not 409ed — same logical send')
  const retryEvents = frames(retry.body)
  assert.ok(retryEvents.some((e) => e.type === 'message.start'), 'the retry view replays from the top')
  const retrySeqs = retryEvents.filter((e) => e.type === 'message.delta').map((e) => e.seq as number)
  assert.ok(retrySeqs.every((n, i) => i === 0 || n > retrySeqs[i - 1]), 'replayed deltas keep their monotonic seq')

  const firstRes = await first
  assert.ok(frames(firstRes.body).some((e) => e.type === 'message.end'), 'the original stream completed normally')

  assert.equal(userTurns(s.id).length, 1, 'the user turn was appended exactly once')
  assert.equal(assistantTurns(s.id).length, 1, 'exactly one assistant turn was generated')
  assert.equal(store.generationOutcomes().ok, okBefore + 1, 'exactly one generation ran')
})

test('a post-completion retry replays the persisted message.end without regenerating', async () => {
  const s = store.createSession('retry replays the record')
  const key = 'idem-done-1'

  const first = await callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'hello there' }, { 'idempotency-key': key })
  assert.equal(first.status, 200)
  const persisted = assistantTurns(s.id).at(-1)
  assert.ok(persisted, 'the first send persisted the assistant turn')
  const okBefore = store.generationOutcomes().ok

  const retry = await callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'hello there' }, { 'idempotency-key': key })
  assert.equal(retry.status, 200)
  const evs = frames(retry.body)
  assert.equal(evs.length, 1, 'exactly one frame: the terminal message.end')
  assert.equal(evs[0].type, 'message.end')
  assert.equal(evs[0].message.id, persisted.id, 'the replayed message IS the record')
  assert.equal(evs[0].message.content, persisted.content)

  assert.equal(userTurns(s.id).length, 1, 'no second user turn')
  assert.equal(assistantTurns(s.id).length, 1, 'no second assistant turn')
  assert.equal(store.generationOutcomes().ok, okBefore, 'no second generation ran')
})

test('an orphaned persisted user row is regenerated in place after transient turn state is gone', async () => {
  const s = store.createSession('retry orphan in place')
  const text = 'recover this exact prompt'
  store.appendMessage(s.id, { id: store.mintMessageId('user'), role: 'user', content: text })
  assert.deepEqual(userTurns(s.id).map((message) => message.content), [text])

  // This is the post-restart/post-error shape: the transcript kept the user
  // turn, while the transient live/completed idempotency registries know no key.
  const retry = await callRawWithHeaders(
    'POST',
    `/sessions/${s.id}/messages`,
    { text, retryLastUser: true },
    { 'idempotency-key': 'idem-orphan-1' },
  )
  assert.equal(retry.status, 200)
  assert.ok(frames(retry.body).some((event) => event.type === 'message.end'))
  assert.equal(userTurns(s.id).length, 1, 'retry reused the unresolved user row')
  assert.equal(assistantTurns(s.id).length, 1, 'one recovered reply persisted')
})

test('retryLastUser still appends once when the first attempt never persisted', async () => {
  const s = store.createSession('retry before persistence')
  const retry = await callRawWithHeaders(
    'POST',
    `/sessions/${s.id}/messages`,
    { text: 'first accepted attempt', retryLastUser: true },
    { 'idempotency-key': 'idem-before-persist-1' },
  )
  assert.equal(retry.status, 200)
  assert.equal(userTurns(s.id).length, 1, 'absence of a matching user tail becomes one ordinary append')
  assert.equal(assistantTurns(s.id).length, 1)
})

test('a DIFFERENT key mid-turn is still a genuine concurrent send — refused 409', async () => {
  const s = store.createSession('different key conflicts')
  const first = callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'paced reply please' }, { 'idempotency-key': 'idem-a' })
  await waitForLiveTurn(s.id)
  const other = await callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'something else' }, { 'idempotency-key': 'idem-b' })
  assert.equal(other.status, 409, 'a different logical send during a live turn is a real conflict')
  await first
})

test('keyless sends are unchanged: two sequential sends both generate', async () => {
  const s = store.createSession('keyless unchanged')
  const r1 = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello there' })
  const r2 = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello again' })
  assert.equal(r1.status, 200)
  assert.equal(r2.status, 200)
  assert.equal(userTurns(s.id).length, 2)
  assert.equal(assistantTurns(s.id).length, 2)
})

test('an EPHEMERAL turn does not graduate its key: a later retry genuinely regenerates', async () => {
  const s = store.createSession('ephemeral no replay')
  const key = 'idem-ephemeral-1'
  const first = await callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'hello there', ephemeral: true }, { 'idempotency-key': key })
  assert.equal(first.status, 200)
  assert.equal(assistantTurns(s.id).length, 0, 'ephemeral persisted nothing')

  const retry = await callRawWithHeaders('POST', `/sessions/${s.id}/messages`, { text: 'hello there', ephemeral: true }, { 'idempotency-key': key })
  const evs = frames(retry.body)
  assert.ok(evs.some((e) => e.type === 'message.start'), 'the retry regenerated (no record to replay)')
  assert.ok(evs.some((e) => e.type === 'message.end'))
})
