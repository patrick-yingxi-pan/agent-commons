import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionCreationId } from './contributionCreationIdentity.ts'

test('Contribution creation identity is deterministic, tenant-and-Project scoped, and opaque', () => {
  const key = 'contribution-key-that-must-not-leak'
  const first = contributionCreationId('tenant-a', 'project-a', key)
  assert.equal(first, contributionCreationId('tenant-a', 'project-a', key))
  assert.notEqual(first, contributionCreationId('tenant-b', 'project-a', key))
  assert.notEqual(first, contributionCreationId('tenant-a', 'project-b', key))
  assert.match(first, /^contrib-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|project-a|contribution-key/)
})
