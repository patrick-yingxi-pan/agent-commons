/** Ambient-sync health policy (SYNC-10): errors stay visible across reconnect
 * construction and only an identity-validated hello restores the live state. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAmbientSyncHealthStore,
  nextAmbientSyncHealth,
  type AmbientSyncHealth,
  type AmbientSyncSignal,
} from './syncHealth.ts'

test('only hello earns live; reconnect construction never clears a warning', () => {
  const cases: Array<[AmbientSyncHealth, AmbientSyncSignal, AmbientSyncHealth]> = [
    ['connecting', 'connect', 'connecting'],
    ['connecting', 'error', 'recovering'],
    ['recovering', 'connect', 'recovering'],
    ['recovering', 'error', 'recovering'],
    ['recovering', 'hello', 'live'],
    ['live', 'error', 'recovering'],
    ['live', 'hello', 'live'],
    ['recovering', 'account-switch', 'connecting'],
    ['live', 'account-switch', 'connecting'],
  ]
  for (const [current, signal, expected] of cases) {
    assert.equal(nextAmbientSyncHealth(current, signal), expected, `${current} + ${signal}`)
  }
})

test('the store publishes real transitions once and unsubscribe is final', () => {
  const store = createAmbientSyncHealthStore()
  const seen: AmbientSyncHealth[] = []
  const off = store.subscribe(() => seen.push(store.getSnapshot()))

  store.signal('connect') // connecting → connecting: no render churn
  store.signal('error')
  store.signal('error') // recovering → recovering: no duplicate announcement
  store.signal('connect') // constructing a retry does not hide the warning
  store.signal('hello')
  off()
  store.signal('error')

  assert.deepEqual(seen, ['recovering', 'live'])
  assert.equal(store.getSnapshot(), 'recovering')
})
