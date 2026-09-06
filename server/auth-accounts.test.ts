/** The account stack over the wire (multi-account §12): sign-in/up JOINS the
 *  stack cookie; `GET /v1/auth/accounts` lists what's remembered (strictly
 *  registry-resolved, current marked); `POST /v1/auth/session { userId }` hops
 *  to a remembered account WITHOUT a credential (and only to a remembered one);
 *  DELETE forgets the active account (others stay; `?all=1` forgets everything;
 *  `DELETE /v1/auth/accounts/:id` forgets ONE remembered account). The list is
 *  SIGN-IN ORDER, stable across switches — a hop refreshes in place.
 *  Also locks `Identity.via` on the wire and the `authGate` capability flag. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './testkit/http.ts'
import { signStack, verifyStack } from './auth.ts'
import { accounts } from './accounts.ts'

/** Extract cookies from the helper's comma-joined Set-Cookie capture. Our
 *  cookies carry no commas (Max-Age, not Expires), so the token regex is safe. */
const sess = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.match(/uw_session=([^;,]+)/)?.[1] ?? ''
const stackTok = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.match(/uw_accounts=([^;,]+)/)?.[1] ?? ''
const cookies = (r: { headers: Record<string, string> }) => `uw_session=${sess(r)}; uw_accounts=${stackTok(r)}`

const signup = (name: string, email: string, cookie?: string) =>
  call('POST', '/auth/signup', { name, email, password: `${name}-password-1` }, cookie ? { cookie } : undefined)

test('a sign-up joins the account stack; /auth/accounts lists it as current; /me says via=session', async () => {
  const a = await signup('Stack Ada', 'stack-a@example.test')
  assert.equal(a.status, 200)
  assert.ok(stackTok(a), 'signup sets the stack cookie alongside the session')

  const list = await call('GET', '/auth/accounts', undefined, { cookie: cookies(a) })
  assert.equal(list.status, 200)
  assert.equal(list.json.length, 1)
  assert.equal(list.json[0].user.name, 'Stack Ada')
  assert.equal(list.json[0].current, true)

  const me = await call('GET', '/me', undefined, { cookie: cookies(a) })
  assert.equal(me.json.via, 'session', 'a verified credential reads as signed in')

  const anon = await call('GET', '/me')
  assert.equal(anon.json.via, 'default', 'no credential, no assertion → the backend default')
})

test('a second sign-in stacks alongside the first; the bare-userId mint hops back without a credential', async () => {
  const a = await signup('Hop Ana', 'hop-a@example.test')
  const b = await signup('Hop Bea', 'hop-b@example.test', cookies(a))
  const aId = a.json.user.id as string

  const list = await call('GET', '/auth/accounts', undefined, { cookie: cookies(b) })
  assert.equal(list.json.length, 2)
  assert.deepEqual(
    list.json.map((r: { user: { name: string }; current: boolean }) => [r.user.name, r.current]),
    [['Hop Ana', false], ['Hop Bea', true]],
    'SIGN-IN order (Ana signed in first); only the active account is current',
  )

  // The instant hop: userId alone, no password — the stack cookie is the proof.
  const hop = await call('POST', '/auth/session', { userId: aId }, { cookie: cookies(b) })
  assert.equal(hop.status, 200)
  assert.equal(hop.json.user.id, aId)
  assert.equal(hop.json.via, 'session')
  assert.equal(hop.headers['x-resolved-tenant'], hop.json.tenant.id)

  // Without the stack cookie the same body is refused — a bare userId is not
  // a credential; nothing outside GET /v1/identities is mintable by name.
  const cold = await call('POST', '/auth/session', { userId: aId })
  assert.equal(cold.status, 400)

  // A userId the stack does not remember is refused even WITH a stack cookie.
  const ghost = await call('POST', '/auth/session', { userId: 'user-ghost' }, { cookie: cookies(b) })
  assert.equal(ghost.status, 400)
})

test('a hop back lands in the account’s ONE namespace — there is nowhere else (FWD-5 Phase 2)', async () => {
  const a = await signup('Tenant Tia', 'tenant-t@example.test')
  const aId = a.json.user.id as string
  const aNamespace = a.json.tenant.id as string

  // Stack a second account, then hop back: Tia lands in her namespace — the
  // stack entry's remembered tenant is derived, never trusted (a pre-collapse
  // cookie may carry an org tenant that no longer resolves).
  const b = await signup('Tenant Bo', 'tenant-b@example.test', cookies(a))
  const hop = await call('POST', '/auth/session', { userId: aId }, { cookie: cookies(b) })
  assert.equal(hop.status, 200)
  assert.equal(hop.json.tenant.id, aNamespace, 'the one namespace is the landing tenant')
})

