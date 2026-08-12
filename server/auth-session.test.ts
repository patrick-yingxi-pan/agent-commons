/** Verified sessions (multi-account P6 — the production identity seam):
 *  `POST /v1/auth/session` mints an HttpOnly cookie carrying an HMAC-signed
 *  token for a DIRECTORY identity only; resolution is cookie-first (the cookie
 *  beats client-asserted headers); a tampered token is worthless; and with
 *  `IDENTITY_HEADERS=deny` (the production posture) client assertions are
 *  ignored entirely while the cookie keeps working. Default backend here;
 *  the remote face shares the same resolver spine. Mints ride the CREDENTIALED
 *  paths (login/signup) — the workspace re-mint arm is gone (FWD-5 Phase 2). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './testkit/http.ts'
import { signSession, verifySession, assertAuthConfig, SESSION_COOKIE } from './auth.ts'

const cookieOf = (setCookie: string | undefined) => setCookie?.split(';')[0] ?? ''

test('token primitives: round-trip verifies; any tampering or garbage is null', () => {
  const token = signSession({ userId: 'user-grace', tenantId: 'tenant-beta', iat: Date.now() })
  const claims = verifySession(token)
  assert.equal(claims?.userId, 'user-grace')
  assert.equal(claims?.tenantId, 'tenant-beta')

  const [payload, sig] = token.split('.')
  const forgedPayload = Buffer.from(JSON.stringify({ userId: 'user-local', tenantId: 'tenant-other', iat: Date.now() })).toString('base64url')
  assert.equal(verifySession(`${forgedPayload}.${sig}`), null, 'a re-targeted payload fails the signature')
  assert.equal(verifySession(`${payload}.${Buffer.from('nope').toString('base64url')}`), null, 'a wrong signature fails')
  assert.equal(verifySession('garbage'), null)
  assert.equal(verifySession(''), null)
  assert.equal(verifySession(undefined), null)
  const stale = signSession({ userId: 'user-grace', tenantId: 'tenant-beta', iat: Date.now() - 365 * 24 * 3600 * 1000 })
  assert.equal(verifySession(stale), null, 'an aged-out token is refused')
})

test('the production posture refuses to run on the dev signing secret', () => {
  assert.throws(() => assertAuthConfig({ IDENTITY_HEADERS: 'deny' }), /requires AUTH_SECRET/, 'deny without a real secret is authentication theater — crash at boot')
  assert.doesNotThrow(() => assertAuthConfig({ IDENTITY_HEADERS: 'deny', AUTH_SECRET: 'real-secret' }))
  assert.doesNotThrow(() => assertAuthConfig({}), 'the dev default (headers allowed) boots without a secret')
})

test('a credentialed sign-in mints a hardened cookie and answers with the resolved identity', async () => {
  const res = await call('POST', '/auth/login', { email: 'grace@acme.example', password: 'grace-demo-password' })
  assert.equal(res.status, 200)
  const setCookie = res.headers['set-cookie']
  assert.ok(setCookie?.startsWith(`${SESSION_COOKIE}=`), 'the session cookie is set')
  assert.match(setCookie!, /HttpOnly/, 'not readable from script')
  assert.match(setCookie!, /SameSite=Lax/, 'bounded against cross-site sends')
  assert.match(setCookie!, /Path=\//)
  // The response body is the seam's own answer (resolved THROUGH the cookie) —
  // the account lands in its ONE namespace (FWD-5 Phase 2).
  assert.equal(res.json.tenant.id, 'tenant-beta')
  assert.equal(res.json.user.id, 'user-grace')
  assert.equal(res.json.role, 'owner', 'role comes from the directory, never from the client')
  assert.equal(res.headers['x-resolved-tenant'], 'tenant-beta', 'the echo already speaks as the new identity')
})

test('the cookie IS the identity on later requests — and it beats client-asserted headers', async () => {
  const minted = await call('POST', '/auth/login', { email: 'grace@acme.example', password: 'grace-demo-password' })
  const cookie = cookieOf(minted.headers['set-cookie'])

  const me = await call('GET', '/me', undefined, { cookie })
  assert.equal(me.json.tenant.id, 'tenant-beta')

  const contested = await call('GET', '/me', undefined, { cookie, 'x-tenant-id': 'tenant-personal', 'x-user-role': 'member' })
  assert.equal(contested.json.tenant.id, 'tenant-beta', 'the verified cookie outranks the header assertion')
  assert.equal(contested.json.role, 'owner', 'a role header cannot rewrite a cookie session’s registry role')
})

test('only stack entries are mintable — and a tenantId is refused loudly (FWD-5 Phase 2)', async () => {
  const tenantArm = await call('POST', '/auth/session', { tenantId: 'tenant-acme' })
  assert.equal(tenantArm.status, 400, 'the workspace re-mint arm is gone — an account has exactly one namespace')
  const cold = await call('POST', '/auth/session', { userId: 'user-ada' })
  assert.equal(cold.status, 400, 'a bare userId without a stack entry is not a credential')
  const noBody = await call('POST', '/auth/session', {})
  assert.equal(noBody.status, 400)
})

test('DELETE /auth/session signs out (expires the cookie)', async () => {
  const res = await call('DELETE', '/auth/session')
  assert.equal(res.status, 204)
  assert.match(res.headers['set-cookie'] ?? '', /Max-Age=0/, 'the cookie is expired immediately')
})

test('IDENTITY_HEADERS=deny — the production posture: headers are ignored, the cookie still works', async (t) => {
  process.env.IDENTITY_HEADERS = 'deny'
  t.after(() => {
    delete process.env.IDENTITY_HEADERS
  })

  const asserted = await call('GET', '/me', undefined, { 'x-tenant-id': 'tenant-beta', 'x-user-role': 'owner' })
  assert.equal(asserted.json.tenant.id, 'tenant-personal', 'a client-asserted tenant no longer moves the needle')
  assert.equal(asserted.headers['x-resolved-tenant'], 'tenant-personal')

  const minted = await call('POST', '/auth/login', { email: 'maya@growthworks.example', password: 'maya-demo-password' })
  assert.equal(minted.status, 200, 'credentialed minting still works — it is the only sign-in path')
  const me = await call('GET', '/me', undefined, { cookie: cookieOf(minted.headers['set-cookie']) })
  assert.equal(me.json.tenant.id, 'tenant-growthworks', 'the verified credential is unaffected by the deny posture')

  // The events stream's legacy ?user=&tenant= stand-in is the same trust class
  // as the headers — denied together. (The cookie rides EventSource natively.)
  const { callRaw } = await import('./testkit/http.ts')
  const stream = await callRaw('GET', '/events?user=user-grace&tenant=tenant-beta')
  const hello = JSON.parse(stream.body.split('\n\n')[0].split('\n').find((l) => l.startsWith('data:'))!.slice(5))
  assert.equal(hello.identity.tenantId, 'tenant-personal', 'query identity is refused under deny')
})
