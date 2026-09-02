import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manualScheduleRunId } from './scheduleRunIdentity.ts'

test('manual run identity is deterministic, opaque, bounded, and key-sensitive', () => {
  const first = manualScheduleRunId('logical-run-one')
  assert.equal(first, manualScheduleRunId('logical-run-one'), 'one retry names the same durable run')
  assert.notEqual(first, manualScheduleRunId('logical-run-two'), 'distinct intent cannot alias')
  assert.match(first, /^run-manual-[a-f0-9]{24}$/, 'raw transport keys never enter the public run id')
})
