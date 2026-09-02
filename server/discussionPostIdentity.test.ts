import test from 'node:test'
import assert from 'node:assert/strict'
import { discussionPostId } from './discussionPostIdentity.ts'

test('social post identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'social-post-key-that-must-not-leak'
  const first = discussionPostId('tenant-a', key)
  assert.equal(first, discussionPostId('tenant-a', key))
  assert.notEqual(first, discussionPostId('tenant-b', key))
  assert.match(first, /^dpost-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|social-post-key/)
})
