import test from 'node:test'
import assert from 'node:assert/strict'
import { isWorkItemRetractionId, workItemRetractionId } from './workItemRetractionIdentity.ts'

test('work-item retraction identity is deterministic, fully scoped, and opaque', () => {
  const key = 'retract-key-that-must-not-leak'
  const first = workItemRetractionId('tenant-a', 'project-a', 'work-a', key)
  assert.equal(first, workItemRetractionId('tenant-a', 'project-a', 'work-a', key))
  assert.notEqual(first, workItemRetractionId('tenant-b', 'project-a', 'work-a', key))
  assert.notEqual(first, workItemRetractionId('tenant-a', 'project-b', 'work-a', key))
  assert.notEqual(first, workItemRetractionId('tenant-a', 'project-a', 'work-b', key))
  assert.match(first, /^work-retract-[a-f0-9]{24}$/)
  assert.equal(isWorkItemRetractionId(first), true)
  assert.equal(isWorkItemRetractionId('work-new-deadbeef'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|work-a|retract-key/)
})
