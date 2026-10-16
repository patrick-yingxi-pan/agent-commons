import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replyThinking } from './replyThinking.ts'
import type { ModelInfo } from '../../contract/providers.ts'

test('adaptive thinking requires exact model support on the Messages protocol', () => {
  const model: ModelInfo = { id: 'arbitrary-model', label: 'No name heuristic', capabilities: { adaptiveThinking: true } }
  assert.deepEqual(replyThinking(model.id, 'anthropic-messages', model), { type: 'adaptive' })
  assert.deepEqual(replyThinking(model.id, undefined, model), { type: 'adaptive' }, 'legacy protocol absence means Messages')
  assert.equal(replyThinking(model.id, 'openai-responses', model), undefined)
  assert.equal(replyThinking('other-model', undefined, model), undefined, 'a stale or wrong model capability cannot configure this turn')
  assert.equal(replyThinking(model.id, undefined), undefined)
  for (const capabilities of [undefined, { thinking: true }, { adaptiveThinking: false },
    { thinking: false, adaptiveThinking: true }, { adaptiveThinking: 'true' }]) {
    assert.equal(replyThinking('claude-opus-4-8', undefined,
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', capabilities } as ModelInfo), undefined)
  }
})
