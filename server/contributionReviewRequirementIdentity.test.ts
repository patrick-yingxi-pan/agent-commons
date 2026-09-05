import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionReviewRequirementId,
  isContributionReviewRequirementId,
} from './contributionReviewRequirementIdentity.ts'

test('Contribution review-requirement receipt identity is deterministic, scoped, and opaque', () => {
  const id = contributionReviewRequirementId('tenant-a', 'project-a', 'contribution-a', 'retry-key')
  assert.equal(id, contributionReviewRequirementId('tenant-a', 'project-a', 'contribution-a', 'retry-key'))
  assert.match(id, /^contribution-require-review-[a-f0-9]{24}$/)
  assert.equal(isContributionReviewRequirementId(id), true)
  assert.notEqual(id, contributionReviewRequirementId('tenant-b', 'project-a', 'contribution-a', 'retry-key'))
  assert.notEqual(id, contributionReviewRequirementId('tenant-a', 'project-b', 'contribution-a', 'retry-key'))
  assert.notEqual(id, contributionReviewRequirementId('tenant-a', 'project-a', 'contribution-b', 'retry-key'))
  assert.notEqual(id, contributionReviewRequirementId('tenant-a', 'project-a', 'contribution-a', 'another-key'))
  assert.doesNotMatch(id, /tenant|project-a|contribution-a|retry-key/)
  assert.equal(isContributionReviewRequirementId('contribution-require-review-not-a-receipt'), false)
})
