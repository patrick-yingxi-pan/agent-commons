import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionCommentCreationId,
  isContributionCommentCreationId,
} from './contributionCommentCreationIdentity.ts'

test('Contribution comment receipt identity is deterministic, scoped, and opaque', () => {
  const key = 'comment-key-that-must-not-leak'
  const first = contributionCommentCreationId('tenant-a', 'project-a', 'contribution-a', key)
  assert.equal(first, contributionCommentCreationId('tenant-a', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionCommentCreationId('tenant-b', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionCommentCreationId('tenant-a', 'project-b', 'contribution-a', key))
  assert.notEqual(first, contributionCommentCreationId('tenant-a', 'project-a', 'contribution-b', key))
  assert.match(first, /^contribution-comment-new-[a-f0-9]{24}$/)
  assert.equal(isContributionCommentCreationId(first), true)
  assert.equal(isContributionCommentCreationId('contribution-comment-new-nope'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-a|comment-key/)
})
