import test from 'node:test'
import assert from 'node:assert/strict'
import {
  delegationRevocationId,
  isDelegationRevocationId,
} from './delegationRevocationIdentity.ts'

test('Delegation revocation identity is deterministic, scoped, and opaque', () => {
  const id = delegationRevocationId('tenant-a', 'project-a', 'delegation-a', 'retry-key')
  assert.equal(id, delegationRevocationId('tenant-a', 'project-a', 'delegation-a', 'retry-key'))
  assert.match(id, /^delegation-revoke-[a-f0-9]{24}$/)
  assert.equal(isDelegationRevocationId(id), true)
  assert.notEqual(id, delegationRevocationId('tenant-b', 'project-a', 'delegation-a', 'retry-key'))
  assert.notEqual(id, delegationRevocationId('tenant-a', 'project-b', 'delegation-a', 'retry-key'))
  assert.notEqual(id, delegationRevocationId('tenant-a', 'project-a', 'delegation-b', 'retry-key'))
  assert.notEqual(id, delegationRevocationId('tenant-a', 'project-a', 'delegation-a', 'another-key'))
  assert.doesNotMatch(id, /tenant|project-a|delegation-a|retry-key/)
  assert.equal(isDelegationRevocationId('delegation-revoke-not-a-receipt'), false)
})
