import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manualDispatchRunId as browserRunId } from './dispatchIdentity.ts'
import { manualDispatchRunId as serverRunId } from '../../server/dispatchIdentity.ts'

test('browser reconciliation and the server derive the same tenant-scoped dispatch identity', async () => {
  const tenantId = 'tenant-one'
  const key = 'a-logical-dispatch-key-that-must-not-be-exposed'
  assert.equal(await browserRunId(tenantId, key), serverRunId(tenantId, key))
})
