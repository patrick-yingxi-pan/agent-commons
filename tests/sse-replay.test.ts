/** The resumable ambient stream (multi-account design §5.3, invariants I3/I4):
 *  every ambient event carries a global seq as the SSE `id:` field; a reconnect
 *  presenting `Last-Event-ID` gets the missed tail REPLAYED (tenant-filtered with
 *  the same gate as the live fan-out), and an aged-out gap yields
 *  `hello.resumed: false` → the client fully resyncs. Locks the EventLog ring
 *  buffer, the `/events` route's replay wiring, and the client reset rule. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventLog } from '../server/eventlog.ts'
import { eventlog } from '../server/eventlog.ts'
import { store } from '../server/store.ts'
import { buildRouter } from '../server/routes/index.ts'
import { helloRequiresReset } from '../src/api/streamPolicy.ts'
import type { ServerEvent } from '../contract/index.ts'

const progress = (n: number): ServerEvent => ({
  type: 'run.progress',
  taskId: 'task-seq',
  runId: `run-${n}`,
  reachedStep: n,
  status: 'running',
})

// ── EventLog unit ─────────────────────────────────────────────────────────────

test('EventLog: monotonic seq, ring eviction, and the complete/aged-out boundary', () => {
  const log = new EventLog(3)
  assert.equal(log.seq(), 0)
  assert.deepEqual(log.since(0), { events: [], complete: true }, 'an empty log is trivially complete')

  for (let i = 1; i <= 5; i += 1) assert.equal(log.record(progress(i)), i, 'record returns the stamped seq')
  assert.equal(log.seq(), 5)

  // Capacity 3 → seqs 1–2 evicted; the buffer holds 3..5.
  const fromLiveEdge = log.since(5)
  assert.deepEqual(fromLiveEdge, { events: [], complete: true }, 'nothing missed at the live edge')

  const withinWindow = log.since(2)
  assert.equal(withinWindow.complete, true, 'a gap starting at the oldest buffered frame is complete')
  assert.deepEqual(withinWindow.events.map((f) => f.seq), [3, 4, 5])

  const agedOut = log.since(1)
  assert.equal(agedOut.complete, false, 'a gap reaching past the eviction point is NOT complete')

  const futureSeq = log.since(9)
  assert.equal(futureSeq.complete, true, 'a client claiming a future seq has nothing to replay (restart handled by epoch)')
  assert.deepEqual(futureSeq.events, [])
})

// ── The /events route: id stamping + Last-Event-ID replay ────────────────────

/** Open the SSE stream at the handler level and keep it open — `text()` reads
 *  everything written so far (frames keep landing after handle() resolves). */
async function openStream(headers: Record<string, string> = {}) {
  const router = buildRouter()
  let body = ''
  const res: any = {
    writeHead: () => res,
    setHeader: () => {},
    write: (c: string) => {
      body += c
      return true
    },
    end: () => {},
    flushHeaders: () => {},
    on: () => {},
    get writableEnded() {
      return false
    },
  }
  const req: any = { method: 'GET', headers, on: () => req }
  await router.handle(req, res, new URL('http://test/events'))
  return { text: () => body }
}

/** Parse SSE frames into { id?, event } pairs. */
function parse(body: string): Array<{ id?: number; event: any }> {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((f) => {
      const lines = f.split('\n')
      const id = lines.find((l) => l.startsWith('id:'))
      const data = lines.find((l) => l.startsWith('data:'))
      return { id: id ? Number(id.slice(3).trim()) : undefined, event: data ? JSON.parse(data.slice(5).trim()) : undefined }
    })
    .filter((f) => f.event)
}

