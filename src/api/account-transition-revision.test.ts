import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthAccount, Identity } from '../../contract/index.ts'
import {
  accountTransitionTerminal,
  visibleAccountTransition,
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

test('credential entry retries only under its source and adopts exact email truth', () => {
  const signIn = intent({
    kind: 'credential-sign-in',
    sourceUserId: 'ada',
    email: ' GRACE@EXAMPLE.COM ',
    password: 'private-login-password',
  })
  assert.equal(accountTransitionTerminal(signIn, {
    identity: identity('ada'), accounts: [account('ada', true), account('grace')],
  }), null)
  assert.deepEqual(accountTransitionTerminal(signIn, {
    identity: identity('grace'), accounts: [account('ada'), account('grace', true)],
  }), { kind: 'identity', identity: identity('grace'), reason: 'desired' })
  assert.deepEqual(accountTransitionTerminal(signIn, {
    identity: identity('linus'), accounts: [account('linus', true)],
  }), { kind: 'identity', identity: identity('linus'), reason: 'superseded' })

  const signUp = intent({
    kind: 'credential-sign-up',
    sourceUserId: null,
    name: 'New Person',
    email: 'new@example.com',
    password: 'private-signup-password',
  })
  const signedOut = identity('default', 'default')
  assert.equal(accountTransitionTerminal(signUp, { identity: signedOut, accounts: [] }), null)
  const created = identity('new')
  assert.deepEqual(accountTransitionTerminal(signUp, { identity: created, accounts: [account('new', true)] }), {
    kind: 'identity', identity: created, reason: 'desired',
  })
})

test('the visible held transition never projects credential fields or its logical key', () => {
  const transition = intent({
    kind: 'credential-sign-up',
    sourceUserId: 'ada',
    name: 'Private Person',
    email: 'private@example.com',
    password: 'do-not-project',
  })
  assert.deepEqual(visibleAccountTransition(transition), { kind: 'credential-sign-up' })
  assert.doesNotMatch(JSON.stringify(visibleAccountTransition(transition)), /private|do-not-project|intent-1/i)
})
