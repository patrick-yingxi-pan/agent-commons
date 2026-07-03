/** The client account layer's pure policy (multi-account design §6.1–6.2,
 *  invariant I5; P6: verified). Since P6 identity rides the HttpOnly session
 *  cookie — there are no client-side identity injectors to test anymore. What
 *  remains client-side, and what this locks: the generation staleness fence,
 *  the identity-echo tripwire, and the switch choreography (generation bump +
 *  subscriber notification). src/api/account.ts is framework-free by design so
 *  this suite can lock it directly under node. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldDropResponse,
  activeAccount,
  accountGeneration,
  switchAccount,
  refreshAccount,
  onAccountSwitch,
} from '../src/api/account.ts'

const ada = { userId: 'user-ada', tenantId: 'tenant-acme' }
const bo = { userId: 'user-grace', tenantId: 'tenant-beta' }

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
  assert.deepEqual(shouldDropResponse(1, 1, null, 'tenant-anything'), { drop: false }, 'never switched: whatever the session cookie resolves IS the account')
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

    switchAccount({ ...ada })
    assert.equal(accountGeneration(), gen0 + 1, 'switching to the SAME account is a no-op (no spurious cache reset)')
    assert.equal(notified, 1)

    switchAccount(bo)
    assert.equal(accountGeneration(), gen0 + 2)
    assert.equal(notified, 2)

    switchAccount(null)
    assert.equal(activeAccount(), null, 'null = back to whatever the session/backend default resolves')
    assert.equal(accountGeneration(), gen0 + 3)
    assert.equal(notified, 3)

    // refreshAccount bypasses the no-op guard: the SERVER session changed even
    // though the belief didn't (the reload-then-sign-out case, P7).
    refreshAccount(null)
    assert.equal(accountGeneration(), gen0 + 4, 'a session-changing op always bumps')
    assert.equal(notified, 4, '…and always notifies (the stream must re-bind to the new cookie)')
  } finally {
    off()
    switchAccount(null)
  }
})
