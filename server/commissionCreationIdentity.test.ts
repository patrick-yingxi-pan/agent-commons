import test from 'node:test'
import assert from 'node:assert/strict'
import { commissionCreationId } from './commissionCreationIdentity.ts'

test('commission creation identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'commission-create-key-that-must-not-leak'
  const first = commissionCreationId('tenant-a', key)
  assert.equal(first, commissionCreationId('tenant-a', key))
  assert.notEqual(first, commissionCreationId('tenant-b', key))
  assert.match(first, /^commission-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|commission-create-key/)
})