test('sign-out forgets the ACTIVE account only; ?all=1 forgets everything', async () => {
  const a = await signup('Bye Aya', 'bye-a@example.test')
  const b = await signup('Bye Ben', 'bye-b@example.test', cookies(a))

  const out = await call('DELETE', '/auth/session', undefined, { cookie: cookies(b) })
  assert.equal(out.status, 204)
  assert.match(out.headers['set-cookie'], /uw_session=;/, 'the session clears')
  const remaining = verifyStack(stackTok(out))
  assert.equal(remaining.length, 1, "Ben's entry is forgotten; Aya's stays")
  assert.equal(remaining[0].userId, a.json.user.id)

  const outAll = await call('DELETE', '/auth/session?all=1', undefined, { cookie: cookies(b) })
  assert.equal(outAll.status, 204)
  assert.match(outAll.headers['set-cookie'], /uw_accounts=;/, 'the whole stack clears')
})

test('/auth/accounts resolves strictly: unknown users drop; the workspace re-mint arm is gone', async () => {
  // A validly-signed stack naming a user the registry never had: dropped, not guessed.
  const forged = signStack([{ userId: 'user-never-existed', tenantId: 'tenant-x', iat: Date.now() }])
  const list = await call('GET', '/auth/accounts', undefined, { cookie: `uw_accounts=${forged}` })
  assert.deepEqual(list.json, [])

  // The old credential-less workspace re-mint (a tenantId mint) is refused
  // loudly (FWD-5 Phase 2 / INV-9) — an account has exactly one namespace, so
  // the only credential-less mint left is the stack hop, which by construction
  // requires a stack the account already joined by signing in.
  const remint = await call('POST', '/auth/session', { tenantId: 'tenant-personal' })
  assert.equal(remint.status, 400, 'a tenantId mint is a caller bug, refused — never normalized')
})

test('seeds sign in like everyone else (P9 — the enumeration directory is gone): demo credentials, one namespace each', async () => {
  // The web principals carry DOCUMENTED demo credentials — the multi-tenancy
  // demo now walks through the REAL flow instead of a dev directory pick.
  const ada = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'ada-demo-password' })
  assert.equal(ada.status, 200)
  assert.equal(ada.json.user.id, 'user-ada')
  assert.equal(ada.json.tenant.id, 'tenant-acme', 'Ada lands in her namespace — the flagship world')
  assert.equal(ada.json.via, 'session', 'a seed sign-in is a verified session like any other')
  assert.ok(stackTok(ada), 'and it joins the account stack like any other')

  // Grace lands DIRECTLY in her one namespace (FWD-5 Phase 2 — her old second
  // seat on Acme is gone; cross-account collaboration is shared projects).
  const grace = await call('POST', '/auth/login', { email: 'grace@acme.example', password: 'grace-demo-password' }, { cookie: cookies(ada) })
  assert.equal(grace.status, 200)
  assert.equal(grace.json.user.id, 'user-grace')
  assert.equal(grace.json.tenant.id, 'tenant-beta')

  // Both seeds hop through the stack, credential-less — same as real accounts.
  const back = await call('POST', '/auth/session', { userId: 'user-ada' }, { cookie: cookies(grace) })
  assert.equal(back.status, 200)
  assert.equal(back.json.user.id, 'user-ada')
  assert.equal(back.json.tenant.id, 'tenant-acme')

  // The desktop's device owner deliberately has NO credential — it never signs in.
  const local = await call('POST', '/auth/login', { email: 'local@nowhere.example', password: 'anything-at-all' })
  assert.equal(local.status, 401)
})

test('the authGate capability flag follows AUTH_GATE (off by default)', async (t) => {
  const before = await call('GET', '/capabilities')
  assert.equal(before.json.features.authGate, false, 'the demo boots ungated by default')
  process.env.AUTH_GATE = 'require'
  t.after(() => {
    delete process.env.AUTH_GATE
  })
  const gated = await call('GET', '/capabilities')
  assert.equal(gated.json.features.authGate, true)
})

