/** The turn registry (server/turns.ts) — generation turns as server-owned
 *  resources (docs/design/multi-account-ui.md §5.1, invariants I1/I4). Locks the
 *  lifecycle (start → append → finish), the one-live-turn-per-session rule, the
 *  replay/live-tail attach semantics, and the buffer cap's eviction behavior. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TurnRegistry, type TurnFrame } from './turns.ts'
import type { ReplyStreamEvent } from '../contract/index.ts'

const start = (id = 'm1'): ReplyStreamEvent => ({
  type: 'message.start',
  sessionId: 's1',
  message: { id, role: 'assistant', content: '' },
})
const delta = (text: string): ReplyStreamEvent => ({
  type: 'message.delta',
  sessionId: 's1',
  messageId: 'm1',
  text,
})
const end = (): ReplyStreamEvent => ({
  type: 'message.end',
  sessionId: 's1',
  message: { id: 'm1', role: 'assistant', content: 'done' },
})

test('lifecycle: start → append (monotonic seq) → finish clears both indexes', () => {
  const reg = new TurnRegistry()
  const turn = reg.start('s1', () => {})
  assert.ok(turn, 'a fresh session registers a turn')
  assert.equal(reg.bySession('s1')?.id, turn.id)
  assert.equal(reg.get(turn.id)?.sessionId, 's1')

  assert.equal(reg.append(turn.id, start()), 1, 'first frame is seq 1')
  assert.equal(reg.append(turn.id, delta('a')), 2)
  assert.equal(reg.append(turn.id, delta('b')), 3)
  assert.equal(reg.get(turn.id)?.seq, 3, 'the turn tracks the highest seq')
  assert.equal(reg.get(turn.id)?.messageId, 'm1', 'message.start binds the messageId')

  reg.finish(turn.id)
  assert.equal(reg.bySession('s1'), undefined, 'finish clears the session index')
  assert.equal(reg.get(turn.id), undefined, 'finish clears the turn index')
  assert.equal(reg.append(turn.id, delta('late')), undefined, 'no appends after finish')
  reg.finish(turn.id) // idempotent
})

test('one live turn per session: a second start is refused until finish', () => {
  const reg = new TurnRegistry()
  const first = reg.start('s1', () => {})
  assert.ok(first)
  assert.equal(reg.start('s1', () => {}), undefined, 'concurrent second turn refused')
  assert.ok(reg.start('s2', () => {}), 'a different session is unaffected')
  reg.finish(first.id)
  assert.ok(reg.start('s1', () => {}), 'after finish the session can start a new turn')
})

test('attach: replays frames after `after`, then feeds the live tail, then null on finish', () => {
  const reg = new TurnRegistry()
  const turn = reg.start('s1', () => {})!
  reg.append(turn.id, start()) // seq 1
  reg.append(turn.id, delta('a')) // seq 2
  reg.append(turn.id, delta('b')) // seq 3

  const seen: Array<TurnFrame | null> = []
  const att = reg.attach(turn.id, 1, (f) => seen.push(f))
  assert.ok(att)
  assert.deepEqual(
    att.replay.map((f) => f.seq),
    [2, 3],
    'replay skips frames at or before `after`',
  )
  assert.equal(att.truncated, false)

  reg.append(turn.id, delta('c')) // live tail
  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.seq, 4)

  reg.finish(turn.id)
  assert.equal(seen[1], null, 'finish notifies subscribers with null')

  assert.equal(reg.attach(turn.id, 0, () => {}), undefined, 'attach after finish → undefined (client refetches)')
})

test('unsubscribe stops the live tail', () => {
  const reg = new TurnRegistry()
  const turn = reg.start('s1', () => {})!
  const seen: Array<TurnFrame | null> = []
  const att = reg.attach(turn.id, 0, (f) => seen.push(f))!
  reg.append(turn.id, delta('a'))
  att.unsubscribe()
  reg.append(turn.id, delta('b'))
  reg.finish(turn.id)
  assert.equal(seen.length, 1, 'frames after unsubscribe (and the finish null) are not delivered')
})

test('cancel trips the hook exactly for live turns', () => {
  const reg = new TurnRegistry()
  let tripped = 0
  const turn = reg.start('s1', () => {
    tripped += 1
  })!
  assert.equal(reg.cancel('turn-nope'), false)
  assert.equal(reg.cancel(turn.id), true)
  assert.equal(tripped, 1)
  assert.ok(reg.get(turn.id), 'cancel does not finish the entry — the send route does, after persisting the partial')
  reg.finish(turn.id)
  assert.equal(reg.cancel(turn.id), false, 'a finished turn cannot be cancelled')
})

test('buffer cap: old delta frames evict (truncated replay), structural frames survive', () => {
  const reg = new TurnRegistry()
  const turn = reg.start('s1', () => {})!
  reg.append(turn.id, start()) // structural — must survive eviction
  const big = 'x'.repeat(64 * 1024)
  for (let i = 0; i < 6; i += 1) reg.append(turn.id, delta(big)) // 384 KB > 256 KB cap
  const att = reg.attach(turn.id, 0, () => {})!
  assert.equal(att.truncated, true, 'a replay reaching past the eviction point reports truncation')
  const types = att.replay.map((f) => f.event.type)
  assert.ok(types.includes('message.start'), 'structural frames are never evicted')
  const deltaBytes = att.replay.reduce((n, f) => n + (f.event.type === 'message.delta' ? f.event.text.length : 0), 0)
  assert.ok(deltaBytes <= 256 * 1024, 'buffered delta bytes respect the cap')
  // Attaching from the live edge is complete — no truncation reported.
  const live = reg.attach(turn.id, reg.get(turn.id)!.seq, () => {})!
  assert.equal(live.truncated, false, 'attaching at the live edge is never truncated')
})
