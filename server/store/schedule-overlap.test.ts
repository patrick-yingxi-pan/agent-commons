/** No overlapping scheduled runs (design P7) — the daemon can tick again before a run
 *  finishes, so runSchedule must not start a second run while one is in flight; it
 *  returns the in-flight run instead. Store-level (the daemon calls this same path). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'

test('runSchedule returns the in-flight run instead of starting an overlapping one', () => {
  const task = store.listSchedules().find((t) => t.enabled) ?? store.listSchedules()[0]
  assert.ok(task, 'a seed schedule exists')

  const first = store.runSchedule(task.id)
  assert.ok(first)
  assert.equal(first.status, 'running')

  const second = store.runSchedule(task.id)
  assert.equal(second?.id, first.id, 'the same in-flight run is returned, not a fresh one')

  const running = (store.listSchedules().find((t) => t.id === task.id)?.runs ?? []).filter(
    (r) => r.status === 'running',
  )
  assert.equal(running.length, 1, 'exactly one run is in flight for the routine')
})

test('one scheduled fire time is represented by exactly one run', () => {
  const task = store.listSchedules().find((candidate) => !candidate.runs.some((run) => run.status === 'running'))
  assert.ok(task)
  const scheduledFor = Date.now() + 123_456
  const first = store.runSchedule(task.id, { scheduledFor, startedAt: scheduledFor + 500 })
  const replay = store.runSchedule(task.id, { scheduledFor, startedAt: scheduledFor + 1_000 })
  assert.ok(first)
  assert.equal(replay?.id, first.id)
  assert.equal(first.scheduledFor, scheduledFor)
  assert.equal(task.runs.filter((run) => run.scheduledFor === scheduledFor).length, 1)
})

test('one skipped fire time is represented by exactly one visible run', () => {
  const task = store.listSchedules()[0]
  assert.ok(task)
  const scheduledFor = Date.now() - 123_456
  const first = store.recordSkippedScheduleFire(task.id, scheduledFor)
  const replay = store.recordSkippedScheduleFire(task.id, scheduledFor)
  assert.ok(first)
  assert.equal(replay?.id, first.id)
  assert.equal(task.runs.filter((run) => run.scheduledFor === scheduledFor).length, 1)
})
