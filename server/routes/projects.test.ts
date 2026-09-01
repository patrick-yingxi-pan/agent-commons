/** Direct Project creation: server-owned identity, safe retries, strict input,
 * and the same namespace wall as consent-gated relation creation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'

let n = 0

test('POST /projects mints opaque server identity and preserves same-name creations', async () => {
  const name = `Parallel name ${(n += 1)}`
  const first = await call('POST', '/projects', { name, description: 'First intent' })
  const second = await call('POST', '/projects', { name, description: 'Second intent' })

  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.match(first.json.project.id, /^p-[0-9a-f-]{36}$/)
  assert.notEqual(first.json.project.id, second.json.project.id)
  assert.equal(first.json.project.description, 'First intent')
  assert.equal(second.json.project.description, 'Second intent')
  assert.ok(first.json.graph.extraProjects.some((p: { id: string }) => p.id === first.json.project.id))

  const graph = await call('GET', '/relations')
  assert.equal(
    graph.json.extraProjects.filter((p: { name: string }) => p.name === name).length,
    2,
    'same-name intent is never collapsed by a browser-derived id collision',
  )
})

test('POST /projects replays one logical creation without minting again', async () => {
  const name = `Retry project ${(n += 1)}`
  const key = `project-create-${n}`
  const before = await call('GET', '/relations')
  const first = await call('POST', '/projects', { name }, { 'idempotency-key': key })
  const retry = await call('POST', '/projects', { name }, { 'idempotency-key': key })
  const after = await call('GET', '/relations')

  assert.equal(first.status, 201)
  assert.deepEqual(retry.json, first.json)
  assert.equal(retry.headers['idempotency-replayed'], 'true')
  assert.equal(after.json.revision, before.json.revision + 1)
  assert.equal(after.json.extraProjects.filter((p: { name: string }) => p.name === name).length, 1)
})

test('POST /projects validates bounded fields and existence-hides an unavailable owner', async () => {
  assert.equal((await call('POST', '/projects', { name: '' })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'x'.repeat(161) })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', description: 4 })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', description: 'x'.repeat(10_001) })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', ownerTenantId: '' })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', ownerTenantId: 'tenant-foreign-project-owner' })).status, 404)
})
