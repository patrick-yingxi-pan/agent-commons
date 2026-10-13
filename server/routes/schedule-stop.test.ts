import assert from 'node:assert/strict'
import { test } from 'node:test'
import { call, callFresh } from '../testkit/http.ts'
import { store } from '../store/index.ts'

test('Stop route owns an exact durable target across retry-cache loss and newer runs', async () => {
  const template = (await call('GET', '/schedule-templates')).json[0]
  const created = await call('POST', '/schedules', { seed: { ...template.seed, name: 'Exact Stop route', runs: [] } })
  assert.equal(created.status, 200)
  const taskId = created.json.id
  const first = await call('POST', `/schedules/${taskId}/run`)
  assert.equal(first.status, 200)
  const path = `/schedules/${taskId}/runs/${first.json.id}/stop`
  const headers = { 'idempotency-key': 'exact-stop-test' }
  const stopped = await call('POST', path, undefined, headers)
  assert.equal(stopped.status, 200)
  assert.equal(stopped.json.id, first.json.id)
  assert.equal(stopped.json.status, 'cancelled')
  const replay = await call('POST', path, undefined, headers)
  assert.equal(replay.headers['idempotency-replayed'], 'true')
  assert.deepEqual(replay.json, stopped.json)
  const next = await call('POST', `/schedules/${taskId}/run`)
  assert.equal(next.status, 200)
  assert.notEqual(next.json.id, first.json.id)
  const fresh = await callFresh('POST', path, undefined, headers)
  assert.equal(fresh.status, 200)
  assert.deepEqual(fresh.json, stopped.json)
  assert.equal(store.listSchedules().find(task => task.id === taskId)!.runs.find(run => run.id === next.json.id)!.status, 'running')
  assert.equal((await call('POST', `/schedules/${taskId}/runs/missing/stop`)).status, 404)
  await call('DELETE', `/schedules/${taskId}`)
})

test('shared and foreign readers cannot Stop owner work or replay its acknowledgement', async () => {
  const owner = { 'x-tenant-id': 'tenant-personal' }
  const template = (await call('GET', '/schedule-templates', undefined, owner)).json[0]
  const created = await call('POST', '/schedules', { seed: { ...template.seed, name: 'Private Stop route', runs: [] } }, owner)
  assert.equal(created.status, 200)
  const taskId = created.json.id
  const grant = store.createGrant({ subject: { kind: 'schedule', id: taskId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' }, 'tenant-personal')
  assert.ok(grant)
  const run = await call('POST', `/schedules/${taskId}/run`, undefined, owner)
  assert.equal(run.status, 200)
  const path = `/schedules/${taskId}/runs/${run.json.id}/stop`
  const key = { 'idempotency-key': 'owner-stop' }
  for (const tenant of ['tenant-beta', 'tenant-harbor']) {
    assert.equal((await call('POST', path, undefined, { ...key, 'x-tenant-id': tenant })).status, 404)
  }
  assert.equal((await call('POST', path, undefined, { ...key, ...owner })).json.status, 'cancelled')
  assert.equal((await call('POST', path, undefined, { ...key, 'x-tenant-id': 'tenant-beta' })).status, 404)
  store.revokeGrant(grant.id, 'tenant-personal')
  await call('DELETE', `/schedules/${taskId}`, undefined, owner)
})
