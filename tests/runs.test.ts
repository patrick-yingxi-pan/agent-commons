import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recentEntries } from '../contract/runs.ts'
import type { ScheduledRun, ScheduledTask } from '../contract/cowork.ts'

/** Run history times moved to absolute epoch-ms `at` (a v3 store change). The
 *  cross-routine "recent runs" feed must therefore order by LARGER = more recent
 *  (the old `at` was minutes-ago, where smaller was newer). This pins the flipped
 *  sort so a regression can't silently reverse the rail. */

const run = (id: string, at: number): ScheduledRun => ({
  id,
  status: 'ok',
  duration: '1s',
  reachedStep: 0,
  summary: id,
  at,
})

const task = (id: string, runs: ScheduledRun[]): ScheduledTask => ({
  id,
  name: id,
  cadence: 'x',
  next: 'x',
  enabled: true,
  lastStatus: 'ok',
  subtitle: 'x',
  trigger: 'x',
  prompt: 'x',
  steps: [],
  delivery: { tool: { id: 't', label: 'T', tone: 'claude' }, target: 'out' },
  runs,
  model: 'x',
})

test('recentEntries orders runs newest-first by absolute timestamp (larger epoch-ms = more recent)', () => {
  const older = task('a', [run('a1', 1_000)])
  const newer = task('b', [run('b1', 9_000)])
  const entries = recentEntries([older, newer])
  assert.equal(entries[0].run.id, 'b1', 'the larger epoch-ms run comes first')
  assert.equal(entries[1].run.id, 'a1', 'the older run trails it')
})

test('recentEntries skips disabled routines and caps each routine at its two latest runs', () => {
  const on = task('on', [run('r1', 5_000), run('r2', 4_000), run('r3', 3_000)])
  const off = { ...task('off', [run('x', 9_999)]), enabled: false }
  const entries = recentEntries([on, off])
  assert.deepEqual(
    entries.map((e) => e.run.id),
    ['r1', 'r2'],
    'only the enabled routine contributes, and only its two most-recent runs',
  )
})
