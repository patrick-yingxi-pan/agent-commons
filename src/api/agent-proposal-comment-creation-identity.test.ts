import test from 'node:test'
import assert from 'node:assert/strict'
import { agentProposalCommentCreationId } from './agentProposalCommentCreationIdentity.ts'

test('browser Agent proposal comment identity matches the server format and authority scope', async () => {
  const key = 'comment-key-that-must-not-leak'
  const id = await agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-a', key)
  assert.equal(id, await agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-a', key))
  assert.match(id, /^agent-proposal-comment-new-[a-f0-9]{24}$/)
  assert.notEqual(id, await agentProposalCommentCreationId('tenant-b', 'agent-a', 'proposal-a', key))
  assert.notEqual(id, await agentProposalCommentCreationId('tenant-a', 'agent-b', 'proposal-a', key))
  assert.notEqual(id, await agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-b', key))
  assert.doesNotMatch(id, /tenant-a|agent-a|proposal-a|comment-key/)
})
