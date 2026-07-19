/** The bearer transport for the ONE session credential (access-parity INV-11):
 *  `transport: 'bearer'` on login/signup delivers the same HMAC-signed token in
 *  the body (no cookies — the account stack is a browser concept), and
 *  `Authorization: Bearer <token>` resolves through the exact verifySession +
 *  registry path the cookie takes (server/identity.ts). One credential format,
 *  one policy, two transports — this suite locks both halves. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

const login = (body: Record<string, unknown>) => call('POST', '/auth/login', body)

const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
  process.env.AUTH_GATE = 'require'
  try {
    return await fn()
  } finally {
    delete process.env.AUTH_GATE
  }
}

test("login transport 'bearer' returns {token, identity} and sets NO cookies", async () => {
  const r = await login({ email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' })
  assert.equal(r.status, 200)
  assert.ok(typeof r.json.token === 'string' && r.json.token.includes('.'), 'the signed token rides the body')
  assert.equal(r.json.identity.user.id, 'user-ada')
  assert.equal(r.json.identity.via, 'session', 'resolved through the same verified-credential path')
  assert.equal(r.headers['set-cookie'], undefined, 'no session cookie, no stack join — bearer clients hold their own credential')
  assert.equal(r.headers['x-resolved-tenant'], r.json.identity.tenant.id)
})

test('the bearer header resolves the SAME identity the cookie would', async () => {
  const { json } = await login({ email: 'grace@acme.example', password: 'grace-demo-password', transport: 'bearer' })
  const me = await call('GET', '/me', undefined, { authorization: `Bearer ${json.token}` })
  assert.equal(me.status, 200)
  assert.equal(me.json.user.id, 'user-grace')
  assert.equal(me.json.via, 'session', 'a bearer session reads as signed in, exactly like the cookie')
  assert.equal(me.headers['x-resolved-tenant'], json.identity.tenant.id)
})

test('gated: a bearer session passes the wall; a tampered or foreign bearer does not', async () => {
  await gated(async () => {
    const { json } = await login({ email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' })
    const ok = await call('GET', '/sessions', undefined, { authorization: `Bearer ${json.token}` })
    assert.equal(ok.status, 200, 'the bearer transport is a first-class way through the auth gate')
    const tampered = await call('GET', '/sessions', undefined, { authorization: `Bearer ${json.token}x` })
    assert.equal(tampered.status, 401, 'a tampered token falls through to anonymous — never to a guess')
    // A non-session bearer that legitimately rides the same header on machine
    // edges (the relay's rendezvous secret shape) resolves NO identity here.
    const foreign = await call('GET', '/sessions', undefined, { authorization: 'Bearer rv_live_not_a_session_token' })
    assert.equal(foreign.status, 401)
  })
})

test("signup honours transport 'bearer' too, and an invalid transport is refused (INV-9)", async () => {
  const r = await call('POST', '/auth/signup', {
    name: 'Bearer Bot',
    email: `bearer-bot-${Date.now()}@example.test`,
    password: 'long-enough-1',
    transport: 'bearer',
  })
  assert.equal(r.status, 200)
  assert.ok(r.json.token, 'signup can mint for machine callers as well')
  assert.equal(r.headers['set-cookie'], undefined)

  const bad = await login({ email: 'ada@acme.example', password: 'ada-demo-password', transport: 'header' })
  assert.equal(bad.status, 400, "an unknown transport is refused, never normalized (INV-9: 'cookie' | 'bearer' only)")
  assert.equal(bad.json.error.code, 'bad_request')
})

test('POST /auth/token mints a bearer for the CURRENT verified session only (the MCP connect panel)', async () => {
  // Anonymous and dev-seam callers never proved a credential — no mint.
  assert.equal((await call('POST', '/auth/token', {})).status, 401)
  assert.equal((await call('POST', '/auth/token', {}, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' })).status, 401, 'the header seam is not a verified session')
  // A verified session (cookie OR bearer — same credential) mints.
  const login = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' })
  const minted = await call('POST', '/auth/token', {}, { authorization: `Bearer ${login.json.token}` })
  assert.equal(minted.status, 200)
  assert.equal(minted.json.identity.user.id, 'user-ada')
  const me = await call('GET', '/me', undefined, { authorization: `Bearer ${minted.json.token}` })
  assert.equal(me.json.via, 'session', 'the minted token IS the session credential')
})

test('absent transport keeps the cookie flow byte-identical (INV-9: absence = cookie)', async () => {
  const r = await login({ email: 'ada@acme.example', password: 'ada-demo-password' })
  assert.equal(r.status, 200)
  assert.equal(r.json.user?.id ?? r.json.identity?.user?.id, 'user-ada')
  assert.equal(r.json.token, undefined, 'the cookie flow never puts the token in the body')
  assert.ok(r.headers['set-cookie'], 'the browser flow still sets the HttpOnly cookie')
})
