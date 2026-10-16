import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAssistantTextItems, MAX_ASSISTANT_TEXT_ITEMS } from './assistantTextItems.ts'

test('assistant text items preserve exact order, Unicode, empty items, null and absent phase', () => {
  const items = [{ text: '🧪\n', phase: 'commentary' }, { text: '' }, { text: 'answer', phase: 'final_answer' }, { text: '\u0000', phase: null }]
  assert.equal(isAssistantTextItems(items, '🧪\nanswer\u0000'), true)
  assert.equal(isAssistantTextItems(items, 'answer🧪\n\u0000'), false)
  assert.equal(isAssistantTextItems(items, '🧪\nanswer\u0000extra'), false)
})

test('assistant item shape is closed and bounded; one extra history receipt requires an explicit allowance', () => {
  for (const value of [null, {}, [], [{ text: 1 }], [{ text: 'x', phase: undefined }], [{ text: 'x', phase: 'analysis' }], [{ text: 'x', reasoning: 'hidden' }]]) {
    assert.equal(isAssistantTextItems(value, 'x'), false)
  }
  const items = Array.from({ length: MAX_ASSISTANT_TEXT_ITEMS }, () => ({ text: 'x' }))
  assert.equal(isAssistantTextItems(items, 'x'.repeat(items.length)), true)
  items.push({ text: 'receipt' })
  assert.equal(isAssistantTextItems(items, 'x'.repeat(MAX_ASSISTANT_TEXT_ITEMS) + 'receipt'), false)
  assert.equal(isAssistantTextItems(items, 'x'.repeat(MAX_ASSISTANT_TEXT_ITEMS) + 'receipt', MAX_ASSISTANT_TEXT_ITEMS + 1), true)
})
