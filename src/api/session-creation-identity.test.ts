import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionCreationId as browserSessionId } from './sessionCreationIdentity.ts'
import { sessionCreationId as serverSessionId } from '../../server/sessionCreationIdentity.ts'

test('browser reconciliation and server creation derive the same tenant-scoped Session identity', async () => {
  const tenantId = 'tenant-one'
  const key = 'a-logical-discussion-handoff-key-that-must-not-be-exposed'
  assert.equal(await browserSessionId(tenantId, key), serverSessionId(tenantId, key))
})
