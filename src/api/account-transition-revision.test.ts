import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthAccount, Identity } from '../../contract/index.ts'
import {
  accountTransitionTerminal,
  type AccountTransitionIntent,
} from './accountTransitionRevision.ts'

const identity = (id: string, via: Identity['via'] = 'session'): Identity => ({
  user: { id, name: id, email: `${id}@example.com` },
  tenant: { id: `tenant-${id}`, name: id, kind: 'personal' },
  role: 'owner',
  local: false,
  via,
})
const account = (id: string, current = false): AuthAccount => ({
  user: identity(id).user,
  tenant: identity(id).tenant,
  role: 'owner',
  current,
})
const intent = <T extends Omit<AccountTransitionIntent, 'intentId'>>(value: T): T & { intentId: string } =>
  ({ ...value, intentId: 'intent-1' })

test('account switch retries only while its source identity still owns the cookie', () => {
  const transition = intent({ kind: 'switch-account', sourceUserId: 'ada', targetUserId: 'grace', targetName: 'Grace' })
  assert.equal(accountTransitionTerminal(transition, { identity: identity('ada'), accounts: [account('ada', true), account('grace')] }), null)
  assert.deepEqual(accountTransitionTerminal(transition, { identity: identity('grace'), accounts: [account('ada'), account('grace', true)] }), {
    kind: 'identity', identity: identity('grace'), reason: 'desired',
  })
  assert.deepEqual(accountTransitionTerminal(transition, { identity: identity('linus'), accounts: [account('linus', true)] }), {
    kind: 'identity', identity: identity('linus'), reason: 'superseded',
  })
})

test('sign-out requires both an unsigned identity and the exact stack effect', () => {
  const transition = intent({ kind: 'sign-out', sourceUserId: 'ada', sourceName: 'Ada', all: false })
  assert.equal(accountTransitionTerminal(transition, { identity: identity('ada'), accounts: [account('ada', true)] }), null)
  assert.deepEqual(accountTransitionTerminal(transition, { identity: identity('default', 'default'), accounts: [] }), {
    kind: 'identity', identity: null, reason: 'desired',
  })
  assert.deepEqual(accountTransitionTerminal(transition, { identity: identity('grace'), accounts: [account('grace', true)] }), {
    kind: 'identity', identity: identity('grace'), reason: 'superseded',
  })
})

test('forget is terminal only under the same source identity with the target absent', () => {
  const transition = intent({ kind: 'forget-account', sourceUserId: 'ada', targetUserId: 'grace', targetName: 'Grace' })
  assert.equal(accountTransitionTerminal(transition, { identity: identity('ada'), accounts: [account('ada', true), account('grace')] }), null)
  assert.deepEqual(accountTransitionTerminal(transition, { identity: identity('ada'), accounts: [account('ada', true)] }), {
    kind: 'forgotten', userId: 'grace', reason: 'desired',
  })
  assert.deepEqual(accountTransitionTerminal(transition, { identity: identity('grace'), accounts: [account('grace', true)] }), {
    kind: 'identity', identity: identity('grace'), reason: 'superseded',
  })

  const unsigned = intent({ kind: 'forget-account', sourceUserId: null, targetUserId: 'grace', targetName: 'Grace' })
  const signedOut = identity('default', 'default')
  assert.equal(accountTransitionTerminal(unsigned, { identity: signedOut, accounts: [account('grace')] }), null)
  assert.deepEqual(accountTransitionTerminal(unsigned, { identity: signedOut, accounts: [] }), {
    kind: 'forgotten', userId: 'grace', reason: 'desired',
  })
})
