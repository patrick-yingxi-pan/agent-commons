import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  getModelPreferences,
  parsePersistedModelPreferences,
  persistedModelPreferences,
  rehydrateModelPreferences,
  setModelPreferences,
} from './modelPreferences.ts'

beforeEach(() => rehydrateModelPreferences(undefined))

test('personal model preferences default, isolate tenant and user, and retain stale references', () => {
  assert.deepEqual(getModelPreferences('tenant-a', 'user-a'), {
    tenantId: 'tenant-a', userId: 'user-a', revision: 0,
    preferences: { effort: 'High', ultracode: false, fast: false },
  })
  const written = setModelPreferences('tenant-a', 'user-a', 'tenant-a', 'user-a', 0, {
    providerId: 'removed-provider', modelId: 'removed-model', effort: 'Retired', ultracode: true, fast: true,
  })
  assert.equal(written.changed, true)
  assert.equal(written.value.revision, 1)
  assert.equal(getModelPreferences('tenant-a', 'user-b').revision, 0)
  assert.equal(getModelPreferences('tenant-b', 'user-a').revision, 0)
  assert.equal(setModelPreferences('tenant-a', 'user-a', 'tenant-a', 'user-a', 1, written.value.preferences).changed, false)
  assert.equal(getModelPreferences('tenant-a', 'user-a').revision, 1)
})

test('scope and revision conflicts leave every preference row unchanged', () => {
  setModelPreferences('tenant-a', 'user-a', 'tenant-a', 'user-a', 0, { effort: 'Low', ultracode: false, fast: false })
  const before = persistedModelPreferences()
  assert.throws(() => setModelPreferences('tenant-a', 'user-a', 'tenant-a', 'user-b', 1, { effort: 'High', ultracode: true, fast: true }), /account or workspace changed/)
  assert.throws(() => setModelPreferences('tenant-a', 'user-a', 'tenant-b', 'user-a', 1, { effort: 'High', ultracode: true, fast: true }), /account or workspace changed/)
  assert.throws(() => setModelPreferences('tenant-a', 'user-a', 'tenant-a', 'user-a', 0, { effort: 'High', ultracode: true, fast: true }), /changed elsewhere/)
  assert.deepEqual(persistedModelPreferences(), before)
})

test('persistence parsing is exact, detached, and rejects malformed present rows', () => {
  const rows = [['tenant-a', [['user-a', { revision: 2, preferences: { effort: 'High', ultracode: false, fast: true } }]]]]
  const parsed = parsePersistedModelPreferences(rows)
  assert.deepEqual(parsed, rows)
  assert.notEqual(parsed, rows)
  rehydrateModelPreferences(parsed)
  assert.deepEqual(getModelPreferences('tenant-a', 'user-a'), {
    tenantId: 'tenant-a', userId: 'user-a', revision: 2,
    preferences: { effort: 'High', ultracode: false, fast: true },
  })
  for (const malformed of [null, {}, [['tenant-a', []], ['tenant-a', []]], [[' tenant-a', []]], [['tenant-a', [['user-a ', { revision: 1, preferences: { ultracode: false, fast: false } }]]]], [['tenant-a', [['user-a', { revision: 0, preferences: { ultracode: false, fast: false } }]]]], [['tenant-a', [['user-a', { revision: 1, preferences: { ultracode: false, fast: false }, extra: true }]]]]]) {
    assert.throws(() => parsePersistedModelPreferences(malformed))
  }
})

test('an exhausted revision permits exact no-op recovery but refuses a changed write', () => {
  rehydrateModelPreferences([['tenant-a', [['user-a', {
    revision: Number.MAX_SAFE_INTEGER,
    preferences: { effort: 'High', ultracode: false, fast: false },
  }]]]])
  const unchanged = setModelPreferences(
    'tenant-a', 'user-a', 'tenant-a', 'user-a', Number.MAX_SAFE_INTEGER,
    { effort: 'High', ultracode: false, fast: false },
  )
  assert.equal(unchanged.changed, false)
  assert.throws(() => setModelPreferences(
    'tenant-a', 'user-a', 'tenant-a', 'user-a', Number.MAX_SAFE_INTEGER,
    { effort: 'Low', ultracode: false, fast: false },
  ), /revision is exhausted/)
  assert.equal(getModelPreferences('tenant-a', 'user-a').revision, Number.MAX_SAFE_INTEGER)
})
