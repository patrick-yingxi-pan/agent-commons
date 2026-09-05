import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionEnvelopeProposalId,
  isContributionEnvelopeProposalId,
} from './contributionEnvelopeProposalIdentity.ts'

test('Contribution envelope proposal receipt identity is deterministic, scoped, and opaque', () => {
  const key = 'proposal-key-that-must-not-leak'
  const first = contributionEnvelopeProposalId('tenant-a', 'project-a', 'contribution-a', key)
  assert.equal(first, contributionEnvelopeProposalId('tenant-a', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionEnvelopeProposalId('tenant-b', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionEnvelopeProposalId('tenant-a', 'project-b', 'contribution-a', key))
  assert.notEqual(first, contributionEnvelopeProposalId('tenant-a', 'project-a', 'contribution-b', key))
  assert.match(first, /^contribution-envelope-proposal-[a-f0-9]{24}$/)
  assert.equal(isContributionEnvelopeProposalId(first), true)
  assert.equal(isContributionEnvelopeProposalId('contribution-envelope-proposal-nope'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-a|proposal-key/)
})
