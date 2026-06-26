/** The "default model" preference is one source of truth shared by the composer's
 *  model control and the Customize page (src/lib/modelPrefs.ts). parseModelPrefs is
 *  the pure merge behind load/save — it must tolerate missing / partial / corrupt
 *  stored values and always return a complete, valid ModelPrefs (a bad blob can
 *  never break the composer). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelPrefs, DEFAULT_MODEL_PREFS } from '../src/lib/modelPrefs.ts'

test('parseModelPrefs returns the defaults for empty / null storage', () => {
  assert.deepEqual(parseModelPrefs(null), DEFAULT_MODEL_PREFS)
  assert.deepEqual(parseModelPrefs(''), DEFAULT_MODEL_PREFS)
})

test('parseModelPrefs merges a partial blob over the defaults', () => {
  const merged = parseModelPrefs(JSON.stringify({ modelId: 'sonnet', effort: 'low' }))
  assert.equal(merged.modelId, 'sonnet', 'stored model wins')
  assert.equal(merged.effort, 'low', 'stored effort wins')
  assert.equal(merged.ultracode, DEFAULT_MODEL_PREFS.ultracode, 'unspecified fields keep the default')
  assert.equal(merged.fast, DEFAULT_MODEL_PREFS.fast)
})

test('parseModelPrefs round-trips a full blob', () => {
  const full = { modelId: 'haiku' as const, effort: 'max' as const, ultracode: true, fast: false }
  assert.deepEqual(parseModelPrefs(JSON.stringify(full)), full)
})

test('parseModelPrefs falls back to the defaults on corrupt JSON (never throws)', () => {
  assert.deepEqual(parseModelPrefs('{ not valid json'), DEFAULT_MODEL_PREFS)
  assert.deepEqual(parseModelPrefs('null'), DEFAULT_MODEL_PREFS)
})
