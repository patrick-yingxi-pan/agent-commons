/** Unit tests for the usage meter (server/usage.ts) and the store's session-aware
 *  usage snapshot — the composer gauge, made real. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUsageMeter, estimateTokens, formatTokens, CONTEXT_WINDOW, MAX_USAGE_STATE_START, parseUsageMeterState, UsageStateError } from './usage.ts'
import { contextBreakdown, withLiveMessages, DEFAULT_PROVIDER_ID, type ContextParts } from '../contract/index.ts'
import { TOOL_DEFINITIONS } from './model/tools.ts'
import { store } from './store/index.ts'

const PARTS: ContextParts = { messageTokens: 200_000, systemToolsTokens: 1_780, systemPromptTokens: 100 }

test('estimateTokens / formatTokens: rough token math + human labels', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('a'.repeat(400)), 100)
  assert.equal(formatTokens(850), '850')
  assert.equal(formatTokens(12_300), '12.3k')
  assert.equal(formatTokens(1_400_000), '1.4M')
  // The rounding boundary: 999,999 must not render '1000.0k' — it promotes to '1.0M'.
  assert.equal(formatTokens(999_999), '1.0M')
  assert.equal(formatTokens(999_400), '999.4k')
})

test('the meter accumulates real token usage into the rolling windows', () => {
  let t = 1_000_000
  const meter = createUsageMeter(() => t)
  const before = meter.planLimits()[0].pct
  meter.record(100_000, 50_000) // 150k tokens this turn
  const after = meter.planLimits()[0].pct
  assert.ok(after >= before, 'the 5-hour ring rose with consumption')
})

test('plan usage exposes stable window keys and raw local counters only', () => {
  let t = 1_000_000
  const meter = createUsageMeter(() => t, false)
  meter.record(120, 30)
  const limits = meter.planLimits()
  assert.deepEqual(limits.map((window) => window.key), ['fiveHour', 'weekly'])
  assert.deepEqual(limits.map(({ usedTokens, limitTokens }) => [usedTokens, limitTokens]), [
    [150, 2_400_000],
    [150, 24_000_000],
  ])
  assert.ok(limits.every((window) => window.label !== 'Sonnet only'))
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
  const ctx = contextBreakdown(PARTS, CONTEXT_WINDOW)
  assert.equal(ctx.segments.find((s) => s.id === 'messages')?.rawTokens, PARTS.messageTokens)
  assert.equal(ctx.total, formatTokens(CONTEXT_WINDOW))
  const loaded = ctx.segments.filter((s) => !s.deferred && s.id !== 'free')
  const usedRaw = loaded.reduce((n, s) => n + s.rawTokens, 0)
  const free = ctx.segments.find((s) => s.id === 'free')!
  assert.equal(usedRaw + free.rawTokens, CONTEXT_WINDOW, 'loaded + free tile the window')
  assert.deepEqual(ctx.segments.map((s) => s.id), ['messages', 'systemTools', 'systemPrompt', 'free'])
})

test('System tools + System prompt are the real eager request sizes (not seed)', () => {
  const parts: ContextParts = { messageTokens: 0, systemToolsTokens: 1_780, systemPromptTokens: 100 }
  const ctx = contextBreakdown(parts, CONTEXT_WINDOW)
  assert.equal(ctx.segments.find((s) => s.id === 'systemTools')?.rawTokens, 1_780)
  assert.equal(ctx.segments.find((s) => s.id === 'systemPrompt')?.rawTokens, 100)
})

test('store.usage: base tool tokens match the Agent allowlist actually sent to a tool-capable provider', () => {
  const tenantId = store.defaultTenantId()
  const tools = TOOL_DEFINITIONS.slice(0, 1).map((tool) => tool.name)
  assert.equal(tools.length, 1, 'precondition: catalog has a concrete tool to allow')
  const agent = store.createAgent({
    label: 'Usage subset agent', systemPrompt: 'usage test', providerId: DEFAULT_PROVIDER_ID,
    tools, instructions: '',
  }, tenantId)
  const session = store.createSession('usage subset', tenantId)
  try {
    store.setSessionAgent(session.id, agent.id)
    const provider = store.getProvider(agent.providerId)
    assert.equal(provider.id, agent.providerId)
    assert.notEqual(store.providerConfig(provider.id).capabilities?.toolUse, false)
    const allowed = TOOL_DEFINITIONS.filter((tool) => agent.tools.includes(tool.name))
    const expected = estimateTokens(JSON.stringify(allowed))
    const seg = store.usage(session.id, tenantId).context.segments.find((s) => s.id === 'systemTools')!
    assert.equal(seg.rawTokens, expected, 'usage includes only base definitions generateReply sends')
    assert.equal(seg.deferred, undefined)
  } finally {
    store.removeSession(session.id)
    store.deleteAgent(agent.id)
  }
})

test('store.usage: a non-tool endpoint estimates no base tools', () => {
  const tenantId = store.defaultTenantId()
  const provider = store.createProvider(
    {
      label: 'Usage non-tool endpoint', modelFamily: 'claude', effortLevels: ['Default'],
      models: [{ id: 'usage-model', label: 'Usage model', contextWindow: 32_000 }],
    },
    { model: 'usage-model', capabilities: { toolUse: false } },
    tenantId,
  )
  const agent = store.createAgent({
    label: 'Usage non-tool agent', systemPrompt: 'usage test', providerId: provider.id,
    tools: TOOL_DEFINITIONS.map((tool) => tool.name), instructions: '',
  }, tenantId)
  const session = store.createSession('usage opaque', tenantId)
  try {
    store.setSessionAgent(session.id, agent.id)
    const resolvedProvider = store.getProvider(provider.id)
    assert.equal(resolvedProvider.id, provider.id)
    assert.equal(store.providerConfig(resolvedProvider.id).capabilities?.toolUse, false)
    const seg = store.usage(session.id, tenantId).context.segments.find((s) => s.id === 'systemTools')!
    assert.equal(seg.rawTokens, 0, 'opaque provider does not receive a tools parameter')
  } finally {
    store.removeSession(session.id)
    store.deleteAgent(agent.id)
    store.deleteProvider(provider.id)
  }
})

test('store.usage: legacy Session config still estimates its relayed Agent tools', () => {
  const tenantId = store.defaultTenantId()
  const provider = store.createProvider(
    { label: 'Usage Session provider', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' },
    // New Session providers are minted tool-capable; a persisted older config
    // could say false, but relay.ts still forwards the Agent's tool definitions.
    { kind: 'session', capabilities: { toolUse: false }, secretHash: '1'.repeat(64) },
    tenantId,
  )
  const tools = TOOL_DEFINITIONS.slice(0, 2).map((tool) => tool.name)
  assert.ok(tools.length > 0)
  const agent = store.createAgent({
    label: 'Usage Session agent', systemPrompt: 'usage test', providerId: provider.id,
    tools, instructions: '',
  }, tenantId)
  const session = store.createSession('usage Session', tenantId)
  try {
    store.setSessionAgent(session.id, agent.id)
    const resolvedProvider = store.getProvider(provider.id)
    assert.equal(resolvedProvider.kind, 'session')
    assert.equal(store.providerConfig(resolvedProvider.id).capabilities?.toolUse, false)
    const expected = estimateTokens(JSON.stringify(
      TOOL_DEFINITIONS.filter((tool) => agent.tools.includes(tool.name)),
    ))
    const snapshot = store.usage(session.id, tenantId)
    assert.equal(snapshot.model.modelId, undefined, 'mailbox cognition remains opaque')
    assert.equal(snapshot.context.segments.find((s) => s.id === 'systemTools')?.rawTokens, expected)
  } finally {
    store.removeSession(session.id)
    store.deleteAgent(agent.id)
    store.deleteProvider(provider.id)
  }
})

test('withLiveMessages overlays a live Messages count, keeping the real categories', () => {
  const server = contextBreakdown({ messageTokens: 50, systemToolsTokens: 1_780, systemPromptTokens: 100 }, CONTEXT_WINDOW)
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
  const u = store.usage('auth-refactor')
  assert.ok(u.context && Array.isArray(u.limits))
})

test('usage meter overLimit: spend-time enforcement (D8)', () => {
  let t = 1_000_000
  const m = createUsageMeter(() => t)
  // The fresh meter is seeded under both ceilings (1.704M/2.4M, 5.76M/24M) → no limit hit.
  assert.equal(m.overLimit(), null)
  // A tighter Agent budget already below the seeded 5-hour consumption (1.704M) is over now.
  const tight = m.overLimit({ windows: [{ label: '5-hour limit', ceiling: 800_000 }] })
  assert.equal(tight?.label, '5-hour limit')
  assert.equal(tight?.ceiling, 800_000)
  // Spending past the plan's 5-hour ceiling (2.4M) tips the plan itself over.
  m.record(700_000, 0) // 1.704M + 700k = 2.404M ≥ 2.4M
  assert.equal(m.overLimit()?.label, '5-hour limit')
})

test('store.overSpendLimit delegates to the meter (the route gate, D8)', () => {
  // A budget below the already-consumed 5-hour total is over-limit immediately — robust to
  // any prior recording (more spend only raises consumed). This is what the route gates on.
  const over = store.overSpendLimit({ windows: [{ label: '5-hour limit', ceiling: 100_000 }] })
  assert.equal(over?.label, '5-hour limit')
})

test('usage snapshots round-trip without persisting caller-controlled ceilings', () => {
  let t = 10_000
  const meter = createUsageMeter(() => t, false)
  meter.record(120, 30)
  const snapshot = meter.snapshot()
  assert.deepEqual(Object.keys(snapshot).sort(), ['fiveHour', 'weekly'])
  assert.deepEqual(Object.keys(snapshot.fiveHour).sort(), ['consumed', 'start'])
  const restored = createUsageMeter(() => t, true, snapshot)
  assert.deepEqual(restored.snapshot(), snapshot)
  snapshot.fiveHour.consumed = 999_999
  assert.equal(restored.snapshot().fiveHour.consumed, 150)
})

test('five-hour and weekly windows roll independently at their own boundaries', () => {
  let t = 0
  const meter = createUsageMeter(() => t, false)
  meter.record(100, 0)
  t = 5 * 3_600_000
  assert.equal(meter.snapshot().fiveHour.consumed, 0)
  assert.equal(meter.snapshot().weekly.consumed, 100)
  t = 7 * 24 * 3_600_000
  assert.equal(meter.snapshot().weekly.consumed, 0)
})

test('large elapsed spans use O(1) rollover and clock rollback never forgives spend', () => {
  let t = 0
  const meter = createUsageMeter(() => t, false)
  meter.record(10, 0)
  t = 1_000_000_000_000
  meter.planLimits()
  assert.equal(meter.snapshot().fiveHour.consumed, 0)
  const start = meter.snapshot().fiveHour.start
  t = start - 1
  meter.record(7, 0)
  assert.equal(meter.snapshot().fiveHour.start, start)
  assert.equal(meter.snapshot().fiveHour.consumed, 7)
})

test('malformed persisted state is rejected before restoration', () => {
  const valid = { fiveHour: { start: 0, consumed: 1 }, weekly: { start: 0, consumed: 2 } }
  assert.deepEqual(parseUsageMeterState(valid), valid)
  for (const invalid of [
    null,
    { ...valid, extra: true },
    { fiveHour: { start: -1, consumed: 1 }, weekly: valid.weekly },
    { fiveHour: { start: 0, consumed: Number.NaN }, weekly: valid.weekly },
    { fiveHour: { start: 0, consumed: Number.POSITIVE_INFINITY }, weekly: valid.weekly },
    { fiveHour: { start: MAX_USAGE_STATE_START + 1, consumed: 0 }, weekly: valid.weekly },
    { fiveHour: { start: 0, consumed: 1, ceiling: 2 }, weekly: valid.weekly },
  ]) assert.throws(() => createUsageMeter(() => 0, false, invalid), UsageStateError)
})

test('usage rejects cumulative overflow and out-of-range clocks without mutating state', () => {
  const meter = createUsageMeter(() => 0, false, {
    fiveHour: { start: 0, consumed: Number.MAX_SAFE_INTEGER - 5 },
    weekly: { start: 0, consumed: Number.MAX_SAFE_INTEGER - 5 },
  })
  const before = meter.snapshot()
  assert.throws(() => meter.record(6, 0), RangeError)
  assert.deepEqual(meter.snapshot(), before)
  assert.throws(() => createUsageMeter(() => MAX_USAGE_STATE_START + 1, false), RangeError)
  assert.throws(() => createUsageMeter(() => -1, false), RangeError)
})

test('record validates both token inputs before mutating either window', () => {
  const meter = createUsageMeter(() => 0, false)
  const before = meter.snapshot()
  for (const pair of [[-1, 0], [0, -1], [Number.NaN, 0], [0, Number.POSITIVE_INFINITY], [0.5, 0], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => meter.record(pair[0]!, pair[1]!), RangeError)
    assert.deepEqual(meter.snapshot(), before)
  }
})
