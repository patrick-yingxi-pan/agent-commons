import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionEffectExecutionId,
  isContributionEffectExecutionId,
} from './contributionEffectExecutionIdentity.ts'

test('Contribution effect receipt identity is deterministic, fully scoped, and opaque', () => {
  const key = 'effect-key-that-must-not-leak'
  const first = contributionEffectExecutionId('tenant-a', 'project-a', 'contribution-a', key)
  assert.equal(first, contributionEffectExecutionId('tenant-a', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionEffectExecutionId('tenant-b', 'project-a', 'contribution-a', key))
  assert.notEqual(first, contributionEffectExecutionId('tenant-a', 'project-b', 'contribution-a', key))
  assert.notEqual(first, contributionEffectExecutionId('tenant-a', 'project-a', 'contribution-b', key))
  assert.match(first, /^contribution-effect-[a-f0-9]{24}$/)
  assert.equal(isContributionEffectExecutionId(first), true)
  assert.equal(isContributionEffectExecutionId('contribution-land-deadbeef'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-a|effect-key/)
})
