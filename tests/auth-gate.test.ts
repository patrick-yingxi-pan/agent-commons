/** The auth gate as a WALL (multi-account §12, hardened — closes SYNC-8's named
 *  follow-on "server-side 401s for unauthenticated reads"). Two halves, both
 *  under test:
 *   - the ROUTER wall: with the gate on, an anonymous request (no session, no
 *     dev-seam headers) gets 401 from every data route, while the front door
 *     (boot identity, auth, ops probes) and the MACHINE edges that carry their
 *     own auth (A2A, relay, the connector download) stay open;
 *   - the IDENTITY half: the same request resolves to the ANONYMOUS principal —
 *     `/me` and the identity echo name nobody, and the open routes leak no seed
 *     identity (pre-gate they answered as Ada / the local user);
 *   - a verified session and the dev header seam both pass the wall, and the
 *     gate OFF restores the ungated default exactly.
 *  The flag is read per request (like IDENTITY_HEADERS), so tests toggle it
 *  without reloads; real boots default it ON (server/index.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
  process.env.AUTH_GATE = 'require'
  try {
    return await fn()
  } finally {
    delete process.env.AUTH_GATE
  }
}

test('gated: anonymous data reads and writes are refused with 401', async () => {
  await gated(async () => {
    for (const path of ['/relations', '/sessions', '/projects', '/notifications', '/me/orgs', '/search?q=a']) {
      const r = await call('GET', path)
      assert.equal(r.status, 401, `GET ${path} refuses anonymously`)
      assert.equal(r.json.error.code, 'unauthorized')
    }
    assert.equal((await call('POST', '/sessions', { title: 'x' })).status, 401, 'writes refuse too')
    assert.equal(
      (await call('POST', '/relations/ops', { op: { kind: 'create-project', projectId: 'p-gate', projectName: 'Gate', projectDescription: '' } })).status,
      401,
      'no anonymous entity is ever stamped into the store',
    )
  })
})

test('gated: the anonymous principal — /me and the identity echo name NOBODY', async () => {
  await gated(async () => {
    const me = await call('GET', '/me')
    assert.equal(me.status, 200, '/me stays open (the boot read)')
    assert.equal(me.json.user.id, 'user-anonymous', 'no seed user leaks pre-sign-in')
    assert.equal(me.json.tenant.id, 'tenant-anonymous', 'no seed tenant leaks pre-sign-in')
    assert.equal(me.json.via, 'default')
    assert.equal(me.json.user.email, undefined)
    assert.equal(me.headers['x-resolved-tenant'], 'tenant-anonymous', 'the echo names nobody either')
  })
})

test('gated: the front door and the self-authenticated machine edges stay open', async () => {
  await gated(async () => {
    // (`/metrics` — Prometheus text — and `/connector` — the served TS source —
    // sit on the same open list but this JSON-bodied helper can't parse them;
    // the JSON front-door routes stand in for the list's behavior.)
    for (const path of ['/capabilities', '/healthz', '/readyz', '/a2a/card', '/auth/accounts']) {
      const r = await call('GET', path)
      assert.notEqual(r.status, 401, `GET ${path} is not walled`)
    }
    // The relay prefix is open but its OWN auth still applies: the 401 is the
    // RELAY's (rendezvous secret), not the gate's generic refusal.
    const relay = await call('GET', '/relay/poll')
    assert.equal(relay.status, 401)
    assert.match(relay.json.error.message, /rendezvous/i)
  })
})

test('gated: a verified session passes the wall and reads its OWN world', async () => {
  const email = `gate-user-${Date.now()}@gate.example`
  const signup = await call('POST', '/auth/signup', { name: 'Gate User', email, password: 'gate-password-1' })
  assert.equal(signup.status, 200)
  const cookie = signup.headers['set-cookie']!.split(';')[0]!
  await gated(async () => {
    const me = await call('GET', '/me', undefined, { cookie })
    assert.equal(me.json.user.name, 'Gate User', 'a session resolves normally under the gate')
    assert.equal(me.json.via, 'session')
    const rel = await call('GET', '/relations', undefined, { cookie })
    assert.equal(rel.status, 200, 'signed in, data reads work')
    // …and the auth routes stay usable for a SECOND sign-in while gated.
    const login = await call('POST', '/auth/login', { email, password: 'gate-password-1' })
    assert.equal(login.status, 200)
  })
})

test('gated: the dev header seam still passes (an explicit assertion, not an absence)', async () => {
  await gated(async () => {
    const r = await call('GET', '/relations', undefined, { 'x-tenant-id': 'tenant-acme' })
    assert.equal(r.status, 200, 'via=headers is not the anonymous default')
    assert.equal(r.headers['x-resolved-tenant'], 'tenant-acme')
  })
})

test('ungated: the default principal answers exactly as before (the flag is the only switch)', async () => {
  const me = await call('GET', '/me')
  assert.equal(me.status, 200)
  assert.notEqual(me.json.user.id, 'user-anonymous', 'gate off ⇒ the backend default resolves')
  assert.equal((await call('GET', '/relations')).status, 200)
})
