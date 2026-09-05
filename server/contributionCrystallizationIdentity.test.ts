import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionCrystallizationId,
  isContributionCrystallizationId,
} from './contributionCrystallizationIdentity.ts'

test('Contribution crystallization receipt identity is deterministic, scoped, and opaque', () => {
  const key = 'crystallization-key-that-must-not-leak'
  const first = contributionCrystallizationId('tenant-a', 'project-a', 'contribution-a', key)
  assert.equal(first, contributionCrystallizationId('tenant-a', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionCrystallizationId('tenant-b', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionCrystallizationId('tenant-a', 'project-b', 'contribution-a', key))
  assert.notEqual(first, contributionCrystallizationId('tenant-a', 'project-a', 'contribution-b', key))
  assert.match(first, /^contribution-crystallization-[a-f0-9]{24}$/)
  assert.equal(isContributionCrystallizationId(first), true)
  assert.equal(isContributionCrystallizationId('contribution-effect-deadbeef'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-a|crystallization-key/)
})
