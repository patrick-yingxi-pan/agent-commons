/** Request correlation id (design F3 / observability) — the server mints an X-Request-Id,
 *  but honours a *safe* inbound one for trace propagation. An unsafe inbound id (bad chars
 *  or over-long) is rejected and a fresh one minted, since the id flows into logs. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('a safe inbound X-Request-Id is echoed (trace propagation)', async () => {
  const r = await call('GET', '/capabilities', undefined, { 'x-request-id': 'trace-abc_123.4' })
  assert.equal(r.headers['x-request-id'], 'trace-abc_123.4')
})

test('an unsafe inbound X-Request-Id is replaced with a minted one (log-injection guard)', async () => {
  const bad = await call('GET', '/capabilities', undefined, { 'x-request-id': 'evil id\nwith spaces' })
  assert.notEqual(bad.headers['x-request-id'], 'evil id\nwith spaces')
  assert.match(bad.headers['x-request-id'], /^req-/)

  const tooLong = await call('GET', '/capabilities', undefined, { 'x-request-id': 'x'.repeat(200) })
  assert.match(tooLong.headers['x-request-id'], /^req-/, 'an over-long id is rejected')
})

test('mints an id when none is supplied', async () => {
  const r = await call('GET', '/capabilities')
  assert.match(r.headers['x-request-id'], /^req-/)
})
