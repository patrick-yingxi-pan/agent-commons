/** Generation-outcome observability (P5 reliability / F6 PD31). Every turn resolves to an
 *  outcome — `ok` (the model answered), `fallback` (endpoint unreachable/slow → the degraded
 *  local reply), `aborted` (client closed mid-turn), `error` (fatal turn error) — counted so a
 *  degraded model path is visible in `/metrics` rather than silent. generate.ts reports ok vs
 *  fallback; the route observes aborted/error. The @anthropic-ai/sdk already does the transient
 *  retry/backoff (429/5xx/network) — this slice adds the *visibility* that was missing, not a
 *  duplicate retry layer. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../server/model/index.ts'
import { generateReply, type ReplySession } from '../server/generate.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'
import { store } from '../server/store.ts'
import { buildRouter } from '../server/routes/index.ts'
import { callRaw } from './helpers/http.ts'

let server: Server
const session: ReplySession = { id: 'gen-outcome', title: 'Outcome', isDemo: true }
const noop = { onStart: () => {}, onDelta: () => {} }

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

test('a reachable endpoint yields outcome=ok', async () => {
  const { outcome } = await generateReply(session, DEFAULT_AGENT, 'Help me think through the launch.', noop)
  assert.equal(outcome, 'ok')
})

test('an unreachable endpoint yields outcome=fallback (the degraded reply, not a throw)', async () => {
  const saved = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1' // nothing listens → connection refused
  try {
    const { outcome, message, usage } = await generateReply(session, DEFAULT_AGENT, 'hi', noop)
    assert.equal(outcome, 'fallback', 'a down endpoint degrades to the fallback, reported as such')
    assert.match(message.content, /couldn.t reach the model endpoint/, 'the degraded reply text streamed')
    assert.equal(usage.inputTokens + usage.outputTokens, 0, 'no tokens consumed on a fallback')
  } finally {
    process.env.ANTHROPIC_BASE_URL = saved
  }
})

test('the store tallies outcomes; /metrics exposes model_turns_total for every outcome', async () => {
  const before = store.generationOutcomes()
  store.recordGenerationOutcome('fallback')
  store.recordGenerationOutcome('aborted')
  const afterCounts = store.generationOutcomes()
  assert.equal(afterCounts.fallback, before.fallback + 1, 'fallback tally incremented')
  assert.equal(afterCounts.aborted, before.aborted + 1, 'aborted tally incremented')

  const res = await callRaw('GET', '/metrics')
  assert.equal(res.status, 200)
  assert.match(res.body, /# TYPE model_turns_total counter/)
  // Every series is present from the first scrape (0 until seen), so a dashboard can chart them.
  for (const outcome of ['ok', 'fallback', 'aborted', 'error']) {
    assert.match(res.body, new RegExp(`model_turns_total\\{outcome="${outcome}"\\} \\d+`), `${outcome} series present`)
  }
})

test('a client disconnect mid-turn counts an `aborted` outcome (route catch classification)', async () => {
  // The standard HTTP harness stubs req.on as a no-op, so it can't exercise the route's
  // abort/error branch. Drive the router with a manual req that fires `close` the instant the
  // route registers its handler — aborting the turn's AbortController BEFORE generateReply
  // runs, so the turn deterministically takes the client-disconnect path (→ 'aborted').
  const router = buildRouter()
  const s = store.createSession('abort path')
  const before = store.generationOutcomes().aborted

  let ended = false
  const res = {
    writeHead: () => res,
    setHeader: () => {},
    write: () => true,
    end: () => {
      ended = true
    },
    flushHeaders: () => {},
    on: () => {},
    get writableEnded() {
      return ended
    },
  }
  const handlers: Record<string, (arg?: unknown) => void> = {}
  let bodySent = false
  const req = {
    method: 'POST',
    headers: {},
    on(ev: string, cb: (arg?: unknown) => void) {
      handlers[ev] = cb
      if (ev === 'end' && !bodySent) {
        bodySent = true
        queueMicrotask(() => {
          handlers.data?.(Buffer.from(JSON.stringify({ text: 'hi', ephemeral: true })))
          handlers.end?.()
        })
      }
      // Fire `close` synchronously on registration → ac.abort() runs before generateReply,
      // forcing the deterministic aborted path (no race with the model stream).
      if (ev === 'close') cb()
      return req
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await router.handle(req as any, res as any, new URL(`http://test/sessions/${s.id}/messages`))
  assert.equal(store.generationOutcomes().aborted, before + 1, 'a mid-turn client disconnect is counted as aborted')
})
