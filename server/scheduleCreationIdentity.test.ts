import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleCreationId } from './scheduleCreationIdentity.ts'

test('routine creation identity is tenant-scoped, deterministic, opaque, and bounded', () => {
  const first = scheduleCreationId('tenant-one', 'logical-routine-one')
  assert.equal(first, scheduleCreationId('tenant-one', 'logical-routine-one'))
  assert.notEqual(first, scheduleCreationId('tenant-one', 'logical-routine-two'))
  assert.notEqual(first, scheduleCreationId('tenant-two', 'logical-routine-one'))
  assert.match(first, /^s-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-one|logical-routine-one/)
})
