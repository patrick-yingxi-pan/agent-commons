import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'

test('failed lazy-load Dismiss hands off in FIFO order and final removal becomes idle', () => {
  const failures = createRuntimeLoadFailureTracker()
  assert.equal(failures.fail('first'), 'first')
  assert.equal(failures.fail('second'), 'first', 'later failures cannot steal the visible recovery identity')
  assert.deepEqual(failures.status(2, 'load failed'), {
    busy: false, error: 'load failed', retryable: true, activeResourceId: 'first', pendingCount: 2,
  })
  assert.equal(failures.remove('first', ['second']), 'second')
  assert.equal(failures.status(1, 'load failed').activeResourceId, 'second')
  assert.equal(failures.remove('second', []), null)
  assert.deepEqual(failures.status(0, 'load failed'), {
    busy: false, error: null, retryable: false, activeResourceId: null, pendingCount: 0,
  }, 'removing the final failed load resets the global recovery surface')
  assert.equal(failures.fail('retryable'), 'retryable')
  failures.retry()
  assert.equal(failures.active(), null, 'explicit Retry clears the failed-load gate before a fresh load')
})
