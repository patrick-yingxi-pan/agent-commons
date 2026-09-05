import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionEnvelopeApprovalId,
  isContributionEnvelopeApprovalId,
} from './contributionEnvelopeApprovalIdentity.ts'

test('Contribution envelope approval receipt identity is deterministic, scoped, and opaque', () => {
  const key = 'approval-key-that-must-not-leak'
  const first = contributionEnvelopeApprovalId('tenant-a', 'project-a', 'contribution-a', key)
  assert.equal(first, contributionEnvelopeApprovalId('tenant-a', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionEnvelopeApprovalId('tenant-b', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionEnvelopeApprovalId('tenant-a', 'project-b', 'contribution-a', key))
  assert.notEqual(first, contributionEnvelopeApprovalId('tenant-a', 'project-a', 'contribution-b', key))
  assert.match(first, /^contribution-envelope-approval-[a-f0-9]{24}$/)
  assert.equal(isContributionEnvelopeApprovalId(first), true)
  assert.equal(isContributionEnvelopeApprovalId('contribution-envelope-approval-nope'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-a|approval-key/)
})
