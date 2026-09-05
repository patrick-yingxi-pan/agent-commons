import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionReviewId, isContributionReviewId } from './contributionReviewIdentity.ts'

test('Contribution review receipt identity is deterministic, scoped, and opaque', () => {
  const id = contributionReviewId('tenant-a', 'project-a', 'contribution-a', 'retry-key')
  assert.equal(id, contributionReviewId('tenant-a', 'project-a', 'contribution-a', 'retry-key'))
  assert.match(id, /^contribution-review-[a-f0-9]{24}$/)
  assert.equal(isContributionReviewId(id), true)
  assert.notEqual(id, contributionReviewId('tenant-b', 'project-a', 'contribution-a', 'retry-key'))
  assert.notEqual(id, contributionReviewId('tenant-a', 'project-b', 'contribution-a', 'retry-key'))
  assert.notEqual(id, contributionReviewId('tenant-a', 'project-a', 'contribution-b', 'retry-key'))
  assert.notEqual(id, contributionReviewId('tenant-a', 'project-a', 'contribution-a', 'another-key'))
  assert.doesNotMatch(id, /tenant|project-a|contribution-a|retry-key/)
  assert.equal(isContributionReviewId('contribution-review-not-a-receipt'), false)
})
