import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ROUTINE_FILTER,
  filterRoutines,
  loadRoutineFilter,
  routineFilterSnapshot,
  saveRoutineFilter,
  type RoutineFilterContext,
} from './routineFilter.ts'
import type { ScheduledRun, ScheduledTask } from '../../contract/cowork.ts'
import { setLayout, setUiPrefScope } from './uiPrefs.ts'

/** A routine's recency is its freshest run's `at`, which moved to absolute
 *  epoch-ms (larger = newer). The recency sort must therefore be descending —
 *  this pins it so the minutes-ago-era ascending sort (oldest-first) can't creep
 *  back. routineFilter.ts had no coverage; a missed `at`-consumer regressed here. */

const run = (id: string, at: number): ScheduledRun => ({
  id,
  status: 'ok',
  duration: '1s',
  reachedStep: 0,
  summary: id,
  at,
})

const task = (id: string, name: string, enabled: boolean, runs: ScheduledRun[]): ScheduledTask => ({
  id,
  name,
  cadence: 'x',
  next: 'x',
  enabled,
  lastStatus: 'ok',
  subtitle: 'x',
  trigger: 'x',
  prompt: 'x',
  steps: [],
  delivery: { tool: { id: 't', label: 'T', tone: 'claude' }, target: 'o' },
  runs,
  model: 'x',
})

const ctx: RoutineFilterContext = { projectIdOfTask: () => null, projectName: () => '' }
const ids = (r: ReturnType<typeof filterRoutines>) => r.groups.flatMap((g) => g.tasks.map((t) => t.id))

test('recency sort puts the freshest-run routine first (epoch-ms `at`, larger = newer)', () => {
  const stale = task('a', 'A', true, [run('a1', 1_000)])
  const fresh = task('b', 'B', true, [run('b1', 9_000)])
  assert.deepEqual(ids(filterRoutines([stale, fresh], DEFAULT_ROUTINE_FILTER, ctx)), ['b', 'a'])
})

test('a never-run routine sorts last under recency (not first)', () => {
  const ran = task('r', 'R', true, [run('r1', 5_000)])
  const never = task('n', 'N', true, [])
  assert.deepEqual(ids(filterRoutines([never, ran], DEFAULT_ROUTINE_FILTER, ctx)), ['r', 'n'])
})

test('alpha sort orders by name; the status filter narrows to active / paused', () => {
  const on = task('on', 'Beta', true, [])
  const off = task('off', 'Alpha', false, [])
  assert.deepEqual(
    ids(filterRoutines([on, off], { ...DEFAULT_ROUTINE_FILTER, groupBy: 'none', sortBy: 'alpha' }, ctx)),
    ['off', 'on'],
  )
  const active = filterRoutines([on, off], { ...DEFAULT_ROUTINE_FILTER, status: 'active' }, ctx)
  assert.deepEqual(ids(active), ['on'])
  assert.equal(active.total, 1)
})

test('the default keeps mutable status out of the resource hierarchy', () => {
  const on = task('on', 'On', true, [])
  const off = task('off', 'Off', false, [])
  const groups = filterRoutines([off, on], DEFAULT_ROUTINE_FILTER, ctx).groups
  assert.equal(DEFAULT_ROUTINE_FILTER.groupBy, 'none')
  assert.deepEqual(groups.map((group) => group.label), [''])
  assert.deepEqual(groups.flatMap((group) => group.tasks.map((item) => item.id)), ['off', 'on'])
})

test('status bands remain available when a person deliberately groups by status', () => {
  const on = task('on', 'On', true, [])
  const off = task('off', 'Off', false, [])
  const groups = filterRoutines([off, on], { ...DEFAULT_ROUTINE_FILTER, groupBy: 'status' }, ctx).groups
  assert.deepEqual(groups.map((group) => group.label), ['Active', 'Paused'])
})

beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
  setLayout('__routine_filter_reset__', 0)
})

test('v3 preferences keep real filters while retiring the former default status bands', () => {
  setUiPrefScope('migration')
  setLayout(
    'scheduledFilter.v3',
    JSON.stringify({ status: 'paused', projectId: 'p-1', groupBy: 'status', sortBy: 'alpha' }),
  )
  assert.deepEqual(loadRoutineFilter(), {
    status: 'paused',
    projectId: 'p-1',
    groupBy: 'none',
    sortBy: 'alpha',
  })
})

test('the Routines filter is stable, live, and scoped per account', () => {
  setUiPrefScope('ada')
  const initial = routineFilterSnapshot()
  assert.equal(routineFilterSnapshot(), initial, 'useSyncExternalStore receives a stable snapshot')
  saveRoutineFilter({ ...DEFAULT_ROUTINE_FILTER, status: 'paused' })
  assert.equal(routineFilterSnapshot().status, 'paused', 'a tree-row write reaches the next page read')

  setUiPrefScope('grace')
  assert.deepEqual(routineFilterSnapshot(), DEFAULT_ROUTINE_FILTER, 'Grace never inherits Ada’s routine filter')
  setUiPrefScope('ada')
  assert.equal(routineFilterSnapshot().status, 'paused', 'switching back restores Ada’s choice')
})
