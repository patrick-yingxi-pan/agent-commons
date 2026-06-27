/** Unit tests for the effect journal (server/journal.ts) — the system of record
 *  (D2): idempotency, per-runner monotonic ordering, the projection cursor +
 *  reconcile, and the outbox merge. emit is captured so projection events are
 *  asserted deterministically. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunnerJournal } from '../server/journal.ts'
import type { ServerEvent } from '../contract/index.ts'

function harness() {
  const events: ServerEvent[] = []
  let clock = 5000
  const journal = new RunnerJournal(
    (e) => events.push(e),
    () => clock,
  )
  return { events, journal, tick: (n = 1) => (clock += n) }
}

const eff = (commandId: string, target = '~/p/x') => ({
  commandId,
  capability: 'fs.read' as const,
  target,
  output: { ok: true },
})

test('append assigns a monotonic per-runner runnerSeq and stamps the clock', () => {
  const { journal } = harness()
  const a = journal.append('h1', eff('c1'))
  const b = journal.append('h1', eff('c2'))
  assert.equal(a.effect.runnerSeq, 1)
  assert.equal(b.effect.runnerSeq, 2)
  assert.equal(a.effect.at, 5000)
  assert.equal(a.deduped, false)
})

test('append is idempotent by commandId — a retry returns the recorded effect', () => {
  const { journal } = harness()
  const first = journal.append('h1', eff('c1', '~/p/a'))
  const retry = journal.append('h1', eff('c1', '~/p/DIFFERENT'))
  assert.equal(retry.deduped, true)
  assert.equal(retry.effect.runnerSeq, first.effect.runnerSeq) // no new seq
  assert.equal(retry.effect.target, '~/p/a') // original wins
  assert.equal(journal.log('h1').length, 1) // not duplicated
})

test('per-runner sequences are independent', () => {
  const { journal } = harness()
  journal.append('h1', eff('a'))
  journal.append('h2', eff('b'))
  journal.append('h1', eff('c'))
  assert.deepEqual(
    journal.log('h1').map((e) => e.runnerSeq),
    [1, 2],
  )
  assert.deepEqual(
    journal.log('h2').map((e) => e.runnerSeq),
    [1],
  )
})

test('projection: appended effects are pending until reconcile advances the cursor', () => {
  const { journal, events } = harness()
  journal.append('h1', eff('c1'))
  journal.append('h1', eff('c2'))
  assert.equal(journal.cursor('h1'), 0)
  assert.equal(journal.pending('h1').length, 2)
  assert.equal(events.length, 0) // nothing emitted until projected

  const projected = journal.reconcile('h1')
  assert.equal(projected.length, 2)
  assert.equal(journal.cursor('h1'), 2)
  assert.equal(journal.pending('h1').length, 0)
  assert.deepEqual(
    events.map((e) => e.type),
    ['runner.effect', 'runner.effect'],
  )

  assert.deepEqual(journal.reconcile('h1'), []) // nothing new to project
})

test('log(since) returns only the tail after a sequence number (read-through)', () => {
  const { journal } = harness()
  journal.append('h1', eff('c1'))
  journal.append('h1', eff('c2'))
  journal.append('h1', eff('c3'))
  assert.deepEqual(
    journal.log('h1', 1).map((e) => e.commandId),
    ['c2', 'c3'],
  )
})

test('merge replays an outbox idempotently — already-recorded effects are skipped', () => {
  const { journal } = harness()
  // c1 arrived via the relay path and was projected.
  journal.append('h1', eff('c1'))
  journal.reconcile('h1')

  // The runner replays its outbox: c1 again (dup) + c2 (new, from a fast path).
  const added = journal.merge('h1', [eff('c1'), eff('c2')])
  assert.deepEqual(
    added.map((e) => e.commandId),
    ['c2'],
  ) // only c2 is new
  assert.equal(journal.log('h1').length, 2) // c1 not duplicated

  const projected = journal.reconcile('h1')
  assert.deepEqual(
    projected.map((e) => e.commandId),
    ['c2'],
  )
})

test('merge preserves an effect-reported timestamp when provided', () => {
  const { journal } = harness()
  journal.merge('h1', [{ ...eff('c1'), at: 1234 }])
  assert.equal(journal.log('h1')[0].at, 1234)
})
