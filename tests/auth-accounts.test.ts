/** The account stack over the wire (multi-account §12): sign-in/up JOINS the
 *  stack cookie; `GET /v1/auth/accounts` lists what's remembered (strictly
 *  registry-resolved, current marked); `POST /v1/auth/session { userId }` hops
 *  to a remembered account WITHOUT a credential (and only to a remembered one);
 *  DELETE forgets the active account (others stay; `?all=1` forgets everything).
 *  Also locks `Identity.via` on the wire and the `authGate` capability flag. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { signStack, verifyStack } from '../server/auth.ts'

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
    [['Hop Bea', true], ['Hop Ana', false]],
    'newest first; only the active account is current',
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

test('the stack records the last-active tenant — a hop back lands where the account left off', async () => {
  const a = await signup('Tenant Tia', 'tenant-t@example.test')
  const aId = a.json.user.id as string

  // Create an org workspace (switches the registry, not the cookie) and re-mint
  // into it — the workspace path refreshes the stack entry's tenant.
  const ws = await call('POST', '/workspaces', { name: 'Tia Lab' }, { cookie: cookies(a) })
  assert.equal(ws.status, 201)
  const remint = await call('POST', '/auth/session', { userId: aId, tenantId: ws.json.id }, { cookie: cookies(a) })
  assert.equal(remint.status, 200)
  assert.equal(remint.json.tenant.id, ws.json.id)

  // Stack a second account, then hop back: Tia lands in the Lab, not personal.
  const b = await signup('Tenant Bo', 'tenant-b@example.test', cookies(remint))
  const hop = await call('POST', '/auth/session', { userId: aId }, { cookie: cookies(b) })
  assert.equal(hop.json.tenant.id, ws.json.id, 'the last-active workspace is the landing tenant')
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

test('/auth/accounts resolves strictly: unknown users drop; a workspace re-mint never joins the stack', async () => {
  // A validly-signed stack naming a user the registry never had: dropped, not guessed.
  const forged = signStack([{ userId: 'user-never-existed', tenantId: 'tenant-x', iat: Date.now() }])
  const list = await call('GET', '/auth/accounts', undefined, { cookie: `uw_accounts=${forged}` })
  assert.deepEqual(list.json, [])

  // A workspace re-mint (here: the desktop default principal moving into its
  // seeded work workspace — the membership path) mints a session but does NOT
  // join the stack: only CREDENTIALED sign-ins are "remembered on this browser".
  const remint = await call('POST', '/auth/session', { userId: 'user-local', tenantId: 'tenant-work' })
  assert.equal(remint.status, 200)
  assert.equal(stackTok(remint), '', 'no stack cookie for a credential-less re-mint')
  const after = await call('GET', '/auth/accounts', undefined, { cookie: cookies(remint) })
  assert.deepEqual(after.json, [])
})

test('seeds sign in like everyone else (P9 — the enumeration directory is gone): demo credentials, stack, workspaces', async () => {
  // The web principals carry DOCUMENTED demo credentials — the multi-tenancy
  // demo now walks through the REAL flow instead of a dev directory pick.
  const ada = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'ada-demo-password' })
  assert.equal(ada.status, 200)
  assert.equal(ada.json.user.id, 'user-ada')
  assert.equal(ada.json.via, 'session', 'a seed sign-in is a verified session like any other')
  assert.ok(stackTok(ada), 'and it joins the account stack like any other')

  const grace = await call('POST', '/auth/login', { email: 'grace@acme.example', password: 'grace-demo-password' }, { cookie: cookies(ada) })
  assert.equal(grace.status, 200)
  assert.equal(grace.json.user.id, 'user-grace')

  // Grace's cross-tenant membership (the co-authoring second tenant) is reached
  // through HER workspaces — a membership re-mint, not an enumeration.
  const workspaces = await call('GET', '/me/workspaces', undefined, { cookie: cookies(grace) })
  assert.ok(
    workspaces.json.some((w: { tenant: { id: string } }) => w.tenant.id === 'tenant-beta'),
    'tenant-beta lists among her memberships',
  )
  const beta = await call('POST', '/auth/session', { tenantId: 'tenant-beta' }, { cookie: cookies(grace) })
  assert.equal(beta.status, 200)
  assert.equal(beta.json.tenant.id, 'tenant-beta')

  // Both seeds now hop through the stack, credential-less — same as real accounts.
  const back = await call('POST', '/auth/session', { userId: 'user-ada' }, { cookie: cookies(beta) })
  assert.equal(back.status, 200)
  assert.equal(back.json.user.id, 'user-ada')

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
