import test from 'node:test'
import assert from 'node:assert/strict'
import { isOpenWorkCreationId, openWorkCreationId } from './openWorkCreationIdentity.ts'

test('open-work identity is deterministic, tenant-and-Project scoped, and opaque', () => {
  const key = 'open-work-key-that-must-not-leak'
  const first = openWorkCreationId('tenant-a', 'project-a', key)
  assert.equal(first, openWorkCreationId('tenant-a', 'project-a', key))
  assert.notEqual(first, openWorkCreationId('tenant-b', 'project-a', key))
  assert.notEqual(first, openWorkCreationId('tenant-a', 'project-b', key))
  assert.match(first, /^work-new-[a-f0-9]{24}$/)
  assert.equal(isOpenWorkCreationId(first), true)
  assert.equal(isOpenWorkCreationId('work-17'), false)
  assert.doesNotMatch(first, /tenant-a|project-a|open-work-key/)
})
