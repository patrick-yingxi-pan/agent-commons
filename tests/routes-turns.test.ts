/** Server-owned turns at the HTTP surface (docs/design/multi-account-ui.md §5.2,
 *  invariants I1–I4): a viewer disconnect no longer aborts a turn (detach, don't
 *  abort); the explicit cancel route persists the partial; a live turn is visible
 *  as `Session.activeTurnId` and reattachable with `?after=<seq>` replay; a
 *  concurrent second send is refused. Drives the real router against the real
 *  mock model server (paced deltas so mid-turn actions are deterministic). */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../server/model/index.ts'
import { store } from '../server/store.ts'
import { turns } from '../server/turns.ts'
import { call, callRaw } from './helpers/http.ts'

let server: Server
before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => server.on('listening', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.MODEL_PACE_MS = '25' // paced turns stream slowly enough to act mid-turn, fast enough for CI
})
after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.MODEL_PACE_MS
  server.close()
})

/** Parse the SSE body of a send/reattach stream into its typed events. */
function frames(body: string): Array<Record<string, any>> {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(5).trim()))
}

/** Poll until the session has a live turn (the paced send has started streaming). */
async function waitForLiveTurn(sessionId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const turn = turns.bySession(sessionId)
    if (turn && turn.messageId) return turn
    assert.ok(Date.now() < deadline, `no live turn appeared for ${sessionId}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('a completed send carries turnId + monotonic delta seq, and clears activeTurnId', async () => {
  const s = store.createSession('turn wire shape')
  const res = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello there' })
  assert.equal(res.status, 200)
  const evs = frames(res.body)
  const start = evs.find((e) => e.type === 'message.start')
  assert.ok(start?.turnId, 'message.start carries the server-owned turn id')
  const seqs = evs.filter((e) => e.type === 'message.delta').map((e) => e.seq)
  assert.ok(seqs.length > 0, 'deltas streamed')
  assert.ok(
    seqs.every((n, i) => typeof n === 'number' && (i === 0 || n > seqs[i - 1])),
    'delta seq is monotonic',
  )
  assert.ok(evs.some((e) => e.type === 'message.end'), 'the stream ends with message.end')

  const got = await call('GET', `/sessions/${s.id}`)
  assert.equal(got.json.activeTurnId, undefined, 'no live turn after completion')
  const msgs = got.json.messages ?? []
  assert.equal(msgs.at(-1)?.role, 'assistant', 'the assistant turn persisted')
})

test('a viewer disconnect mid-turn detaches the view — the turn completes and persists (I1)', async () => {
  const s = store.createSession('detach not abort')
  const outcomesBefore = store.generationOutcomes()

  // A response that dies right after the SSE headers — the harness's stand-in for
  // "the viewer went away" (account switch, dropped network). Every subsequent
  // channel.send no-ops against it.
  let ended = false
  const deadRes: any = {
    writeHead: () => {
      ended = true // the connection is gone the moment streaming begins
      return deadRes
    },
    setHeader: () => {},
    write: () => false,
    end: () => {
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
  const deadReq: any = {
    method: 'POST',
    headers: {},
    on(ev: string, cb: (arg?: any) => void) {
      handlers[ev] = cb
      if (ev === 'end' && !emitted) {
        emitted = true
        queueMicrotask(() => {
          handlers.data?.(Buffer.from(JSON.stringify({ text: 'hello after the viewer left' })))
          handlers.end?.()
        })
      }
      if (ev === 'close') cb() // and the socket close fires immediately, like the old abort test
      return deadReq
    },
  }
  const { buildRouter } = await import('../server/routes/index.ts')
  await buildRouter().handle(deadReq, deadRes, new URL(`http://test/sessions/${s.id}/messages`))

  const outcomes = store.generationOutcomes()
  assert.equal(outcomes.aborted, outcomesBefore.aborted, 'a disconnect is NOT counted as aborted any more')
  assert.equal(outcomes.ok, outcomesBefore.ok + 1, 'the detached turn completed as ok')
  const msgs = store.getSession(s.id)?.messages ?? []
  assert.equal(msgs.at(-1)?.role, 'assistant', 'the reply persisted with nobody watching')
  assert.ok((msgs.at(-1)?.content ?? '').length > 0, 'with its full streamed content')
  assert.equal(turns.bySession(s.id), undefined, 'the registry entry is gone after completion')
})

