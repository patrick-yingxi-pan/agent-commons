/** Baseline security headers (design F5) — every API response (success and error) carries
 *  nosniff, frame-options/CSP frame-ancestors, and a referrer policy. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('a success response carries the baseline security headers', async () => {
  const r = await call('GET', '/capabilities')
  assert.equal(r.status, 200)
  assert.equal(r.headers['x-content-type-options'], 'nosniff')
  assert.equal(r.headers['x-frame-options'], 'DENY')
  assert.equal(r.headers['referrer-policy'], 'no-referrer')
  assert.match(r.headers['content-security-policy'] ?? '', /frame-ancestors 'none'/)
})

test('an error response carries them too', async () => {
  const r = await call('GET', '/sessions/does-not-exist')
  assert.equal(r.status, 404)
  assert.equal(r.headers['x-content-type-options'], 'nosniff', 'errors are not exempt')
})
