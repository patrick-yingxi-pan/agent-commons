import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionReviewId as serverId } from '../../server/contributionReviewIdentity.ts'
import { contributionReviewId as browserId } from './contributionReviewIdentity.ts'

test('browser and server derive the same opaque Contribution review receipt', async () => {
  const input = ['tenant-review', 'project-review', 'contribution-review', 'review-key'] as const
  const expected = serverId(...input)
  assert.equal(await browserId(...input), expected)
  assert.match(expected, /^contribution-review-[a-f0-9]{24}$/)
})
