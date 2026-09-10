import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { call } from '../testkit/http.ts'

const cookie = (userId: string, tenantId: string) => ({
  cookie: `${SESSION_COOKIE}=${signSession({ userId, tenantId, iat: Date.now() })}`,
})

test('model preference reads default and valid CAS preserves exact stale selections', async () => {
  const headers = cookie('user-ada', 'tenant-acme')
  const initial = await call('GET', '/viewer-preferences/model', undefined, headers)
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.json, {
    tenantId: 'tenant-acme', userId: 'user-ada', revision: 0,
    preferences: { effort: 'High', ultracode: false, fast: false },
  })
  const updated = await call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: 'tenant-acme', expectedUserId: 'user-ada', expectedRevision: 0,
    preferences: { providerId: 'stale-provider', modelId: 'stale-model', effort: 'Retired', ultracode: true, fast: true },
  }, headers)
  assert.equal(updated.status, 200)
  assert.equal(updated.json.revision, 1)
  assert.equal(updated.json.preferences.providerId, 'stale-provider')
  const replay = await call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: 'tenant-acme', expectedUserId: 'user-ada', expectedRevision: 1,
    preferences: updated.json.preferences,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.revision, 1, 'same desired state does not advance ordering')
})

test('same-tenant users stay separate and frozen scope mismatch changes neither row', async () => {
  const org = accounts.createOrg('user-ada', `Preference scope ${Date.now()}`)
  assert.ok(org)
  const invite = accounts.createInvite(org.id, 'grace@acme.example', 'Ada')
  assert.ok(invite)
  assert.equal(accounts.resolveInvite(invite.id, 'user-grace', 'accept')?.kind, 'accepted')
  const ada = cookie('user-ada', org.id)
  const grace = cookie('user-grace', org.id)

  assert.equal((await call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: org.id, expectedUserId: 'user-ada', expectedRevision: 0,
    preferences: { effort: 'Low', ultracode: false, fast: true },
  }, ada)).status, 200)
  assert.equal((await call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: org.id, expectedUserId: 'user-grace', expectedRevision: 0,
    preferences: { effort: 'High', ultracode: true, fast: false },
  }, grace)).status, 200)

  const wrongUser = await call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: org.id, expectedUserId: 'user-ada', expectedRevision: 1,
    preferences: { effort: 'Wrong', ultracode: true, fast: true },
  }, grace)
  assert.equal(wrongUser.status, 409)
  const wrongTenant = await call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: 'tenant-acme', expectedUserId: 'user-ada', expectedRevision: 1,
    preferences: { effort: 'Wrong', ultracode: true, fast: true },
  }, ada)
  assert.equal(wrongTenant.status, 409)
  assert.equal((await call('GET', '/viewer-preferences/model', undefined, ada)).json.preferences.effort, 'Low')
  assert.equal((await call('GET', '/viewer-preferences/model', undefined, grace)).json.preferences.effort, 'High')
})

test('model preference PATCH rejects missing, malformed, and unknown input', async () => {
  const headers = cookie('user-maya', 'tenant-growthworks')
  for (const body of [
    {},
    { expectedTenantId: 'tenant-growthworks', expectedUserId: 'user-maya', expectedRevision: 0, preferences: { ultracode: false } },
    { expectedTenantId: 'tenant-growthworks', expectedUserId: 'user-maya', expectedRevision: 0, preferences: { ultracode: false, fast: false }, extra: true },
  ]) assert.equal((await call('PATCH', '/viewer-preferences/model', body, headers)).status, 400)
})
