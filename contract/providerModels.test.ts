import assert from 'node:assert/strict'
import { test } from 'node:test'
import { providerModelChoices, providerModelSelection, type ModelProvider } from './providers.ts'

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

test('selection retains the exact inherited or explicit identity and never chooses the first catalog row', () => {
  const listed = { id: 'listed', label: 'Listed', contextWindow: 42 }
  const endpoint = { ...provider, models: [listed] }
  assert.deepEqual(providerModelSelection(endpoint), { modelId: provider.defaultModelId, model: undefined, unavailable: true })
  assert.deepEqual(providerModelSelection(endpoint, listed.id), { modelId: listed.id, model: listed, unavailable: false })
  assert.deepEqual(providerModelSelection(endpoint, 'stale-explicit'), { modelId: 'stale-explicit', model: undefined, unavailable: true })
  assert.deepEqual(providerModelSelection({ ...endpoint, defaultModelId: undefined }), { modelId: undefined, model: undefined, unavailable: false })
  assert.equal(endpoint.defaultModelId, 'exact-configured-model', 'resolution never changes connection intent')
})

test('catalog-less, unresolved and Session selections keep their existing execution boundaries', () => {
  assert.deepEqual(providerModelSelection(provider), { modelId: provider.defaultModelId, model: { id: provider.defaultModelId, label: provider.defaultModelId }, unavailable: false })
  assert.deepEqual(providerModelSelection({ ...provider, execution: 'unconfigured' }), { modelId: provider.defaultModelId, model: undefined, unavailable: false })
  for (const candidate of [undefined, { ...provider, kind: 'session' as const, models: [{ id: 'forged', label: 'Forged' }] }]) {
    assert.deepEqual(providerModelSelection(candidate, 'forged'), { unavailable: false })
  }
})
