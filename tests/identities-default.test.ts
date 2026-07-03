/** The default (native/mock) face of the identity surface (multi-account §5.6,
 *  revised: UNIFORM across backends): the switcher is advertised here too, and
 *  `GET /v1/identities` lists the LOCAL USER'S WORKSPACES (personal + the seeded
 *  work org) — the desktop app's account menu in miniature. The user never
 *  changes on this backend (the device owner is the only trusted principal);
 *  only the tenant/workspace switches. The `x-resolved-tenant` echo rides every
 *  response and follows the switched workspace. Complements
 *  tests/identities-route.test.ts, which runs the remote variant (org
 *  principals) in its own process. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('the default backend advertises the switcher and lists the local user’s workspaces', async () => {
  const caps = await call('GET', '/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.json.features.identitySwitch, true, 'the switcher is uniform across backends')

  const ids = await call('GET', '/identities')
  assert.equal(ids.status, 200)
  const list = ids.json as Array<{ userId: string; tenantId: string; tenantLabel: string; role: string }>
  assert.equal(list.length, 2, 'personal + the seeded work org')
  assert.ok(list.every((i) => i.userId === 'user-local'), 'the desktop directory never lists another USER — only workspaces')
  assert.deepEqual(
    list.map((i) => [i.tenantId, i.role]),
    [
      ['tenant-personal', 'owner'],
      ['tenant-work', 'member'],
    ],
  )
})

test('the identity echo follows the switched workspace on the default backend', async () => {
  const personal = await call('GET', '/me')
  assert.equal(personal.status, 200)
  assert.equal(personal.headers['x-resolved-tenant'], 'tenant-personal', 'no override → the personal tenant, as always')
  assert.equal(personal.json.user.id, 'user-local')

  const work = await call('GET', '/me', undefined, { 'x-tenant-id': 'tenant-work' })
  assert.equal(work.headers['x-resolved-tenant'], 'tenant-work', 'the echo names the switched workspace')
  assert.equal(work.json.user.id, 'user-local', 'still the device owner')
  assert.equal(work.json.tenant.id, 'tenant-work')
})

test('workspace isolation holds on the desktop too: a work-created session is invisible from personal', async () => {
  const created = await call('POST', '/sessions', { firstMessage: 'work-only planning thread' }, { 'x-tenant-id': 'tenant-work' })
  assert.equal(created.status, 200)
  const id = created.json.id as string

  const fromWork = await call('GET', `/sessions/${id}`, undefined, { 'x-tenant-id': 'tenant-work' })
  assert.equal(fromWork.status, 200, 'visible in the workspace that created it')

  const fromPersonal = await call('GET', `/sessions/${id}`)
  assert.equal(fromPersonal.status, 404, 'the personal workspace cannot even observe its existence (F2/PD9)')
})
