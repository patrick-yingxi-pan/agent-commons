import assert from 'node:assert/strict'
import { test } from 'node:test'
import { providerModelChoices, type ModelProvider } from './providers.ts'

const provider: ModelProvider = {
  id: 'endpoint', label: 'Connected endpoint', modelFamily: 'custom', effortLevels: [],
  execution: 'configured', defaultModelId: 'exact-configured-model',
}

test('a configured endpoint without a catalog offers only its exact default, without invented metadata', () => {
  const expected = [{ id: 'exact-configured-model', label: 'exact-configured-model' }]
  assert.deepEqual(providerModelChoices(provider), expected)
  assert.deepEqual(providerModelChoices({ ...provider, models: [] }), expected)
  assert.equal(provider.models, undefined, 'choices never mutate or impersonate a catalog')
})

test('a nonempty catalog stays authoritative, even when the configured default is absent', () => {
  const models = [{ id: 'listed', label: 'Listed', contextWindow: 42 }]
  assert.equal(providerModelChoices({ ...provider, models }), models)
})

test('session, unavailable, development and unresolved providers never gain synthetic choices', () => {
  assert.deepEqual(providerModelChoices(), [])
  for (const execution of [undefined, 'unconfigured', 'mock'] as const) {
    assert.deepEqual(providerModelChoices({ ...provider, execution }), [])
  }
  for (const defaultModelId of [undefined, '', '   ']) {
    assert.deepEqual(providerModelChoices({ ...provider, defaultModelId }), [])
  }
  assert.deepEqual(providerModelChoices({ ...provider, kind: 'session', models: [{ id: 'forged', label: 'Forged' }] }), [])
})
