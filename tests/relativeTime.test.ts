import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relativeTime } from '../src/lib/relativeTime.ts'

// A fixed "now" so every bucket is deterministic regardless of when/where the
// suite runs. Mid-year and mid-day so the absolute-date branch can't straddle a
// month/year boundary under a different local timezone.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) // 2026-06-15T12:00:00Z
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms: number) => relativeTime(NOW - ms, NOW)

test('sub-minute reads as "just now"', () => {
  assert.equal(ago(0), 'just now')
  assert.equal(ago(30 * SEC), 'just now')
  assert.equal(ago(44 * SEC), 'just now')
})

test('minutes pluralize and round', () => {
  assert.equal(ago(60 * SEC), '1 minute ago')
  assert.equal(ago(5 * MIN), '5 minutes ago')
  assert.equal(ago(44 * MIN), '44 minutes ago')
})

test('the 45–90 minute band coarsens to "1 hour ago" (never "60 minutes ago")', () => {
  assert.equal(ago(46 * MIN), '1 hour ago')
  assert.equal(ago(60 * MIN), '1 hour ago')
  assert.equal(ago(89 * MIN), '1 hour ago')
})

test('hours read as N hours (never "24 hours ago" — it rolls to yesterday)', () => {
  assert.equal(ago(2 * HOUR), '2 hours ago')
  assert.equal(ago(4 * HOUR), '4 hours ago')
  assert.equal(ago(21 * HOUR), '21 hours ago')
})

test('the day boundary: ~1 day is "yesterday", then N days', () => {
  assert.equal(ago(28 * HOUR), 'yesterday')
  assert.equal(ago(35 * HOUR), 'yesterday')
  assert.equal(ago(2 * DAY), '2 days ago')
  assert.equal(ago(6 * DAY), '6 days ago')
})

test('a week or older falls back to an absolute date (MMM D), same-year drops the year', () => {
  const wk = ago(10 * DAY)
  assert.match(wk, /^[A-Z][a-z]{2} \d{1,2}$/, 'a "Jun 5"-style label, no year in the same year')
})

test('a different calendar year includes the year', () => {
  const label = relativeTime(Date.UTC(2024, 2, 9, 12, 0, 0), NOW)
  assert.match(label, /^[A-Z][a-z]{2} \d{1,2}, 2024$/)
})

test('a future timestamp (clock skew / optimistic stamp) reads as "just now", not a negative age', () => {
  assert.equal(relativeTime(NOW + 5 * MIN, NOW), 'just now')
})

test('the default "now" argument resolves to the real clock (smoke: a recent stamp is "just now")', () => {
  assert.equal(relativeTime(Date.now() - 1000), 'just now')
})

test('a missing / non-finite stamp falls back to "recently" (legacy records, never "undefined NaN")', () => {
  assert.equal(relativeTime(NaN, NOW), 'recently')
  assert.equal(relativeTime(undefined as unknown as number, NOW), 'recently')
})
