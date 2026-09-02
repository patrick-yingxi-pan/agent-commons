import test from 'node:test'
import assert from 'node:assert/strict'
import { agentCreationId } from './agentCreationIdentity.ts'

test('Agent creation identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'agent-create-key-that-must-not-leak'
  const first = agentCreationId('tenant-a', key)
  assert.equal(first, agentCreationId('tenant-a', key))
  assert.notEqual(first, agentCreationId('tenant-b', key))
  assert.match(first, /^agent-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|agent-create-key/)
})
