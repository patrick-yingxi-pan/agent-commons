import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionReviewRequirementId as serverId } from '../../server/contributionReviewRequirementIdentity.ts'
import { contributionReviewRequirementId as browserId } from './contributionReviewRequirementIdentity.ts'

test('browser and server derive the same opaque Contribution review-requirement receipt', async () => {
  const input = ['tenant-review', 'project-review', 'contribution-review', 'require-key'] as const
  const expected = serverId(...input)
  assert.equal(await browserId(...input), expected)
  assert.match(expected, /^contribution-require-review-[a-f0-9]{24}$/)
})
