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

test('reconnect + mutation routes are gated too (heartbeat/PATCH/DELETE) — reaping can’t be bypassed', async () => {
  process.env.RUNNER_ENROLL_TOKEN = 'sek'
  try {
    const created = await call('POST', '/runners', { ...body, id: 'g1' }, { 'x-runner-token': 'sek' })
    assert.equal(created.status, 200)

    // Without the token these all 403 — a heartbeat reconnect must not bypass the gate.
    assert.equal((await call('POST', '/runners/g1/heartbeat')).status, 403, 'heartbeat gated')
    assert.equal((await call('PATCH', '/runners/g1/capabilities', { capabilities: [] })).status, 403, 'patch gated')
    assert.equal((await call('DELETE', '/runners/g1')).status, 403, 'delete gated')

    // With the token they succeed.
    assert.equal((await call('POST', '/runners/g1/heartbeat', undefined, { 'x-runner-token': 'sek' })).status, 200)
    assert.equal((await call('PATCH', '/runners/g1/capabilities', { capabilities: [] }, { 'x-runner-token': 'sek' })).status, 200)
    assert.equal((await call('DELETE', '/runners/g1', undefined, { 'x-runner-token': 'sek' })).status, 200)
  } finally {
    delete process.env.RUNNER_ENROLL_TOKEN
  }
})

test('a valid x-runner-token is honored even alongside a non-Bearer Authorization header; Bearer is case-insensitive', async () => {
  process.env.RUNNER_ENROLL_TOKEN = 'sek'
  try {
    const coexist = await call('POST', '/runners', { ...body, id: 'g2' }, { authorization: 'Basic abc', 'x-runner-token': 'sek' })
    assert.equal(coexist.status, 200, 'a non-Bearer Authorization must not shadow a valid x-runner-token')

    const lower = await call('POST', '/runners', { ...body, id: 'g3' }, { authorization: 'bearer sek' })
    assert.equal(lower.status, 200, 'the Bearer scheme is matched case-insensitively')
  } finally {
    delete process.env.RUNNER_ENROLL_TOKEN
  }
})
