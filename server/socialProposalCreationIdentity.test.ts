import test from 'node:test'
import assert from 'node:assert/strict'
import { socialProposalCreationId } from './socialProposalCreationIdentity.ts'

test('social Proposal creation identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'proposal-key-that-must-not-leak'
  const first = socialProposalCreationId('tenant-a', key)
  assert.equal(first, socialProposalCreationId('tenant-a', key))
  assert.notEqual(first, socialProposalCreationId('tenant-b', key))
  assert.match(first, /^sprop-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|proposal-key/)
})