test('cancel mid-turn: outcome=aborted, the partial persists, the stream ends (design §7)', async () => {
  const s = store.createSession('cancel keeps the partial')
  const before = store.generationOutcomes().aborted
  const sendP = callRaw('POST', `/sessions/${s.id}/messages`, { text: 'paced reply please' })
  const live = await waitForLiveTurn(s.id)

  const cancelled = await call('POST', `/sessions/${s.id}/turns/${live.id}/cancel`)
  assert.equal(cancelled.status, 200)

  const res = await sendP
  const evs = frames(res.body)
  assert.ok(evs.some((e) => e.type === 'message.end'), 'the cancelled stream still terminates with message.end')
  assert.equal(store.generationOutcomes().aborted, before + 1, 'an explicit cancel counts as aborted')
  const last = (store.getSession(s.id)?.messages ?? []).at(-1)
  assert.equal(last?.role, 'assistant', 'the partial assistant turn persisted')
  assert.equal(turns.bySession(s.id), undefined, 'the turn is gone after cancel')

  // Cancel of an unknown / finished turn → 404.
  const gone = await call('POST', `/sessions/${s.id}/turns/${live.id}/cancel`)
  assert.equal(gone.status, 404)
})

test('mid-turn: activeTurnId is projected on GET, a second send is refused 409, reattach replays with seq (I3/I4)', async () => {
  const s = store.createSession('reattach mid turn')
  const sendP = callRaw('POST', `/sessions/${s.id}/messages`, { text: 'paced reply please' })
  const live = await waitForLiveTurn(s.id)

  const got = await call('GET', `/sessions/${s.id}`)
  assert.equal(got.json.activeTurnId, live.id, 'a client arriving mid-turn sees the live turn')

  const second = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'me too' })
  assert.equal(second.status, 409, 'one live turn per session — a concurrent send is refused')

  // Reattach from the beginning: the replay carries message.start + the deltas
  // buffered so far, deltas stamped with their original seq.
  const re = await callRaw('GET', `/sessions/${s.id}/turns/${live.id}/stream?after=0`)
  assert.equal(re.status, 200)
  const replayed = frames(re.body)
  assert.ok(replayed.some((e) => e.type === 'message.start' && e.turnId === live.id), 'replay includes message.start')
  const seqs = replayed.filter((e) => e.type === 'message.delta').map((e) => e.seq as number)
  assert.ok(seqs.every((n, i) => i === 0 || n > seqs[i - 1]), 'replayed deltas keep their monotonic seq')

  // Reattach after the highest applied seq: replays nothing already applied.
  const topSeq = seqs.at(-1) ?? 0
  const tail = await callRaw('GET', `/sessions/${s.id}/turns/${live.id}/stream?after=${topSeq}`)
  const tailSeqs = frames(tail.body)
    .filter((e) => e.type === 'message.delta')
    .map((e) => e.seq as number)
  assert.ok(tailSeqs.every((n) => n > topSeq), 'a reattach after seq N never re-delivers ≤ N')

  await sendP // let the turn finish

  // The turn is gone: reattach 404s (the persisted message is the authority).
  const after = await callRaw('GET', `/sessions/${s.id}/turns/${live.id}/stream?after=0`)
  assert.equal(after.status, 404)
})

test('unknown / mismatched turn ids are 404 (a turn handle is only valid on its own session)', async () => {
  const s = store.createSession('turn id hygiene')
  const other = store.createSession('someone else’s turn')
  const sendP = callRaw('POST', `/sessions/${s.id}/messages`, { text: 'paced reply please' })
  const live = await waitForLiveTurn(s.id)
  // A real turn id addressed through a DIFFERENT session → 404 (no cross-session handles).
  const cross = await call('POST', `/sessions/${other.id}/turns/${live.id}/cancel`)
  assert.equal(cross.status, 404, 'a live turn cannot be cancelled through another session')
  const crossAttach = await callRaw('GET', `/sessions/${other.id}/turns/${live.id}/stream?after=0`)
  assert.equal(crossAttach.status, 404, 'a live turn cannot be attached through another session')
  // (The cross-TENANT wall on these routes is locked in tests/capability-remote.test.ts.)
  await call('POST', `/sessions/${s.id}/turns/${live.id}/cancel`) // stop the paced turn
  await sendP
})
