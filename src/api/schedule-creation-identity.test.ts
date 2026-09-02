import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleCreationId as browserScheduleId } from './scheduleCreationIdentity.ts'
import { scheduleCreationId as serverScheduleId } from '../../server/scheduleCreationIdentity.ts'

test('browser reconciliation and server creation derive the same tenant-scoped routine identity', async () => {
  const tenantId = 'tenant-one'
  const key = 'a-logical-routine-key-that-must-not-be-exposed'
  assert.equal(await browserScheduleId(tenantId, key), serverScheduleId(tenantId, key))
})
