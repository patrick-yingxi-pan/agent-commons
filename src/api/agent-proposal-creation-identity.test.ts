import test from 'node:test'
import assert from 'node:assert/strict'
import { agentProposalCreationId } from './agentProposalCreationIdentity.ts'

test('browser Agent proposal identity matches the server format and authority scope', async () => {
  const key = 'proposal-key-that-must-not-leak'
  const id = await agentProposalCreationId('tenant-a', 'agent-a', key)
  assert.equal(id, await agentProposalCreationId('tenant-a', 'agent-a', key))
  assert.match(id, /^agent-proposal-new-[a-f0-9]{24}$/)
  assert.notEqual(id, await agentProposalCreationId('tenant-b', 'agent-a', key))
  assert.notEqual(id, await agentProposalCreationId('tenant-a', 'agent-b', key))
  assert.doesNotMatch(id, /tenant-a|agent-a|proposal-key/)
})
