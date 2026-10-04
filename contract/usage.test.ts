import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextBreakdown, formatTokens, withLiveMessages, type ContextSegment, type ContextUsage } from './usage.ts'

const parts = { messageTokens: 40, systemToolsTokens: 120, systemPromptTokens: 80 }
const realLoadedIds = ['messages', 'systemTools', 'systemPrompt']

test('contextBreakdown counts only the supplied Messages, System tools, and System prompt', () => {
  const context = contextBreakdown(parts, 1_000)

  assert.deepEqual(context.segments.map((segment) => segment.id), [...realLoadedIds, 'free'])
  assert.equal(context.used, formatTokens(240))
  assert.equal(context.pct, 24)
  assert.equal(context.segments.find((segment) => segment.id === 'messages')?.rawTokens, 40)
  assert.equal(context.segments.find((segment) => segment.id === 'systemTools')?.rawTokens, 120)
  assert.equal(context.segments.find((segment) => segment.id === 'systemPrompt')?.rawTokens, 80)
  assert.equal(context.segments.find((segment) => segment.id === 'free')?.rawTokens, 760)
  assert.ok(!context.segments.some((segment) => ['skills', 'memory', 'agents', 'mcp'].includes(segment.id)))
})

test('unknown model capacity preserves exact real counts without Free or fictional categories', () => {
  const context = contextBreakdown(parts)

  assert.equal(context.total, '—')
  assert.equal(context.pct, 0)
  assert.equal(context.windowTokens, undefined)
  assert.equal(context.used, formatTokens(240))
  assert.deepEqual(context.segments.map((segment) => segment.id), realLoadedIds)
  assert.ok(context.segments.every((segment) => segment.pct === undefined))
})

function segment(overrides: Partial<ContextSegment> & Pick<ContextSegment, 'id' | 'label' | 'rawTokens' | 'tokens' | 'tone'>): ContextSegment {
  return { ...overrides }
}

function contextWith(deferred: ContextSegment[]): ContextUsage {
  return {
    ...contextBreakdown(parts, 1_000),
    segments: [
      segment({ id: 'messages', label: 'Messages', rawTokens: 40, tokens: '40', tone: 'messages', pct: 4 }),
      segment({ id: 'systemTools', label: 'System tools', rawTokens: 120, tokens: '120', tone: 'systemTools', pct: 12 }),
      segment({ id: 'systemPrompt', label: 'System prompt', rawTokens: 80, tokens: '80', tone: 'systemPrompt', pct: 8 }),
      segment({ id: 'free', label: 'Free space', rawTokens: 760, tokens: '760', tone: 'free', pct: 76 }),
      ...deferred,
    ],
  }
}

function deferredDescriptor(entry: ContextSegment) {
  return {
    id: entry.id, label: entry.label, rawTokens: entry.rawTokens, tokens: entry.tokens,
    tone: entry.tone, deferred: entry.deferred, count: entry.count,
  }
}

test('withLiveMessages preserves only deferred categories supplied by the snapshot', () => {
  const supplied = [segment({
    id: 'connected-tools', label: 'Connected server tools', rawTokens: 320, tokens: '320',
    tone: 'mcp', deferred: true, count: 3,
  })]
  const live = withLiveMessages(contextWith(supplied), 200)

  assert.deepEqual(live.segments.filter((entry) => entry.deferred).map(deferredDescriptor), supplied.map(deferredDescriptor))
  assert.ok(!live.segments.some((entry) => entry.id === 'mcp' || entry.count === 75))
  assert.equal(live.segments.find((entry) => entry.id === 'messages')?.rawTokens, 200)
  assert.equal(live.segments.find((entry) => entry.id === 'systemTools')?.rawTokens, 120)
  assert.equal(live.segments.find((entry) => entry.id === 'systemPrompt')?.rawTokens, 80)
  assert.equal(live.used, formatTokens(400))
  assert.equal(live.segments.find((entry) => entry.id === 'free')?.rawTokens, 600)
})

test('withLiveMessages does not invent deferred rows when the snapshot has none', () => {
  const live = withLiveMessages(contextWith([]), 200)

  assert.deepEqual(live.segments.filter((entry) => entry.deferred), [])
  assert.ok(!live.segments.some((entry) => ['skills', 'memory', 'agents', 'mcp'].includes(entry.id)))
})

test('withLiveMessages overlays an unknown window without dropping supplied deferred rows', () => {
  const supplied = [segment({
    id: 'future-context', label: 'Available context', rawTokens: 500, tokens: '500',
    tone: 'mcp', deferred: true, count: 2,
  })]
  const live = withLiveMessages(contextWith(supplied), 200, {})

  assert.equal(live.windowTokens, undefined)
  assert.equal(live.total, '—')
  assert.equal(live.pct, 0)
  assert.ok(!live.segments.some((entry) => entry.id === 'free'))
  assert.deepEqual(live.segments.filter((entry) => entry.deferred).map(deferredDescriptor), supplied.map(deferredDescriptor))
  assert.ok(live.segments.filter((entry) => entry.deferred).every((entry) => entry.pct === undefined))
  assert.equal(live.segments.find((entry) => entry.id === 'messages')?.rawTokens, 200)
  assert.equal(live.used, formatTokens(400))
})