test('live events are stamped with their global seq as the SSE id; hello carries the stream position', async () => {
  const s = await openStream()
  const hello = parse(s.text())[0]
  assert.equal(hello.event.type, 'hello')
  assert.equal(hello.event.resumed, false, 'a fresh subscribe (no Last-Event-ID) is not a resume')
  assert.equal(hello.event.seq, eventlog.seq(), 'hello reports the current stream position')
  assert.equal(hello.id, undefined, 'hello is synthetic — it must not disturb Last-Event-ID tracking')

  store.emit(progress(1))
  store.emit(progress(2))
  const frames = parse(s.text()).slice(1)
  assert.equal(frames.length, 2)
  assert.ok(frames.every((f) => typeof f.id === 'number'), 'every logged event carries an id')
  assert.ok(frames[1].id! > frames[0].id!, 'ids are monotonic')
})

test('a reconnect inside the window replays exactly the missed tail (resumed: true)', async () => {
  const s1 = await openStream()
  store.emit(progress(10))
  const seen = parse(s1.text()).filter((f) => f.id !== undefined)
  const lastSeen = seen.at(-1)!.id!

  // Events emitted "while disconnected".
  store.emit(progress(11))
  store.emit(progress(12))

  const s2 = await openStream({ 'last-event-id': String(lastSeen) })
  const frames = parse(s2.text())
  assert.equal(frames[0].event.type, 'hello')
  assert.equal(frames[0].event.resumed, true, 'the gap was inside the buffer — resumed')
  const replayed = frames.slice(1)
  assert.deepEqual(
    replayed.map((f) => f.id),
    [lastSeen + 1, lastSeen + 2],
    'exactly the missed tail is replayed, with its original ids',
  )
  assert.deepEqual(
    replayed.map((f) => f.event.runId),
    ['run-11', 'run-12'],
  )
})

test('replay is tenant-filtered with the same gate as the live fan-out (no widening on reconnect)', async () => {
  const before = eventlog.seq()
  // createSession broadcasts session.updated for tenant-zeta — invisible to the
  // default local subscriber, live OR replayed.
  store.createSession('zeta secret thread', 'tenant-zeta')
  store.emit(progress(20))

  const s = await openStream({ 'last-event-id': String(before) })
  const frames = parse(s.text())
  assert.equal(frames[0].event.resumed, true)
  const replayed = frames.slice(1)
  assert.ok(replayed.some((f) => f.event.type === 'run.progress' && f.event.runId === 'run-20'), 'the global event replays')
  assert.ok(
    !replayed.some((f) => f.event.type === 'session.updated' && f.event.session?.tenantId === 'tenant-zeta'),
    'the foreign tenant’s session push is filtered out of the replay',
  )
})

test('an aged-out gap yields resumed: false and NO partial replay (full resync instead)', async () => {
  const stale = eventlog.seq()
  // Push the ring buffer (capacity 512) past the stale cursor.
  for (let i = 0; i < 520; i += 1) store.emit(progress(100 + i))

  const s = await openStream({ 'last-event-id': String(stale) })
  const frames = parse(s.text())
  assert.equal(frames[0].event.type, 'hello')
  assert.equal(frames[0].event.resumed, false, 'the gap aged out — the client must resync')
  assert.equal(frames.length, 1, 'no partial replay: a half-replayed gap would masquerade as complete')
})

// ── The client reset rule (pure policy, applied by src/api/events.ts) ─────────

test('helloRequiresReset: reset exactly when continuity is broken', () => {
  assert.equal(helloRequiresReset({ epoch: 'e1', resumed: false }, null), false, 'first hello: nothing to reset')
  assert.equal(helloRequiresReset({ epoch: 'e2', resumed: true }, 'e1'), true, 'epoch changed: reset even if "resumed"')
  assert.equal(helloRequiresReset({ epoch: 'e1', resumed: true }, 'e1'), false, 'same epoch + replayed gap: continuous')
  assert.equal(helloRequiresReset({ epoch: 'e1', resumed: false }, 'e1'), true, 'same epoch, gap not replayed: reset')
  assert.equal(helloRequiresReset({ epoch: 'e1' }, 'e1'), true, 'a server without the event log: conservative reset')
})
