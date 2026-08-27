/** The startup barrier: never infer a surface from half an answer, preserve a
 * fully resolved shell during refetches, and retry both authoritative reads. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APP_BOOTSTRAP_KEYS, resolveAppBootstrap } from './appBootstrap.ts'

const capabilities = { authGate: true }
const identity = { userId: 'user-1' }

test('application bootstrap distinguishes pending, failed, and fully resolved reads', () => {
  assert.deepEqual(resolveAppBootstrap(undefined, undefined, 'idle', 'idle'), { status: 'loading' })
  assert.deepEqual(resolveAppBootstrap(undefined, identity, 'loading', 'success'), { status: 'loading' })
  assert.deepEqual(resolveAppBootstrap(capabilities, undefined, 'success', 'loading'), { status: 'loading' })
  assert.deepEqual(resolveAppBootstrap(undefined, identity, 'error', 'success'), { status: 'error' })
  assert.deepEqual(resolveAppBootstrap(capabilities, undefined, 'success', 'error'), { status: 'error' })
  assert.deepEqual(resolveAppBootstrap(undefined, undefined, 'error', 'error'), { status: 'error' })
})

test('complete cached answers keep the usable shell ready during a failed refetch', () => {
  assert.deepEqual(resolveAppBootstrap(capabilities, identity, 'error', 'error'), {
    status: 'ready',
    capabilities,
    identity,
  })
})

test('retry reissues both reads that jointly decide the application surface', () => {
  assert.deepEqual(APP_BOOTSTRAP_KEYS, ['capabilities', 'me'])
})
