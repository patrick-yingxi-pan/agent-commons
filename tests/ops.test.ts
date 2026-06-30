/** Ops + observability seams (design F6 / F3): liveness, readiness, and the
 *  per-response correlation id. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('GET /healthz reports liveness with the process epoch', async () => {
  const res = await call('GET', '/healthz')
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'ok')
  assert.ok(res.json.epoch, 'carries the process epoch')
})

test('GET /readyz reports readiness + the backend variant', async () => {
  const res = await call('GET', '/readyz')
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'ready')
  assert.ok(['mock', 'native', 'remote'].includes(res.json.backend))
})

test('every response carries a unique X-Request-Id', async () => {
  const a = await call('GET', '/healthz')
  const b = await call('GET', '/healthz')
  assert.ok(a.headers['x-request-id'], 'a correlation id is set')
  assert.match(a.headers['x-request-id'], /^req-/)
  assert.notEqual(a.headers['x-request-id'], b.headers['x-request-id'], 'ids are distinct per request')
})

test('a correlation id is present even on an error response', async () => {
  const res = await call('GET', '/sessions/does-not-exist')
  assert.equal(res.status, 404)
  assert.ok(res.headers['x-request-id'], 'errors are correlatable too')
})
