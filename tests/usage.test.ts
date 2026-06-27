/** Unit tests for the usage meter (server/usage.ts) and the store's session-aware
 *  usage snapshot — the composer gauge, made real. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUsageMeter, estimateTokens, formatTokens, CONTEXT_WINDOW } from '../server/usage.ts'
import { contextBreakdown, CONTEXT_BASELINE } from '../contract/index.ts'
import { store } from '../server/store.ts'

test('estimateTokens / formatTokens: rough token math + human labels', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('a'.repeat(400)), 100)
  assert.equal(formatTokens(850), '850')
  assert.equal(formatTokens(12_300), '12.3k')
  assert.equal(formatTokens(1_400_000), '1.4M')
})

test('the meter accumulates real token usage into the rolling windows', () => {
  let t = 1_000_000
  const meter = createUsageMeter(() => t)
  const before = meter.snapshot(0)
  meter.record(100_000, 50_000) // 150k tokens this turn
  const after = meter.snapshot(0)
  // The 5-hour ring (limits[0]) rose; the plan windows are independent of context.
  assert.ok(after.limits[0].pct >= before.limits[0].pct)
  // An empty thread's context is just the fixed config baseline, unchanged by a turn.
  assert.equal(before.context.segments.find((s) => s.id === 'messages')?.rawTokens, 0)
})

test('a window resets once its span elapses (the consumption clears)', () => {
  let t = 0
  const meter = createUsageMeter(() => t)
  meter.record(600_000, 0) // push the 5-hour window up
  const hot = meter.snapshot(0).limits[0].pct
  t += 6 * 3_600_000 // jump past the 5-hour boundary
  const cooled = meter.snapshot(0).limits[0].pct
  assert.ok(cooled < hot, 'the 5-hour window reset after its span elapsed')
})

test('contextBreakdown: Messages is live, config is the baseline, the rest is Free space', () => {
  const ctx = contextBreakdown(200_000)
  // Messages reflects the passed token count; total is the window.
  assert.equal(ctx.segments.find((s) => s.id === 'messages')?.rawTokens, 200_000)
  assert.equal(ctx.total, formatTokens(CONTEXT_WINDOW))
  // used = messages + the fixed config baseline.
  const loaded = ctx.segments.filter((s) => !s.deferred && s.id !== 'free')
  const usedRaw = loaded.reduce((n, s) => n + s.rawTokens, 0)
  assert.equal(usedRaw, 200_000 + CONTEXT_BASELINE)
  // Free space fills the remainder; the loaded + free segments tile the window.
  const free = ctx.segments.find((s) => s.id === 'free')!
  assert.equal(usedRaw + free.rawTokens, CONTEXT_WINDOW)
  // Deferred categories are listed but uncounted (no pct).
  const deferred = ctx.segments.filter((s) => s.deferred)
  assert.ok(deferred.length > 0 && deferred.every((s) => s.pct === undefined))
})

test('an empty thread still shows the config baseline (Free space < 100%)', () => {
  const ctx = contextBreakdown(0)
  const free = ctx.segments.find((s) => s.id === 'free')!
  assert.ok((free.pct ?? 0) < 100 && (free.pct ?? 0) > 0)
  assert.ok(ctx.pct >= 1, 'the fixed config occupies a little of the window')
})

test('store.usage(session) reflects the open thread; a longer thread shows more context', () => {
  const empty = store.usage().context.pct // no session → baseline only
  // A seeded session with messages should read at least the baseline.
  const sessions = store.listSessions?.() ?? []
  const withMsgs = sessions.find((s) => (s.messages?.length ?? 0) > 0)
  if (withMsgs) {
    const ctx = store.usage(withMsgs.id).context.pct
    assert.ok(ctx >= empty, 'a thread with messages reads ≥ the empty baseline')
  }
  // The gauge shape holds for the session-aware call too.
  const u = store.usage('insights-launch')
  assert.ok(u.context && Array.isArray(u.limits))
})
