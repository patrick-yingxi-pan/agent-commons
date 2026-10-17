import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextBreakdown, type UsageSnapshot } from '../../contract/usage.ts'
import { usagePresentation } from './usagePresentation.ts'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { join } from 'node:path'

const snapshot: UsageSnapshot = {
  context: contextBreakdown({ messageTokens: 1, systemToolsTokens: 10, systemPromptTokens: 20 }, 1_000_000),
  limits: [{ key: 'fiveHour', label: '5-hour limit', reset: 'Resets later', usedTokens: 70, limitTokens: 100, pct: 70 }],
  model: { providerId: 'a', providerLabel: 'Provider A', modelId: 'model-a' },
}

test('pending and failed usage reads are not numeric zero or stale success', () => {
  for (const status of ['idle', 'loading'] as const) {
    const view = usagePresentation({ status, data: undefined })
    assert.equal(view.phase, 'loading')
    assert.equal(view.usage, undefined)
    assert.equal(view.title, 'Usage — loading')
  }
  for (const data of [undefined, snapshot]) {
    const view = usagePresentation({ status: 'error', data })
    assert.equal(view.phase, 'error')
    assert.equal(view.usage, undefined)
    assert.equal(view.title, 'Usage — unavailable')
  }
})

test('context-only presentation reports small nonzero estimates and labels refreshes', () => {
  const view = usagePresentation({ status: 'success', data: snapshot })
  assert.equal(view.phase, 'ready')
  assert.match(view.title, /31 tokens \(<0\.1% of catalog window\)/)
  assert.doesNotMatch(view.title, /5-hour|weekly|70%/)
  const updating = usagePresentation({ status: 'loading', data: snapshot })
  assert.equal(updating.phase, 'ready')
  assert.equal(updating.updating, true)
  assert.match(updating.title, /updating/)
})

test('a selected model changes context metadata without reassigning account counters to it', () => {
  const selected = { providerId: 'b', providerLabel: 'Provider B', modelId: 'model-b' }
  const view = usagePresentation({ status: 'success', data: snapshot }, 100, selected)
  assert.deepEqual(view.usage?.model, selected)
  assert.equal(view.usage?.context.used, '130')
  assert.equal(view.usage?.context.windowTokens, undefined)
  assert.match(view.title, /130 tokens \(window unknown\)/)
  assert.equal(view.usage?.limits, snapshot.limits)
  assert.equal(snapshot.context.used, '31')
  const known = usagePresentation({ status: 'success', data: snapshot }, 0, { ...selected, windowTokens: 2_000 })
  assert.match(known.title, /30 tokens \(1\.5% of catalog window\)/)
})

test('every usage control uses the shared presentation and keeps the gauge context-only', () => {
  const control = stripComments(read(join(ROOT, 'src/components/UsageControl.tsx')))
  const details = stripComments(read(join(ROOT, 'src/components/UsageDetails.tsx')))
  assert.match(control, /usagePresentation\(query, messageTokens, model\)/)
  assert.match(control, /data-usage-read=\{view\.phase\}/)
  assert.doesNotMatch(control, /EMPTY_USAGE|limits\[/)
  assert.match(details, /Provider quota[\s\S]*Not connected in Agent Commons/)
  assert.match(details, /Across all models in this account/)
  assert.match(details, /formatUsagePercent\(limit\.usedTokens, limit\.limitTokens\)/)
  assert.doesNotMatch(details, /inner = context|Sonnet only/)
})
