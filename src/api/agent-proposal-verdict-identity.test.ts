import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentProposalVerdictId } from './agentProposalVerdictIdentity.ts'

test('browser Agent proposal verdict identity is stable and scope-sensitive', async () => {
  const key = 'one-logical-owner-decision'
  const id = await agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-a', key)
  assert.equal(id, await agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-a', key))
  assert.match(id, /^agent-proposal-verdict-[a-f0-9]{24}$/)
  assert.notEqual(id, await agentProposalVerdictId('tenant-b', 'agent-a', 'proposal-a', key))
  assert.notEqual(id, await agentProposalVerdictId('tenant-a', 'agent-b', 'proposal-a', key))
  assert.notEqual(id, await agentProposalVerdictId('tenant-a', 'agent-a', 'proposal-b', key))
})
