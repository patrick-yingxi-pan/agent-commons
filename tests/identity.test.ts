/** Identity & tenancy (design F2): GET /v1/me + the resolver. The route returns
 *  the single local user on the desktop/mock backend; the pure resolver covers the
 *  web (remote) path — the header seam standing in for verified IdP claims (PD8) and
 *  the tenant scoping (PD9). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { LOCAL_IDENTITY, resolveIdentity } from '../server/identity.ts'
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
  assert.deepEqual(me, LOCAL_IDENTITY)
})

test('resolveIdentity: desktop/native backends are always the single local user', () => {
  assert.deepEqual(resolveIdentity('mock'), LOCAL_IDENTITY)
  assert.deepEqual(resolveIdentity('native'), LOCAL_IDENTITY)
  // Headers can't escalate a desktop session into a different principal.
  assert.deepEqual(resolveIdentity('native', { 'x-user-id': 'user-grace' }), LOCAL_IDENTITY)
})

test('resolveIdentity: the web backend resolves a tenant-scoped principal (defaults)', () => {
  const me = resolveIdentity('remote')
  assert.equal(me.local, false)
  assert.equal(me.tenant.kind, 'org')
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
