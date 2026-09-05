import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentProposalVerdictId, isAgentProposalVerdictId } from './agentProposalVerdictIdentity.ts'

test('Agent proposal verdict ids bind tenant, Agent, proposal, and logical key', () => {
  const key = 'one-logical-owner-decision'
  const id = agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-a', key)
  assert.equal(id, agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-a', key))
  assert.match(id, /^agent-proposal-verdict-[a-f0-9]{24}$/)
  assert.equal(isAgentProposalVerdictId(id), true)
  assert.notEqual(id, agentProposalVerdictId('tenant-b', 'agent-a', 'proposal-a', key))
  assert.notEqual(id, agentProposalVerdictId('tenant-a', 'agent-b', 'proposal-a', key))
  assert.notEqual(id, agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-b', key))
  assert.notEqual(id, agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-a', 'another-key'))
  assert.equal(isAgentProposalVerdictId('agent-proposal-verdict-nope'), false)
})
