/** Real accounts (multi-account P7): onboarding creates persisted users with a
 *  scrypt credential and signs them in on the P6 cookie; login never leaks
 *  account existence; workspaces are memberships you can re-mint into; the dev
 *  switcher directory never lists an onboarded account; a stale credential
 *  resolves to nothing; and the whole registry survives the persistence
 *  round-trip — hash included. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { accounts, AccountRegistry } from '../server/accounts.ts'
import { signSession, SESSION_COOKIE } from '../server/auth.ts'

const cookieOf = (setCookie: string | undefined) => setCookie?.split(';')[0] ?? ''

test('signup creates the account + personal workspace and signs it in; the credential is scrypt, never plaintext', async () => {
  const res = await call('POST', '/auth/signup', { name: 'Nia Wells', email: 'nia@example.test', password: 'correct-horse-9' })
  assert.equal(res.status, 200)
  assert.ok(res.headers['set-cookie']?.startsWith(`${SESSION_COOKIE}=`), 'signed in immediately')
  assert.equal(res.json.user.name, 'Nia Wells')
  assert.equal(res.json.user.email, 'nia@example.test')
  assert.equal(res.json.tenant.kind, 'personal')
  assert.equal(res.json.role, 'owner', 'owner of their own personal workspace')
  assert.equal(res.headers['x-resolved-tenant'], res.json.tenant.id)

  // The cookie IS the identity from here on.
  const me = await call('GET', '/me', undefined, { cookie: cookieOf(res.headers['set-cookie']) })
  assert.equal(me.json.user.id, res.json.user.id)

  // Credential posture: per-user salt, scrypt hash, nothing readable.
  const stored = accounts.findByEmail('nia@example.test')!
  assert.ok(stored.passwordSalt && stored.passwordSalt.length >= 32, 'a real random salt')
  assert.ok(stored.passwordHash && stored.passwordHash.length === 128, 'a 64-byte scrypt hash, hex')
  assert.ok(!JSON.stringify(stored).includes('correct-horse-9'), 'the password never appears in the stored record')
})

test('signup validation: shape 400s, duplicate email 409s', async () => {
  assert.equal((await call('POST', '/auth/signup', { name: '', email: 'a@b.co', password: 'longenough1' })).status, 400)
  assert.equal((await call('POST', '/auth/signup', { name: 'X', email: 'not-an-email', password: 'longenough1' })).status, 400)
  assert.equal((await call('POST', '/auth/signup', { name: 'X', email: 'x@y.co', password: 'short' })).status, 400)
  assert.equal(
    (await call('POST', '/auth/signup', { name: 'X', email: 'x2@y.co', password: 'p'.repeat(200) })).status,
    400,
    'bounded above too — scrypt cost scales with input length',
  )
  await call('POST', '/auth/signup', { name: 'First', email: 'dup@example.test', password: 'longenough1' })
  const dup = await call('POST', '/auth/signup', { name: 'Second', email: 'dup@example.test', password: 'longenough2' })
  assert.equal(dup.status, 409, 'one account per email')
})

test('login: right credential signs in; wrong password and unknown email are INDISTINGUISHABLE 401s', async () => {
  await call('POST', '/auth/signup', { name: 'Login Larry', email: 'larry@example.test', password: 'larrys-password-1' })

  const ok = await call('POST', '/auth/login', { email: 'larry@example.test', password: 'larrys-password-1' })
  assert.equal(ok.status, 200)
  assert.ok(ok.headers['set-cookie']?.startsWith(`${SESSION_COOKIE}=`))
  assert.equal(ok.json.user.email, 'larry@example.test')

  const wrongPw = await call('POST', '/auth/login', { email: 'larry@example.test', password: 'not-his-password' })
  const noSuchUser = await call('POST', '/auth/login', { email: 'ghost@example.test', password: 'whatever-123' })
  assert.equal(wrongPw.status, 401)
  assert.equal(noSuchUser.status, 401)
  assert.deepEqual(wrongPw.json, noSuchUser.json, 'byte-identical failures — account existence must not leak')

  // Seeded users have no credential: logging in as one fails the same way.
  const seed = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'anything-at-all' })
  assert.equal(seed.status, 401)
})

test('workspaces: create under your account, list your memberships, re-mint into one — and only one you hold', async () => {
  const signup = await call('POST', '/auth/signup', { name: 'Wanda Ws', email: 'wanda@example.test', password: 'wandas-password-1' })
  const cookie = cookieOf(signup.headers['set-cookie'])

  const created = await call('POST', '/workspaces', { name: 'Wanda Research' }, { cookie })
  assert.equal(created.status, 201)
  assert.equal(created.json.kind, 'org')

  const mine = await call('GET', '/me/workspaces', undefined, { cookie })
  assert.equal(mine.json.length, 2, 'personal + the new org')
  assert.ok(mine.json.some((w: any) => w.tenant.id === created.json.id && w.role === 'owner'))

  // Re-mint the session into the new workspace (the switcher's real-account path).
  const switched = await call('POST', '/auth/session', { tenantId: created.json.id }, { cookie })
  assert.equal(switched.status, 200)
  assert.equal(switched.json.tenant.id, created.json.id)
  assert.equal(switched.json.role, 'owner')
  assert.equal(switched.json.user.email, 'wanda@example.test')

  // A DIFFERENT principal (the backend default — no cookie) holds no membership
  // there: the re-mint is refused, so workspaces aren't enumerable-by-switching.
  const foreign = await call('POST', '/auth/session', { tenantId: created.json.id })
  assert.equal(foreign.status, 400)
})

test('the dev switcher directory NEVER lists onboarded accounts', async () => {
  await call('POST', '/auth/signup', { name: 'Secret Sam', email: 'sam@example.test', password: 'sams-password-11' })
  const ids = await call('GET', '/identities')
  assert.ok(!JSON.stringify(ids.json).includes('sam@example.test'), 'no email leak')
  assert.ok(!JSON.stringify(ids.json).includes('Secret Sam'), 'real accounts are not enumerable — they sign in')
  assert.ok((ids.json as any[]).every((i) => i.userId === 'user-local'), 'the mock directory stays the seeded workspaces')
})

test('a stale credential (user that no longer exists) resolves to NOTHING, not a guess', async () => {
  const ghostCookie = `${SESSION_COOKIE}=${signSession({ userId: 'user-deleted', tenantId: 'tenant-gone', iat: Date.now() })}`
  const me = await call('GET', '/me', undefined, { cookie: ghostCookie })
  assert.equal(me.json.user.id, 'user-local', 'falls through to the backend default (the cookie names nobody)')
  assert.equal(me.json.tenant.id, 'tenant-personal')
})

test('the registry survives the persistence round-trip — credential and memberships intact; seeds re-ensured', async () => {
  await call('POST', '/auth/signup', { name: 'Persist Pat', email: 'pat@example.test', password: 'pats-password-99' })
  const patId = accounts.findByEmail('pat@example.test')!.id

  // Round-trip through the persisted faces (what a restart does).
  const slices = accounts.toPersisted()
  const reborn = new AccountRegistry()
  reborn.rehydrate({ users: slices.users, tenants: slices.tenants, memberships: slices.memberships, seq: slices.seq })

  assert.ok(reborn.verifyPassword('pat@example.test', 'pats-password-99'), 'the scrypt hash survived the restart')
  assert.equal(reborn.verifyPassword('pat@example.test', 'wrong'), null)
  assert.equal(reborn.workspacesOf(patId).length, accounts.workspacesOf(patId).length, 'memberships intact')
  assert.ok(reborn.users.get('user-local') && reborn.users.get('user-ada'), 'seeds present after rehydrate')

  // A PRE-P7 snapshot (no account slices): rehydrate keeps the seeds untouched.
  const preP7 = new AccountRegistry()
  const before = preP7.users.size
  preP7.rehydrate({})
  assert.equal(preP7.users.size, before, 'absent slices are a no-op — the seed directory stays')
})
