/** The default (native/mock) face of the identity surface (multi-account §5.6):
 *  no switcher — `capabilities.identitySwitch` is false, `GET /v1/identities`
 *  409s (capability-gated, not env-sniffed), and the `x-resolved-tenant` echo
 *  still rides every response (always the one local tenant — the tripwire is
 *  costless where it can't fire). Complements tests/identities-route.test.ts,
 *  which runs the remote variant in its own process. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('the default backend has no switcher: flag false, /identities 409s', async () => {
  const caps = await call('GET', '/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.json.features.identitySwitch, false, 'no switcher on the single-identity backend')

  const ids = await call('GET', '/identities')
  assert.equal(ids.status, 409, 'the identity directory is capability-gated')
  assert.equal(ids.json.error.code, 'capability_unavailable')
})

test('the identity echo rides every response on the default backend too (always the local tenant)', async () => {
  const me = await call('GET', '/me')
  assert.equal(me.status, 200)
  assert.equal(me.headers['x-resolved-tenant'], 'tenant-personal', 'the echo names the single local tenant')
  const caps = await call('GET', '/capabilities')
  assert.equal(caps.headers['x-resolved-tenant'], 'tenant-personal', 'present on every matched route, not just /me')
})
