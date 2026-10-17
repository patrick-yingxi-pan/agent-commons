import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelProvider } from '../../contract/index.ts'
import { displayModelLabel, pickedModel } from './models.ts'

const provider: ModelProvider = {
  id: 'endpoint', label: 'My endpoint', modelFamily: 'claude', effortLevels: ['High'],
  execution: 'configured', defaultModelId: 'retired-model',
  models: [{ id: 'available-model', label: 'Available Model' }],
}

test('a missing configured default never masquerades as the first catalog model', () => {
  assert.equal(pickedModel(provider), undefined)
  assert.equal(displayModelLabel([provider], { providerId: provider.id }, 'High'), 'My endpoint · retired-model · unavailable')
})

test('an explicit unavailable model keeps its exact identity instead of inheriting a valid default', () => {
  const current = { ...provider, defaultModelId: 'available-model' }
  const pick = { providerId: current.id, modelId: 'removed-explicit-model' }
  assert.equal(pickedModel(current, pick), undefined)
  assert.equal(displayModelLabel([current], pick, 'High'), 'My endpoint · removed-explicit-model · unavailable')
  assert.equal(pickedModel(current, { modelId: 'available-model' })?.id, 'available-model')
})

test('a catalog without a configured model is not permission to select its first entry', () => {
  assert.equal(pickedModel({ ...provider, defaultModelId: undefined }), undefined)
})

test('catalog-less configured endpoints retain their exact model and Session providers have no concrete model', () => {
  const listless = { ...provider, models: undefined }
  assert.equal(pickedModel(listless)?.id, 'retired-model')
  assert.equal(pickedModel({ ...provider, kind: 'session' }), undefined)
})
