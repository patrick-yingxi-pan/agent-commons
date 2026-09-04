import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isWorkItemCommentCreationId,
  workItemCommentCreationId,
} from './workItemCommentCreationIdentity.ts'

test('work-item comment identity is deterministic, fully scoped, and opaque', () => {
  const key = 'comment-key-that-must-not-leak'
  const first = workItemCommentCreationId('tenant-a', 'project-a', 'work-a', key)
  assert.equal(first, workItemCommentCreationId('tenant-a', 'project-a', 'work-a', key))
  assert.notEqual(first, workItemCommentCreationId('tenant-b', 'project-a', 'work-a', key))
  assert.notEqual(first, workItemCommentCreationId('tenant-a', 'project-b', 'work-a', key))
  assert.notEqual(first, workItemCommentCreationId('tenant-a', 'project-a', 'work-b', key))
  assert.match(first, /^work-comment-new-[a-f0-9]{24}$/)
  assert.equal(isWorkItemCommentCreationId(first), true)
  assert.equal(isWorkItemCommentCreationId('work-1-c1'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|work-a|comment-key/)
})
