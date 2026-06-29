/** Integration tests for the runner routes, driven through the real `buildRouter()`
 *  + store at the handler level (see tests/helpers/http.ts). Exercises routing,
 *  params, body parsing, the error envelope, and the durable-identity lifecycle. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('GET /runners returns the seeded local runner', async () => {
  const { status, json } = await call('GET', '/runners')
  assert.equal(status, 200)
  assert.ok(Array.isArray(json))
  assert.ok(json.some((a: any) => a.id === 'runner-local'))
})

test('GET /runners/:id returns one runner; an unknown id 404s with the envelope', async () => {
  const ok = await call('GET', '/runners/runner-local')
  assert.equal(ok.status, 200)
  assert.equal(ok.json.id, 'runner-local')

  const missing = await call('GET', '/runners/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('POST /runners enrolls a new runner; it then appears in the registry', async () => {
  const reg = await call('POST', '/runners', {
    id: 'runner-test-1',
    label: 'CI box',
    host: 'ci',
    capabilities: [{ type: 'terminal', scopes: ['*'] }],
  })
  assert.equal(reg.status, 200)
  assert.equal(reg.json.id, 'runner-test-1')
  assert.equal(reg.json.status, 'online')

  const list = await call('GET', '/runners')
  assert.ok(list.json.some((a: any) => a.id === 'runner-test-1'))
})

test('POST /runners without the required fields is a 400', async () => {
  const bad = await call('POST', '/runners', { host: 'x' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')
})

test('POST /runners rejects an unsafe id (the runner source id must stay :: -free)', async () => {
  // A `::` in the id would corrupt the served-fs recents key parse (contract/fs.ts).
  const bad = await call('POST', '/runners', {
    id: 'runner::evil',
    label: 'L',
    host: 'h',
    capabilities: [],
  })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')
})

test('heartbeat → re-grant → deregister lifecycle over HTTP, identity persists', async () => {
  await call('POST', '/runners', { id: 'runner-test-2', label: 'L', host: 'h', capabilities: [] })

  const hb = await call('POST', '/runners/runner-test-2/heartbeat')
  assert.equal(hb.status, 200)

  const patch = await call('PATCH', '/runners/runner-test-2/capabilities', {
    capabilities: [{ type: 'fs.read', scopes: ['~/x'] }],
  })
  assert.equal(patch.status, 200)
  assert.equal(patch.json.capabilities[0].type, 'fs.read')

  const del = await call('DELETE', '/runners/runner-test-2')
  assert.equal(del.status, 200)

  const after = await call('GET', '/runners/runner-test-2')
  assert.equal(after.status, 200)
  assert.equal(after.json.status, 'offline') // durable identity persists
})

test('DELETE on an unknown runner 404s', async () => {
  const del = await call('DELETE', '/runners/never')
  assert.equal(del.status, 404)
})
