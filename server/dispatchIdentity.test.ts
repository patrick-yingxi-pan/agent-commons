import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manualDispatchRunId } from './dispatchIdentity.ts'

test('manual dispatch identity is tenant-scoped, deterministic, opaque, and bounded', () => {
  const first = manualDispatchRunId('tenant-one', 'logical-dispatch-one')
  assert.equal(first, manualDispatchRunId('tenant-one', 'logical-dispatch-one'))
  assert.notEqual(first, manualDispatchRunId('tenant-one', 'logical-dispatch-two'))
  assert.notEqual(first, manualDispatchRunId('tenant-two', 'logical-dispatch-one'))
  assert.match(first, /^d-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-one|logical-dispatch-one/)
})
