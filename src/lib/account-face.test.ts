/** Lock: the SIGNED-IN account's face has ONE source (src/lib/accountFace.ts).
 *
 *  The rule it guards is a consequence of the identity model, not a style
 *  preference: FWD-5 Phase 2 collapsed account and namespace 1:1, and since
 *  2026-08-09 a seed namespace WEARS ITS PERSON'S NAME (server/accounts.ts). So
 *  an account row that prints `user.name` and `tenant.name` side by side prints
 *  the same name twice — "Ada Lovelace · Ada Lovelace". Three surfaces did
 *  exactly that (the rail chip, the switcher rows, the auth picker), each
 *  hand-rolling its own version, and every one of them read as two facts only
 *  because the seeds were misnamed after companies.
 *
 *  Both halves are locked, because either alone is defeatable: the FUNCTION's
 *  behaviour (below), and that the three surfaces route through it rather than
 *  reaching for `.tenant.name` themselves. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { accountSubtitle } from './accountFace.ts'

const ADA = { name: 'Ada Lovelace', email: 'ada@acme.example' }
const LOCAL = { name: 'You' }

test('accountSubtitle — the email, then the namespace only when it is not simply you', () => {
  // The collapsed case (every web seed): namespace === the person ⇒ say it once.
  assert.equal(accountSubtitle(ADA, { name: 'Ada Lovelace' }), 'ada@acme.example')
  // The desktop's credential-less local user: no email, and 'Personal' is a real
  // second fact about the seat, so it survives.
  assert.equal(accountSubtitle(LOCAL, { name: 'Personal' }), 'Personal')
  // An account acting in a namespace that ISN'T them (orgs, FWD-6) keeps both.
  assert.equal(accountSubtitle(ADA, { name: 'Acme, Inc.' }), 'ada@acme.example · Acme, Inc.')
  // Nothing more to say than the name already said ⇒ empty, and the caller
  // renders nothing rather than repeating it.
  assert.equal(accountSubtitle(LOCAL, { name: 'You' }), '')
  assert.equal(accountSubtitle(LOCAL, undefined), '')
})

test('account identity surfaces route through the funnel — none re-reaches for the namespace name', () => {
  for (const rel of [
    ['src', 'components', 'AccountChip.tsx'],
    ['src', 'components', 'AccountMenu.tsx'],
    ['src', 'components', 'auth', 'AuthScreen.tsx'],
  ]) {
    const file = join(ROOT, ...rel)
    const code = stripComments(read(file))
    assert.ok(code.includes('accountSubtitle('), `${file} must label accounts through accountSubtitle`)
    // The hand-rolled shape: an ACCOUNT row (`a.` from the stack, `me` from
    // /v1/me) reading the namespace name for itself. Org rows — `o.tenant.name`
    // in the Organizations section — are a different thing (an org's own name,
    // correctly rendered) and stay legal.
    for (const banned of ['a.tenant.name', 'me?.tenant.name', 'me.tenant.name']) {
      assert.ok(!code.includes(banned), `${file} must not read ${banned} — the funnel decides what an account row says`)
    }
  }
})
