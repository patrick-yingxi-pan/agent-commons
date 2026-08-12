/** The auth flow's pure logic + shared primitives (src/lib/authFlow.ts,
 *  multi-account §12): the sign-up wizard's step machine, the password rule
 *  checklist (mirroring the server's 8–128 bound), the email shape mirror —
 *  and the form-follows-function lock: the full-screen AuthScreen wears the
 *  shared form primitives and no component re-hardcodes the input class
 *  literal. (Two steps since FWD-5 Phase 2 — the optional team-workspace step
 *  went with workspace multiplicity.) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import {
  AUTH_INPUT_CLASS,
  EMAIL_SHAPE,
  EMPTY_SIGNUP,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SIGNUP_STEPS,
  passwordChecks,
  passwordOk,
  stepAfter,
  stepBefore,
  stepValid,
} from './authFlow.ts'

test('the step machine walks details → password and back (no workspace step — FWD-5 Phase 2)', () => {
  assert.deepEqual([...SIGNUP_STEPS], ['details', 'password'])
  assert.equal(stepAfter('details'), 'password')
  assert.equal(stepAfter('password'), null, 'the last step submits, it does not advance')
  assert.equal(stepBefore('details'), null)
  assert.equal(stepBefore('password'), 'details')
})

test('step gates: details needs a name + a plausible email; password needs the rules', () => {
  assert.equal(stepValid('details', EMPTY_SIGNUP), false)
  assert.equal(stepValid('details', { ...EMPTY_SIGNUP, name: '  ', email: 'a@b.co' }), false, 'whitespace is not a name')
  assert.equal(stepValid('details', { ...EMPTY_SIGNUP, name: 'Ada', email: 'not-an-email' }), false)
  assert.equal(stepValid('details', { ...EMPTY_SIGNUP, name: 'Ada', email: 'ada@acme.example' }), true)
  assert.equal(stepValid('password', { ...EMPTY_SIGNUP, password: 'short' }), false)
  assert.equal(stepValid('password', { ...EMPTY_SIGNUP, password: 'long-enough-1' }), true)
})

test('the password checklist mirrors the server bound (8–128) and ticks live', () => {
  assert.equal(PASSWORD_MIN, 8)
  assert.equal(PASSWORD_MAX, 128)
  const short = passwordChecks('seven77')
  assert.deepEqual(short.map((c) => c.ok), [false, true])
  const good = passwordChecks('a'.repeat(8))
  assert.deepEqual(good.map((c) => c.ok), [true, true])
  const monster = passwordChecks('a'.repeat(129))
  assert.deepEqual(monster.map((c) => c.ok), [true, false], 'bounded above — scrypt cost scales with input')
  assert.equal(passwordOk('a'.repeat(8)), true)
  assert.equal(passwordOk('a'.repeat(129)), false)
})

test('the email shape mirrors the server rule', () => {
  const serverRoutes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const m = serverRoutes.match(/EMAIL_SHAPE = (\/[^\n]+\/)/)
  assert.ok(m, 'the server still declares its EMAIL_SHAPE')
  assert.equal(String(EMAIL_SHAPE), m![1], 'client and server agree on the shape (hint-level, server remains the gate)')
})

test('form follows function: the auth surface wears the shared primitives; nobody re-hardcodes them', () => {
  const screen = stripComments(read(join(ROOT, 'src', 'components', 'auth', 'AuthScreen.tsx')))
  assert.match(screen, /from\s+'(\.\.\/)+lib\/authFlow'/, 'AuthScreen imports the shared module')
  for (const token of ['AUTH_INPUT_CLASS', 'AUTH_PRIMARY_CLASS', 'AUTH_ERROR_CLASS']) {
    assert.ok(screen.includes(token), `AuthScreen wears ${token}`)
  }
  // The literal lives ONCE, in the lib module — a re-hardcoded copy would drift.
  const needle = AUTH_INPUT_CLASS.slice(0, 40)
  for (const rel of [
    ['src', 'components', 'auth', 'AuthScreen.tsx'],
    ['src', 'components', 'AccountMenu.tsx'],
  ] as const) {
    assert.ok(!stripComments(read(join(ROOT, ...rel))).includes(needle), `${rel.join('/')} does not inline the literal`)
  }
})
