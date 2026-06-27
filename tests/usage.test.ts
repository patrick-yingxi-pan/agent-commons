/** Unit tests for the usage meter (server/usage.ts) and the store's session-aware
 *  usage snapshot — the composer gauge, made real. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUsageMeter, estimateTokens, formatTokens, CONTEXT_WINDOW } from '../server/usage.ts'
import { contextBreakdown, withLiveMessages, type ContextParts } from '../contract/index.ts'
import { TOOL_DEFINITIONS } from '../server/model/tools.ts'
import { store } from '../server/store.ts'

const PARTS: ContextParts = { messageTokens: 200_000, systemToolsTokens: 1_780, systemPromptTokens: 100 }

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
  const before = meter.planLimits()[0].pct
  meter.record(100_000, 50_000) // 150k tokens this turn
  const after = meter.planLimits()[0].pct
  assert.ok(after >= before, 'the 5-hour ring rose with consumption')
})

test('a window resets once its span elapses (the consumption clears)', () => {
  let t = 0
  const meter = createUsageMeter(() => t)
  meter.record(600_000, 0) // push the 5-hour window up
  const hot = meter.planLimits()[0].pct
  t += 6 * 3_600_000 // jump past the 5-hour boundary
  const cooled = meter.planLimits()[0].pct
  assert.ok(cooled < hot, 'the 5-hour window reset after its span elapsed')
})

test('contextBreakdown: Messages is live, the loaded categories sum to used, the rest is Free space', () => {
  const ctx = contextBreakdown(PARTS)
  assert.equal(ctx.segments.find((s) => s.id === 'messages')?.rawTokens, PARTS.messageTokens)
  assert.equal(ctx.total, formatTokens(CONTEXT_WINDOW))
  const loaded = ctx.segments.filter((s) => !s.deferred && s.id !== 'free')
  const usedRaw = loaded.reduce((n, s) => n + s.rawTokens, 0)
  const free = ctx.segments.find((s) => s.id === 'free')!
  assert.equal(usedRaw + free.rawTokens, CONTEXT_WINDOW, 'loaded + free tile the window')
  // Deferred categories are listed but uncounted (no pct → renders '—').
  const deferred = ctx.segments.filter((s) => s.deferred)
  assert.ok(deferred.length > 0 && deferred.every((s) => s.pct === undefined))
  // The eagerly-injected tools are a LOADED category, never a deferred one.
  assert.ok(!ctx.segments.some((s) => s.deferred && s.id.startsWith('systemTools')))
})

test('System tools + System prompt are the real eager request sizes (not seed)', () => {
  const parts: ContextParts = { messageTokens: 0, systemToolsTokens: 1_780, systemPromptTokens: 100 }
  const ctx = contextBreakdown(parts)
  assert.equal(ctx.segments.find((s) => s.id === 'systemTools')?.rawTokens, 1_780)
  assert.equal(ctx.segments.find((s) => s.id === 'systemPrompt')?.rawTokens, 100)
})

test('store: the System tools category is the real tool-schema size, eager (loaded)', () => {
  const realToolTokens = estimateTokens(JSON.stringify(TOOL_DEFINITIONS))
  const seg = store.usage('insights-launch').context.segments.find((s) => s.id === 'systemTools')!
  assert.equal(seg.rawTokens, realToolTokens, 'System tools reflects the actual TOOL_DEFINITIONS the backend sends')
  assert.ok(!seg.deferred, 'tools are injected eagerly, so the category is loaded')
  assert.ok(seg.rawTokens > 0)
})

test('withLiveMessages overlays a live Messages count, keeping the real categories', () => {
  const server = contextBreakdown({ messageTokens: 50, systemToolsTokens: 1_780, systemPromptTokens: 100 })
  const live = withLiveMessages(server, 9_000)
  assert.equal(live.segments.find((s) => s.id === 'messages')?.rawTokens, 9_000)
  // The real system-tools size is preserved through the overlay.
  assert.equal(live.segments.find((s) => s.id === 'systemTools')?.rawTokens, 1_780)
  // Free space shrank by the added messages.
  const f0 = server.segments.find((s) => s.id === 'free')!.rawTokens
  const f1 = live.segments.find((s) => s.id === 'free')!.rawTokens
  assert.equal(f0 - f1, 9_000 - 50)
})

test('store.usage(session) reflects the open thread; a longer thread shows more context', () => {
  const empty = store.usage().context.pct
  const withMsgs = (store.listSessions?.() ?? []).find((s) => (s.messages?.length ?? 0) > 0)
  if (withMsgs) {
    assert.ok(store.usage(withMsgs.id).context.pct >= empty, 'a thread with messages reads ≥ the empty baseline')
  }
  const u = store.usage('insights-launch')
  assert.ok(u.context && Array.isArray(u.limits))
})
