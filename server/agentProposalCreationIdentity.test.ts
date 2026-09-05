import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentProposalCreationId,
  isAgentProposalCreationId,
} from './agentProposalCreationIdentity.ts'

test('Agent proposal creation identity is deterministic, scoped, and opaque', () => {
  const key = 'proposal-key-that-must-not-leak'
  const id = agentProposalCreationId('tenant-a', 'agent-a', key)
  assert.equal(id, agentProposalCreationId('tenant-a', 'agent-a', key))
  assert.match(id, /^agent-proposal-new-[a-f0-9]{24}$/)
  assert.equal(isAgentProposalCreationId(id), true)
  assert.notEqual(id, agentProposalCreationId('tenant-b', 'agent-a', key))
  assert.notEqual(id, agentProposalCreationId('tenant-a', 'agent-b', key))
  assert.notEqual(id, agentProposalCreationId('tenant-a', 'agent-a', 'another-key'))
  assert.doesNotMatch(id, /tenant-a|agent-a|proposal-key/)
  assert.equal(isAgentProposalCreationId('agent-proposal-new-not-a-key'), false)
})
