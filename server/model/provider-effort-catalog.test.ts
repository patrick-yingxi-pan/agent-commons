/** Capability declarations retain unsupported / known / unknown semantics. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectProviderModels } from './providerCatalog.ts'

const cases = [
  { name: 'explicit unsupported', effort: { supported: false }, expected: [] },
  { name: 'unsupported overrides contradictory child flags', effort: { supported: false, high: { supported: true } }, expected: [] },
  { name: 'known subset in canonical order', effort: { supported: true, high: { supported: true }, low: { supported: true }, max: { supported: false } }, expected: ['Low', 'High'] },
  { name: 'known support without any recognized supported level', effort: { supported: true, future: { supported: true } }, expected: [] },
  { name: 'known support without level metadata', effort: { supported: true }, expected: [] },
  { name: 'missing metadata', effort: undefined, expected: undefined },
  { name: 'missing parent flag', effort: { high: { supported: true } }, expected: undefined },
  { name: 'malformed parent flag', effort: { supported: 'false', high: { supported: true } }, expected: undefined },
] as const

for (const { name, effort, expected } of cases) {
  test(`catalog effort: ${name}`, async () => {
    const models = await collectProviderModels(async () => ({ data: [{
      id: 'arbitrary-model', display_name: 'Arbitrary model',
      capabilities: { effort, thinking: { supported: false }, image_input: { supported: true } },
    }], has_more: false }), 'anthropic-messages', new AbortController().signal)
    assert.ok(models)
    assert.deepEqual(models[0]?.effortLevels, expected)
    assert.equal(Object.hasOwn(models[0]!, 'effortLevels'), expected !== undefined)
    assert.deepEqual(models[0]?.capabilities, { thinking: false, vision: true })
  })
}

test('ordinary OpenAI model rows retain unknown effort metadata, not unsupported', async () => {
  const models = await collectProviderModels(async () => ({ data: [{
    id: 'arbitrary-openai-model', object: 'model', owned_by: 'local-fixture', created: 1,
  }] }), 'openai-responses', new AbortController().signal)
  assert.deepEqual(models, [{ id: 'arbitrary-openai-model', label: 'arbitrary-openai-model' }])
})
