import test from 'node:test'
import assert from 'node:assert/strict'
import { systemPromptCreationId } from './systemPromptCreationIdentity.ts'

test('system-prompt creation identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'prompt-create-key-that-must-not-leak'
  const first = systemPromptCreationId('tenant-a', key)
  assert.equal(first, systemPromptCreationId('tenant-a', key))
  assert.notEqual(first, systemPromptCreationId('tenant-b', key))
  assert.match(first, /^sp-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|prompt-create-key/)
})
