import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionLandingId, isContributionLandingId } from './contributionLandingIdentity.ts'

test('Contribution landing identity is deterministic, fully scoped, and opaque', () => {
  const key = 'landing-key-that-must-not-leak'
  const first = contributionLandingId('tenant-a', 'project-a', 'contribution-a', key)
  assert.equal(first, contributionLandingId('tenant-a', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionLandingId('tenant-b', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionLandingId('tenant-a', 'project-b', 'contribution-a', key))
  assert.notEqual(first, contributionLandingId('tenant-a', 'project-a', 'contribution-b', key))
  assert.match(first, /^contribution-land-[a-f0-9]{24}$/)
  assert.equal(isContributionLandingId(first), true)
  assert.equal(isContributionLandingId('contribution-new-deadbeef'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-a|landing-key/)
})
