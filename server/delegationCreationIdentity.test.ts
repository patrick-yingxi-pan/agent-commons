import test from 'node:test'
import assert from 'node:assert/strict'
import { delegationCreationId, isDelegationCreationId } from './delegationCreationIdentity.ts'

test('Delegation creation identity is deterministic, tenant-and-Project scoped, and opaque', () => {
  const key = 'delegation-key-that-must-not-leak'
  const first = delegationCreationId('tenant-a', 'project-a', key)
  assert.equal(first, delegationCreationId('tenant-a', 'project-a', key))
  assert.equal(isDelegationCreationId(first), true)
  assert.notEqual(first, delegationCreationId('tenant-b', 'project-a', key))
  assert.notEqual(first, delegationCreationId('tenant-a', 'project-b', key))
  assert.equal(isDelegationCreationId('delegation-new-not-a-key'), false)
  assert.match(first, /^delegation-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|project-a|delegation-key/)
})
