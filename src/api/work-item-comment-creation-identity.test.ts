import test from 'node:test'
import assert from 'node:assert/strict'
import { workItemCommentCreationId as serverIdentity } from '../../server/workItemCommentCreationIdentity.ts'
import { workItemCommentCreationId } from './workItemCommentCreationIdentity.ts'

test('browser and server derive the same opaque work-item comment identity', async () => {
  const coordinates = ['tenant-comment', 'project-comment', 'work-comment', 'comment-key'] as const
  assert.equal(await workItemCommentCreationId(...coordinates), serverIdentity(...coordinates))
})
