/** Integration tests for the resource-guardian routes (D5) — reserve / commit /
 *  release / status / capacity — through the real router + store guardian. Each
 *  test uses a distinct resource key so the shared store singleton can't bleed. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

test('reserve grants a held reservation; status reflects it', async () => {
  const r = await call('POST', '/resources/rt-1/reserve', { holder: 'sA' })
  assert.equal(r.status, 200)
  assert.equal(r.json.status, 'held')
  assert.equal(r.json.resourceId, 'rt-1')
  const s = await call('GET', '/resources/rt-1')
  assert.equal(s.json.capacity, 1)
  assert.equal(s.json.active.length, 1)
})

test('a second session is refused at capacity 1 (409 conflict)', async () => {
  await call('POST', '/resources/rt-2/reserve', { holder: 'sA' })
  const r = await call('POST', '/resources/rt-2/reserve', { holder: 'sB' })
  assert.equal(r.status, 409)
  assert.equal(r.json.error.code, 'conflict')
})

test('PATCH capacity lets a second session in', async () => {
  await call('PATCH', '/resources/rt-3', { capacity: 2 })
  await call('POST', '/resources/rt-3/reserve', { holder: 'sA' })
  const r = await call('POST', '/resources/rt-3/reserve', { holder: 'sB' })
  assert.equal(r.status, 200)
  assert.equal((await call('GET', '/resources/rt-3')).json.active.length, 2)
})

test('reserve → commit → release lifecycle frees the slot', async () => {
  const r = await call('POST', '/resources/rt-4/reserve', { holder: 'sA' })
  const id = r.json.id
  assert.equal((await call('POST', `/reservations/${id}/commit`)).json.status, 'committed')
  // committed still holds the slot — sB is blocked
  assert.equal((await call('POST', '/resources/rt-4/reserve', { holder: 'sB' })).status, 409)
  assert.equal((await call('POST', `/reservations/${id}/release`)).json.status, 'released')
  // released — sB gets in
  assert.equal((await call('POST', '/resources/rt-4/reserve', { holder: 'sB' })).status, 200)
})

test('only the authenticated reservation owner may commit or release a claim', async () => {
  const owner = { 'x-tenant-id': 'tenant-reservation-owner' }
  const stranger = { 'x-tenant-id': 'tenant-reservation-stranger' }
  const reserved = await call('POST', '/resources/rt-owned/reserve', { holder: 'same-visible-holder' }, owner)
  const id = reserved.json.id

  assert.equal((await call('POST', `/reservations/${id}/commit`, undefined, stranger)).status, 403)
  assert.equal((await call('POST', `/reservations/${id}/release`, undefined, stranger)).status, 403)
  assert.equal((await call('POST', `/reservations/${id}/commit`, undefined, owner)).json.status, 'committed')

  const firstRelease = await call(
    'POST',
    `/reservations/${id}/release`,
    undefined,
    { ...owner, 'idempotency-key': 'release-owned-claim' },
  )
  const replay = await call(
    'POST',
    `/reservations/${id}/release`,
    undefined,
    { ...owner, 'idempotency-key': 'release-owned-claim' },
  )
  assert.equal(firstRelease.json.status, 'released')
  assert.equal(replay.json.status, 'released')
  assert.equal(replay.headers['idempotency-replayed'], 'true')
})

test('generic resource routes cannot bypass a Project guardian wall', async () => {
  const projectId = `project:guardian:${Date.now().toString(36)}`
  const tenantId = 'tenant-project-guardian-wall'
  store.applyRelationOp({
    kind: 'create-project',
    projectId,
    projectName: 'Guardian namespace wall',
    projectDescription: '',
  }, tenantId)
  store.applyRelationOp({
    kind: 'share-project',
    projectId,
    projectName: 'Guardian namespace wall',
    shared: true,
  }, tenantId)
  const resource = `${projectId}:raw-route-bypass`
  assert.equal((await call('GET', `/resources/${resource}`)).status, 404)
  assert.equal((await call('PATCH', `/resources/${resource}`, { capacity: 2 })).status, 404)
  assert.equal((await call('POST', `/resources/${resource}/reserve`, { holder: 'invented' })).status, 404)
})

test('reserve without holder is 400 bad_request', async () => {
  const r = await call('POST', '/resources/rt-5/reserve', {})
  assert.equal(r.status, 400)
  assert.equal(r.json.error.code, 'bad_request')
})

test('commit on an unknown reservation is 404 not_found', async () => {
  const r = await call('POST', '/reservations/ghost/commit')
  assert.equal(r.status, 404)
  assert.equal(r.json.error.code, 'not_found')
})

test('PATCH capacity below 1 is 400 bad_request', async () => {
  const r = await call('PATCH', '/resources/rt-6', { capacity: 0 })
  assert.equal(r.status, 400)
  assert.equal(r.json.error.code, 'bad_request')
})

test('status of an untouched resource is empty at default capacity 1', async () => {
  const s = await call('GET', '/resources/rt-untouched')
  assert.equal(s.status, 200)
  assert.equal(s.json.capacity, 1)
  assert.deepEqual(s.json.active, [])
})
