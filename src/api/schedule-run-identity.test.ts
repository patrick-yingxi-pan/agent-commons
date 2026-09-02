import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manualScheduleRunId as browserRunId } from './scheduleRunIdentity.ts'
import { manualScheduleRunId as serverRunId } from '../../server/scheduleRunIdentity.ts'

test('browser reconciliation and the server derive the same opaque manual-run identity', async () => {
  const key = 'a-logical-run-key-that-must-not-be-exposed'
  const expected = serverRunId(key)
  assert.equal(await browserRunId(key), expected)
  assert.doesNotMatch(expected, new RegExp(key))
})
