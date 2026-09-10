import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MODEL_PREFERENCES,
  MODEL_PREFERENCE_STRING_MAX,
  parseModelPreferences,
  parseUpdateModelPreferencesRequest,
} from './modelPreferences.ts'

test('model preferences preserve exact optional references and fixed defaults', () => {
  assert.deepEqual(DEFAULT_MODEL_PREFERENCES, { effort: 'High', ultracode: false, fast: false })
  const source = { providerId: 'provider-old', modelId: 'model-old', effort: 'Custom', ultracode: true, fast: false }
  const parsed = parseModelPreferences(source)
  assert.deepEqual(parsed, source)
  assert.notEqual(parsed, source)
})

test('model preference and update bodies are closed and bounded', () => {
  const valid = {
    expectedTenantId: 'tenant-a', expectedUserId: 'user-a', expectedRevision: 0,
    preferences: { effort: 'High', ultracode: false, fast: true },
  }
  assert.deepEqual(parseUpdateModelPreferencesRequest(valid), valid)
  for (const candidate of [
    {},
    { ultracode: false, fast: false, extra: true },
    { providerId: '', ultracode: false, fast: false },
    { modelId: ' model', ultracode: false, fast: false },
    { effort: 'x'.repeat(MODEL_PREFERENCE_STRING_MAX + 1), ultracode: false, fast: false },
    { ultracode: 0, fast: false },
  ]) assert.equal(parseModelPreferences(candidate), undefined)
  for (const candidate of [
    { ...valid, extra: true },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedTenantId: ' tenant-a' },
    { ...valid, expectedUserId: '' },
    { ...valid, preferences: { ultracode: false } },
  ]) assert.equal(parseUpdateModelPreferencesRequest(candidate), undefined)
})
