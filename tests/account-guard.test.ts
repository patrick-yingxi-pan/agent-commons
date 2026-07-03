/** The client account layer's pure policy (multi-account design §6.1–6.2,
 *  invariant I5): identity headers/query derivation, the generation staleness
 *  fence, the identity-echo tripwire, and the switch choreography (generation
 *  bump + subscriber notification). src/api/account.ts is framework-free by
 *  design so this suite can lock it directly under node. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountHeaders,
  accountQuery,
  shouldDropResponse,
  activeAccount,
  accountGeneration,
  switchAccount,
  onAccountSwitch,
} from '../src/api/account.ts'

const ada = { userId: 'user-ada', tenantId: 'tenant-acme' }
const bo = { userId: 'user-grace', tenantId: 'tenant-beta' }

test('accountHeaders / accountQuery: identity rides only when an override is active', () => {
  assert.deepEqual(accountHeaders(null), {}, 'no override → no headers (backend default, as before the layer)')
  assert.deepEqual(accountHeaders(ada), { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' })
  assert.deepEqual(accountQuery(null), [])
  assert.deepEqual(accountQuery(bo), [
    ['user', 'user-grace'],
    ['tenant', 'tenant-beta'],
  ])
})

test('shouldDropResponse: the truth table (generation fence first, then the echo tripwire)', () => {
  assert.deepEqual(shouldDropResponse(1, 1, ada, 'tenant-acme'), { drop: false }, 'same generation + matching echo: keep')
  assert.deepEqual(shouldDropResponse(1, 2, ada, 'tenant-acme'), { drop: true, reason: 'switched' }, 'the account moved mid-flight: drop')
  assert.deepEqual(
    shouldDropResponse(1, 2, ada, 'tenant-beta'),
    { drop: true, reason: 'switched' },
    'generation wins even when the echo also mismatches (the response is from the old world either way)',
  )
  assert.deepEqual(shouldDropResponse(1, 1, ada, 'tenant-beta'), { drop: true, reason: 'echo-mismatch' }, 'the server resolved a different tenant: drop LOUDLY')
  assert.deepEqual(shouldDropResponse(1, 1, ada, null), { drop: false }, 'no echo header (older server): generation still guards, nothing to assert')
  assert.deepEqual(shouldDropResponse(1, 1, null, 'tenant-anything'), { drop: false }, 'no active override: the backend default is whatever the server says')
})

test('switchAccount: bumps the generation, notifies subscribers, no-ops on the same account', () => {
  const gen0 = accountGeneration()
  let notified = 0
  const off = onAccountSwitch(() => {
    notified += 1
  })
  try {
    switchAccount(ada)
    assert.deepEqual(activeAccount(), ada)
    assert.equal(accountGeneration(), gen0 + 1, 'a switch bumps the generation')
    assert.equal(notified, 1)

    switchAccount({ ...ada }, )
    assert.equal(accountGeneration(), gen0 + 1, 'switching to the SAME account is a no-op (no spurious cache reset)')
    assert.equal(notified, 1)

    switchAccount(bo)
    assert.equal(accountGeneration(), gen0 + 2)
    assert.equal(notified, 2)

    switchAccount(null)
    assert.equal(activeAccount(), null, 'null restores the backend-default identity')
    assert.equal(accountGeneration(), gen0 + 3)
    assert.equal(notified, 3)
  } finally {
    off()
    switchAccount(null)
  }
})
