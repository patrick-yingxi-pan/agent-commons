import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SystemPromptEntry } from '../../contract/index.ts'
import { mergeSystemPromptDefinition } from './systemPromptRevision.ts'

const prompt = (overrides: Partial<SystemPromptEntry> = {}): SystemPromptEntry => ({
  id: 'prompt-revision',
  label: 'Prompt',
  body: 'Current body.',
  targetFamily: 'claude',
  definitionRevision: 2,
  isDefault: true,
  ...overrides,
})

test('a newer prompt definition preserves the viewer-default projection', () => {
  const current = prompt()
  const incoming = prompt({
    label: 'Renamed',
    body: 'Incoming body.',
    targetFamily: 'openai',
    definitionRevision: 3,
    isDefault: false,
  })
  const merged = mergeSystemPromptDefinition(current, incoming)
  assert.equal(merged.label, 'Renamed')
  assert.equal(merged.body, 'Incoming body.')
  assert.equal(merged.targetFamily, 'openai')
  assert.equal(merged.definitionRevision, 3)
  assert.equal(merged.isDefault, true)
})

test('an older prompt acknowledgement cannot rewind definition state', () => {
  const current = prompt({ label: 'Current', definitionRevision: 5 })
  const delayed = prompt({ label: 'Delayed', definitionRevision: 4, isDefault: false })
  assert.deepEqual(mergeSystemPromptDefinition(current, delayed), current)
})
