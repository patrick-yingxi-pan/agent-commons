import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountCreationIds,
  isAccountCreationTenantId,
  isAccountCreationUserId,
} from './accountCreationIdentity.ts'

test('account creation binds one opaque user and namespace pair to source plus logical key', () => {
  const first = accountCreationIds('session:user-ada', 'logical-signup-1')
  assert.deepEqual(first, accountCreationIds('session:user-ada', 'logical-signup-1'))
  assert.notDeepEqual(first, accountCreationIds('session:user-grace', 'logical-signup-1'))
  assert.notDeepEqual(first, accountCreationIds('session:user-ada', 'logical-signup-2'))
  assert.ok(isAccountCreationUserId(first.userId))
  assert.ok(isAccountCreationTenantId(first.tenantId))
  assert.notEqual(first.userId, first.tenantId)
})
