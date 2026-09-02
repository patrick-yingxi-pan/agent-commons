import test from 'node:test'
import assert from 'node:assert/strict'
import { discussionPostId as serverDiscussionPostId } from '../../server/discussionPostIdentity.ts'
import { discussionPostId } from './discussionPostIdentity.ts'

test('browser and server derive the same opaque social-post identity', async () => {
  const tenantId = 'tenant-post-parity'
  const key = 'social-post-parity-key'
  assert.equal(await discussionPostId(tenantId, key), serverDiscussionPostId(tenantId, key))
})
