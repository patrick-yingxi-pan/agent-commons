import assert from 'node:assert/strict'
import { test } from 'node:test'
import { turnProvenance } from './turnProvenance.ts'

const providers = [
  { id: 'openai', label: 'My OpenAI', kind: 'endpoint' as const },
  { id: 'anthropic', label: 'Team Claude', kind: 'endpoint' as const },
  { id: 'deepseek', label: 'My DeepSeek', kind: 'endpoint' as const },
  { id: 'relay', label: 'My session', kind: 'session' as const },
]

test('each recorded provider/model pair stays exact, independent of registry order or defaults', () => {
  for (const provider of providers.slice(0, 3)) {
    const message = { providerId: provider.id, modelId: `${provider.id}-recorded-model` }
    const expected = { label: `${provider.label} · ${message.modelId}`, relayed: false }
    assert.deepEqual(turnProvenance(message, providers), expected)
    assert.deepEqual(turnProvenance(message, [...providers].reverse().map(row => ({
      ...row, defaultModelId: 'changed-default', models: [{ id: 'another-model', label: 'New model' }],
    }))), expected)
  }
})

test('the current registry label decorates only its exact recorded connection', () => {
  assert.deepEqual(turnProvenance({ providerId: 'openai', modelId: 'old-id' }, [
    { id: 'unrelated', label: 'My OpenAI', kind: 'session' },
    { id: 'openai', label: 'Renamed connection', kind: 'endpoint' },
  ]), { label: 'Renamed connection · old-id', relayed: false })
})

test('legacy and partial stamps never borrow a default, current Agent binding, or model catalog', () => {
  assert.deepEqual(turnProvenance({}, providers), { label: 'Model details not recorded', relayed: false })
  assert.deepEqual(turnProvenance({ modelId: 'retained-model' }, providers), {
    label: 'Model connection not recorded · retained-model', relayed: false,
  })
  assert.deepEqual(turnProvenance({ providerId: 'openai' }, providers), {
    label: 'My OpenAI · Model not recorded', relayed: false,
  })
})

test('loading and unavailable private/deleted connections remain distinct without hiding the recorded model', () => {
  const message = { providerId: 'openai', modelId: 'historical-model' }
  assert.deepEqual(turnProvenance(message, undefined), { label: 'Loading model connection… · historical-model', relayed: false })
  assert.deepEqual(turnProvenance(message, []), { label: 'Model connection unavailable · historical-model', relayed: false })
  assert.deepEqual(turnProvenance({ providerId: 'deleted' }, providers), {
    label: 'Model connection unavailable · Model not recorded', relayed: false,
  })
})

test('failed connection reads do not remain loading or discard a readable cached label', () => {
  const message = { providerId: 'openai', modelId: 'historical-model' }
  assert.deepEqual(turnProvenance(message, undefined, true), {
    label: 'Model connection could not be loaded · historical-model', relayed: false,
  })
  assert.deepEqual(turnProvenance(message, providers, true), {
    label: 'My OpenAI · historical-model', relayed: false,
  })
  assert.deepEqual(turnProvenance({}, undefined, true), {
    label: 'Model details not recorded', relayed: false,
  })
})

test('delegated-session provenance requires an exact known Session provider, never a missing stamp', () => {
  assert.deepEqual(turnProvenance({ providerId: 'relay' }, providers), {
    label: 'My session · via your delegated session', relayed: true,
  })
  assert.deepEqual(turnProvenance({ providerId: 'relay', modelId: 'recorded' }, providers), {
    label: 'My session · recorded', relayed: true,
  })
  assert.deepEqual(turnProvenance({ providerId: 'relay' }, []), {
    label: 'Model connection unavailable · Model not recorded', relayed: false,
  })
})
