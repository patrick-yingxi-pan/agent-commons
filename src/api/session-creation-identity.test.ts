import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sessionCreationId as browserSessionId,
  sessionForkCreationId as browserForkId,
} from './sessionCreationIdentity.ts'
import {
  sessionCreationId as serverSessionId,
  sessionForkCreationId as serverForkId,
} from '../../server/sessionCreationIdentity.ts'

test('browser reconciliation and server creation derive the same tenant-scoped Session identity', async () => {
  const tenantId = 'tenant-one'
  const key = 'a-logical-discussion-handoff-key-that-must-not-be-exposed'
  assert.equal(await browserSessionId(tenantId, key), serverSessionId(tenantId, key))
  assert.equal(await browserForkId(tenantId, key), serverForkId(tenantId, key))
  assert.notEqual(await browserForkId(tenantId, key), await browserSessionId(tenantId, key))
})
