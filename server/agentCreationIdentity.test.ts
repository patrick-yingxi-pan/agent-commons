import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentCreationId,
  agentForkCreationId,
  isAgentCreationId,
  isDirectAgentCreationId,
  isForkAgentCreationId,
} from './agentCreationIdentity.ts'

test('Agent creation identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'agent-create-key-that-must-not-leak'
  const first = agentCreationId('tenant-a', key)
  assert.equal(first, agentCreationId('tenant-a', key))
  assert.notEqual(first, agentCreationId('tenant-b', key))
  assert.match(first, /^agent-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|agent-create-key/)
})

test('Agent fork identity is deterministic, tenant-scoped, opaque, and direct-create disjoint', () => {
  const key = 'shared-logical-key'
  const fork = agentForkCreationId('tenant-a', key)
  assert.equal(fork, agentForkCreationId('tenant-a', key))
  assert.notEqual(fork, agentForkCreationId('tenant-b', key))
  assert.notEqual(fork, agentCreationId('tenant-a', key))
  assert.match(fork, /^agent-fork-[a-f0-9]{24}$/)
  assert.equal(isForkAgentCreationId(fork), true)
  assert.equal(isDirectAgentCreationId(fork), false)
  assert.equal(isAgentCreationId(fork), true)
  assert.equal(isAgentCreationId(agentCreationId('tenant-a', key)), true)
  assert.equal(isAgentCreationId('agent-123'), false)
})
