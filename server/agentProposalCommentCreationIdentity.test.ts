import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentProposalCommentCreationId,
  isAgentProposalCommentCreationId,
} from './agentProposalCommentCreationIdentity.ts'

test('Agent proposal comment identity is deterministic, scoped, and opaque', () => {
  const key = 'comment-key-that-must-not-leak'
  const id = agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-a', key)
  assert.equal(id, agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-a', key))
  assert.match(id, /^agent-proposal-comment-new-[a-f0-9]{24}$/)
  assert.equal(isAgentProposalCommentCreationId(id), true)
  assert.notEqual(id, agentProposalCommentCreationId('tenant-b', 'agent-a', 'proposal-a', key))
  assert.notEqual(id, agentProposalCommentCreationId('tenant-a', 'agent-b', 'proposal-a', key))
  assert.notEqual(id, agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-b', key))
  assert.notEqual(id, agentProposalCommentCreationId('tenant-a', 'agent-a', 'proposal-a', 'another-key'))
  assert.doesNotMatch(id, /tenant-a|agent-a|proposal-a|comment-key/)
  assert.equal(isAgentProposalCommentCreationId('agent-proposal-comment-new-not-a-key'), false)
})
