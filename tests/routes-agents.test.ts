/** Integration tests for the runner routes, driven through the real `buildRouter()`
 *  + store at the handler level (see tests/helpers/http.ts). Exercises routing,
 *  params, body parsing, the error envelope, and the durable-identity lifecycle. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('GET /agents returns the seeded local runner', async () => {
  const { status, json } = await call('GET', '/agents')
  assert.equal(status, 200)
  assert.ok(Array.isArray(json))
  assert.ok(json.some((a: any) => a.id === 'agent-local'))
})

test('GET /agents/:id returns one runner; an unknown id 404s with the envelope', async () => {
  const ok = await call('GET', '/agents/agent-local')
  assert.equal(ok.status, 200)
  assert.equal(ok.json.id, 'agent-local')

  const missing = await call('GET', '/agents/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('POST /agents enrolls a new runner; it then appears in the registry', async () => {
  const reg = await call('POST', '/agents', {
    id: 'agent-test-1',
    label: 'CI box',
    host: 'ci',
    capabilities: [{ type: 'terminal', scopes: ['*'] }],
  })
  assert.equal(reg.status, 200)
  assert.equal(reg.json.id, 'agent-test-1')
  assert.equal(reg.json.status, 'online')

  const list = await call('GET', '/agents')
  assert.ok(list.json.some((a: any) => a.id === 'agent-test-1'))
})

test('POST /agents without the required fields is a 400', async () => {
  const bad = await call('POST', '/agents', { host: 'x' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')
})

test('heartbeat → re-grant → deregister lifecycle over HTTP, identity persists', async () => {
  await call('POST', '/agents', { id: 'agent-test-2', label: 'L', host: 'h', capabilities: [] })

  const hb = await call('POST', '/agents/agent-test-2/heartbeat')
  assert.equal(hb.status, 200)

  const patch = await call('PATCH', '/agents/agent-test-2/capabilities', {
    capabilities: [{ type: 'fs.read', scopes: ['~/x'] }],
  })
  assert.equal(patch.status, 200)
  assert.equal(patch.json.capabilities[0].type, 'fs.read')

  const del = await call('DELETE', '/agents/agent-test-2')
  assert.equal(del.status, 200)

  const after = await call('GET', '/agents/agent-test-2')
  assert.equal(after.status, 200)
  assert.equal(after.json.status, 'offline') // durable identity persists
})

test('DELETE on an unknown runner 404s', async () => {
  const del = await call('DELETE', '/agents/never')
  assert.equal(del.status, 404)
})
