/** No overlapping scheduled runs (design P7) — the daemon can tick again before a run
 *  finishes, so runSchedule must not start a second run while one is in flight; it
 *  returns the in-flight run instead. Store-level (the daemon calls this same path). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

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