test('the stack keeps SIGN-IN ORDER across switches; DELETE /auth/accounts/:id forgets one row', async () => {
  const a = await signup('Order Ann', 'order-a@example.test')
  const b = await signup('Order Bob', 'order-b@example.test', cookies(a))
  const aId = a.json.user.id as string
  const bId = b.json.user.id as string

  // Hop back to Ann — the switch REFRESHES her entry in place; the list must
  // NOT reorder (the menu can't shuffle under the pointer).
  const hop = await call('POST', '/auth/session', { userId: aId }, { cookie: cookies(b) })
  assert.equal(hop.status, 200)
  const afterHop = await call('GET', '/auth/accounts', undefined, { cookie: cookies(hop) })
  assert.deepEqual(
    afterHop.json.map((r: { user: { name: string }; current: boolean }) => [r.user.name, r.current]),
    [['Order Ann', true], ['Order Bob', false]],
    'sign-in order survives the switch; only current moved',
  )

  // Forget BOB (not active): his row drops, Ann's SESSION is untouched.
  const forgetB = await call('DELETE', `/auth/accounts/${bId}`, undefined, { cookie: cookies(hop) })
  assert.equal(forgetB.status, 204)
  assert.ok(!forgetB.headers['set-cookie']!.includes('uw_session=;'), 'the active session cookie is not cleared')
  const afterForget = await call('GET', '/auth/accounts', undefined, {
    cookie: `uw_session=${sess(hop)}; uw_accounts=${stackTok(forgetB)}`,
  })
  assert.deepEqual(
    afterForget.json.map((r: { user: { name: string } }) => r.user.name),
    ['Order Ann'],
    'exactly the forgotten row dropped',
  )

  // An id the stack does not hold: the same idempotent 204, nothing changes.
  const noop = await call('DELETE', '/auth/accounts/user-nobody', undefined, {
    cookie: `uw_session=${sess(hop)}; uw_accounts=${stackTok(forgetB)}`,
  })
  assert.equal(noop.status, 204)
  assert.equal(verifyStack(stackTok(noop)).length, 1)

  // Forget the ACTIVE account: a full sign-out — the session clears with it.
  const forgetA = await call('DELETE', `/auth/accounts/${aId}`, undefined, {
    cookie: `uw_session=${sess(hop)}; uw_accounts=${stackTok(forgetB)}`,
  })
  assert.equal(forgetA.status, 204)
  assert.ok(forgetA.headers['set-cookie']!.includes('uw_session=;'), 'forgetting the active account signs it out')
  assert.equal(verifyStack(stackTok(forgetA)).length, 0)
})

test('first-party account transitions reject a stale source before touching a newer cookie', async () => {
  const a = await signup('Source Ada', 'source-a@example.test')
  const b = await signup('Source Bea', 'source-b@example.test', cookies(a))
  const aId = a.json.user.id as string
  const bId = b.json.user.id as string
  const stale = { cookie: cookies(b), 'x-account-transition-source': `session:${aId}` }

  const switchA = await call('POST', '/auth/session', { userId: aId }, stale)
  assert.equal(switchA.status, 409)
  assert.equal(switchA.headers['set-cookie'], undefined)

  const signOut = await call('DELETE', '/auth/session', undefined, stale)
  assert.equal(signOut.status, 409)
  assert.equal(signOut.headers['set-cookie'], undefined)

  const forgetA = await call('DELETE', `/auth/accounts/${aId}`, undefined, stale)
  assert.equal(forgetA.status, 409)
  assert.equal(forgetA.headers['set-cookie'], undefined)

  const login = await call('POST', '/auth/login', {
    email: 'source-a@example.test', password: 'Source Ada-password-1',
  }, stale)
  assert.equal(login.status, 409)
  assert.equal(login.headers['set-cookie'], undefined)

  const blockedEmail = 'source-stale-signup@example.test'
  const signupBlocked = await call('POST', '/auth/signup', {
    name: 'Blocked Signup', email: blockedEmail, password: 'blocked-password-1',
  }, { ...stale, 'idempotency-key': 'blocked-signup-key' })
  assert.equal(signupBlocked.status, 409)
  assert.equal(signupBlocked.headers['set-cookie'], undefined)
  assert.equal(accounts.findByEmail(blockedEmail), undefined)

  const current = await call('GET', '/auth/accounts', undefined, { cookie: cookies(b) })
  assert.deepEqual(
    current.json.map((row: { user: { id: string }; current: boolean }) => [row.user.id, row.current]),
    [[aId, false], [bId, true]],
    'all three stale actions leave the newer session and stack untouched',
  )

  const valid = await call('POST', '/auth/session', { userId: aId }, {
    cookie: cookies(b),
    'x-account-transition-source': `session:${bId}`,
  })
  assert.equal(valid.status, 200)
  assert.equal(valid.json.user.id, aId)
})
