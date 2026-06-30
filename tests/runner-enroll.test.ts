/** Runner enrollment auth (design F4) — when RUNNER_ENROLL_TOKEN is set, POST /runners
 *  (enroll/reconnect) requires the token via `Authorization: Bearer` or `x-runner-token`;
 *  unset ⇒ open enrollment (the loopback default). The token is read per request, so the
 *  shared router picks up the env we set here. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

const body = { label: 'Laptop', host: 'localhost', capabilities: [] as unknown[] }

test('POST /runners is open when no enrollment token is configured (default)', async () => {
  delete process.env.RUNNER_ENROLL_TOKEN
  const r = await call('POST', '/runners', { ...body, id: 'enroll-open' })
  assert.equal(r.status, 200)
  assert.equal(r.json.id, 'enroll-open')
})

test('POST /runners requires a valid token when RUNNER_ENROLL_TOKEN is set', async () => {
  process.env.RUNNER_ENROLL_TOKEN = 'secret-xyz'
  try {
    const missing = await call('POST', '/runners', { ...body, id: 'e1' })
    assert.equal(missing.status, 403, 'no token → forbidden')
    assert.equal(missing.json.error.code, 'forbidden')

    const wrong = await call('POST', '/runners', { ...body, id: 'e2' }, { 'x-runner-token': 'nope' })
    assert.equal(wrong.status, 403, 'wrong token → forbidden')

    const viaHeader = await call('POST', '/runners', { ...body, id: 'e3' }, { 'x-runner-token': 'secret-xyz' })
    assert.equal(viaHeader.status, 200, 'x-runner-token accepted')
    assert.equal(viaHeader.json.id, 'e3')

    const viaBearer = await call('POST', '/runners', { ...body, id: 'e4' }, { authorization: 'Bearer secret-xyz' })
    assert.equal(viaBearer.status, 200, 'Authorization: Bearer accepted')
  } finally {
    delete process.env.RUNNER_ENROLL_TOKEN
  }
})
