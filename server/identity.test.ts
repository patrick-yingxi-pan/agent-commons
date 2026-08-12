/** Identity & tenancy (design F2): GET /v1/me + the resolver. The route returns
 *  the single local user on the desktop/mock backend; the pure resolver covers the
 *  web (remote) path — the header seam standing in for verified IdP claims (PD8) and
 *  the tenant scoping (PD9). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './testkit/http.ts'
import { LOCAL_IDENTITY, resolveIdentity } from './identity.ts'
import type { Identity } from '../contract/index.ts'

test('GET /me returns the local single-user identity on the desktop/mock backend', async () => {
  // The test process runs the default (mock) backend, which is the desktop case.
  const res = await call('GET', '/me')
  assert.equal(res.status, 200)
  const me = res.json as Identity
  assert.equal(me.local, true)
  assert.equal(me.role, 'owner')
  assert.equal(me.tenant.kind, 'personal')
  assert.equal(me.user.id, 'user-local')
  // No credential, no header assertion → the backend default, stamped as such
  // (`via`, multi-account §12 — the auth gate branches on this, so it's locked).
  assert.deepEqual(me, { ...LOCAL_IDENTITY, via: 'default' })
})

test('resolveIdentity: desktop/native defaults to the single local user; the USER never switches', () => {
  assert.deepEqual(resolveIdentity('mock'), { ...LOCAL_IDENTITY, via: 'default' })
  assert.deepEqual(resolveIdentity('native'), { ...LOCAL_IDENTITY, via: 'default' })
  // Headers can't escalate a desktop session into a different PRINCIPAL — the
  // device owner is the only user the loopback sidecar trusts (x-user-id ignored).
  assert.deepEqual(resolveIdentity('native', { 'x-user-id': 'user-grace' }), { ...LOCAL_IDENTITY, via: 'headers' })
  // Naming the personal tenant explicitly is the same identity.
  assert.deepEqual(resolveIdentity('native', { 'x-tenant-id': 'tenant-personal' }), { ...LOCAL_IDENTITY, via: 'headers' })
})

test('resolveIdentity: the desktop TENANT switches via x-tenant-id (multi-account §5.6, uniform)', () => {
  const work = resolveIdentity('mock', { 'x-tenant-id': 'tenant-work', 'x-user-id': 'user-grace' })
  assert.equal(work.user.id, 'user-local', 'still the device owner — only the tenant moved')
  assert.equal(work.tenant.id, 'tenant-work')
  assert.equal(work.tenant.kind, 'org')
  assert.equal(work.role, 'member', 'in an org tenant the owner default does not carry over')
  assert.equal(work.local, true)
  // Unknown tenant ids synthesize an org, mirroring the web seam.
  const other = resolveIdentity('native', { 'x-tenant-id': 'tenant-globex' })
  assert.equal(other.tenant.id, 'tenant-globex')
  assert.equal(other.tenant.kind, 'org')
  assert.equal(other.user.id, 'user-local')
})

test('resolveIdentity: the web backend resolves a tenant-scoped principal (defaults)', () => {
  const me = resolveIdentity('remote')
  assert.equal(me.local, false)
  // A seed namespace is `personal` and wears its person's name (2026-08-09):
  // `tenant-acme` is Ada's OWN namespace, not an org she belongs to.
  assert.equal(me.tenant.kind, 'personal')
  assert.equal(me.tenant.name, 'Ada Lovelace')
  assert.equal(me.tenant.id, 'tenant-acme')
  assert.equal(me.user.id, 'user-ada')
  assert.equal(me.role, 'owner')
  assert.ok(me.user.email, 'a web user carries an IdP email')
})

test('resolveIdentity: the web backend reads the principal from the auth-claim seam', () => {
  const grace = resolveIdentity('remote', { 'x-user-id': 'user-grace' })
  assert.equal(grace.user.id, 'user-grace')
  assert.equal(grace.role, 'member', 'role comes from the seeded directory when not overridden')

  const otherTenant = resolveIdentity('remote', { 'x-tenant-id': 'tenant-globex' })
  assert.equal(otherTenant.tenant.id, 'tenant-globex')
  assert.equal(otherTenant.tenant.kind, 'org')

  const elevated = resolveIdentity('remote', { 'x-user-id': 'user-grace', 'x-user-role': 'admin' })
  assert.equal(elevated.role, 'admin', 'an explicit valid role header wins')

  const bogusRole = resolveIdentity('remote', { 'x-user-role': 'superuser' })
  assert.equal(bogusRole.role, 'owner', 'an invalid role falls back to the directory default')
})

test('resolveIdentity: an unknown web user falls back to the default principal (mock has no 401)', () => {
  const me = resolveIdentity('remote', { 'x-user-id': 'user-nobody' })
  assert.equal(me.user.id, 'user-ada')
})
