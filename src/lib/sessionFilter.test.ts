/** The Sessions "Date" grouping buckets by CALENDAR day, not fixed 24h windows —
 *  so a DST-transition day (23 or 25 wall-clock hours) can't misfile a session
 *  into the wrong band (yesterday-00:30 fell into "Previous 7 days" the day after
 *  fall-back under the old `startOfToday − N*24h` math). These lock the calendar
 *  boundaries in the ambient TZ; the fix computes them via local-midnight
 *  stepping, correct in every zone including across a transition. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterSessions,
  DEFAULT_SESSION_FILTER,
  saveSessionFilter,
  sessionFilterSnapshot,
  subscribeSessionFilter,
} from './sessionFilter.ts'
import type { Session } from '../types.ts'

/** Local midnight `n` calendar days before `now` (the boundary the buckets use). */
function startNDaysAgo(now: number, n: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d.getTime()
}

const sess = (id: string, updatedAt: number): Session => ({ id, title: id, updatedAt }) as Session

function bucketOf(updatedAt: number, now: number): string | undefined {
  const { groups } = filterSessions([sess('s', updatedAt)], { ...DEFAULT_SESSION_FILTER, groupBy: 'date' }, { now })
  return groups.find((g) => g.sessions.some((s) => s.id === 's'))?.label
}

test('date buckets follow calendar days (DST-safe boundaries)', () => {
  const now = new Date().setHours(12, 0, 0, 0) // local noon today — stable within a day
  // Today: local midnight this morning and later.
  assert.equal(bucketOf(startNDaysAgo(now, 0), now), 'Today')
  assert.equal(bucketOf(now, now), 'Today')
  // Yesterday: the whole prior calendar day, including its first half-hour — the
  // exact slot the fixed-24h math misfiled after a fall-back transition.
  assert.equal(bucketOf(startNDaysAgo(now, 1) + 30 * 60_000, now), 'Yesterday')
  assert.equal(bucketOf(startNDaysAgo(now, 1), now), 'Yesterday')
  // The week / month / older boundaries are the same calendar-day steps.
  assert.equal(bucketOf(startNDaysAgo(now, 6), now), 'Previous 7 days')
  assert.equal(bucketOf(startNDaysAgo(now, 8), now), 'Previous 30 days')
  assert.equal(bucketOf(startNDaysAgo(now, 40), now), 'Older')
})

test('the rail and main page subscribe to one live Sessions filter value', () => {
  let notifications = 0
  const unsubscribe = subscribeSessionFilter(() => notifications++)
  const next = { ...DEFAULT_SESSION_FILTER, groupBy: 'project' as const, sortBy: 'alpha' as const }

  saveSessionFilter(next)
  assert.deepEqual(sessionFilterSnapshot(), next)
  assert.equal(notifications, 1)

  unsubscribe()
  saveSessionFilter(DEFAULT_SESSION_FILTER)
  assert.equal(notifications, 1, 'an unmounted projection stops receiving updates')
})
