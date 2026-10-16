import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effortLevelsFor, resolveEffort } from './modelEffort.ts'
import type { ModelProvider } from './providers.ts'

const provider = { effortLevels: ['Low', 'High'] } as ModelProvider
test('effort display and execution share exact preference and documented fallback semantics', () => {
  assert.equal(resolveEffort(['Low', 'High'], 'Low'), 'Low')
  assert.equal(resolveEffort(['Low', 'High'], 'retired'), 'High')
  assert.equal(resolveEffort(['Low', 'High']), 'High')
  assert.equal(resolveEffort(['Balanced', 'Deep'], 'retired'), 'Balanced')
  assert.equal(resolveEffort([], 'High'), undefined)
})
test('model vocabulary overrides provider metadata and sessions never get endpoint effort', () => {
  assert.deepEqual(effortLevelsFor(provider, { id: 'm', label: 'M' }), ['Low', 'High'])
  assert.deepEqual(effortLevelsFor(provider, { id: 'm', label: 'M', effortLevels: [] }), [])
  assert.deepEqual(effortLevelsFor(provider, { id: 'm', label: 'M', effortLevels: ['Deep'] }), ['Deep'])
  assert.deepEqual(effortLevelsFor({ ...provider, kind: 'session' }, { id: 'm', label: 'M', effortLevels: ['Deep'] }), [])
  assert.deepEqual(effortLevelsFor(), [])
})
