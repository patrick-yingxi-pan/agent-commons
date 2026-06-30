/** Per-tenant rate limiting (design F3). Unit-tests the fixed-window `RateLimiter`
 *  with an injected clock, then the opt-in router wiring (off unless
 *  `RATE_LIMIT_PER_MIN` is set; mutations only; 429 + Retry-After when exceeded). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../server/ratelimit.ts'
import { call } from './helpers/http.ts'

test('RateLimiter allows up to the limit, then blocks within the window', () => {
  let now = 1000
  const rl = new RateLimiter(60_000, () => now)
  assert.equal(rl.check('t', 2).allowed, true)
  assert.equal(rl.check('t', 2).allowed, true)
  const blocked = rl.check('t', 2)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.remaining, 0)
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000)
})

test('RateLimiter resets after the window elapses', () => {
  let now = 0
  const rl = new RateLimiter(1000, () => now)
  assert.equal(rl.check('t', 1).allowed, true)
  assert.equal(rl.check('t', 1).allowed, false)
  now = 1001 // window elapsed
  assert.equal(rl.check('t', 1).allowed, true, 'a fresh window allows again')
})

test('RateLimiter keys are independent (per-tenant isolation)', () => {
  const rl = new RateLimiter(60_000, () => 0)
  assert.equal(rl.check('tenant-a', 1).allowed, true)
  assert.equal(rl.check('tenant-a', 1).allowed, false)
  assert.equal(rl.check('tenant-b', 1).allowed, true, 'a different tenant has its own budget')
})

test('RateLimiter bounds tracked windows — the oldest key is evicted (memory guard)', () => {
  const rl = new RateLimiter(60_000, () => 0, 2) // cap at 2 live windows
  assert.equal(rl.check('a', 1).allowed, true) // a → at its limit
  assert.equal(rl.check('a', 1).allowed, false)
  rl.check('b', 1) // windows: {a, b}
  rl.check('c', 1) // adding c exceeds the cap → evicts the oldest (a) → {b, c}
  assert.equal(rl.check('a', 1).allowed, true, 'a was evicted, so it gets a fresh window')
  assert.equal(rl.check('c', 1).allowed, false, 'c is still tracked and already at its limit')
})

test('the router does NOT rate-limit when RATE_LIMIT_PER_MIN is unset (default)', async () => {
  delete process.env.RATE_LIMIT_PER_MIN
  for (let i = 0; i < 5; i++) {
    const res = await call('POST', '/dispatch', { title: `unlimited ${i}` })
    assert.equal(res.status, 200)
  }
})

// Note: window *reset* (a blocked tenant allowed again next window) is covered at the
// unit level above ("resets after the window elapses") — the router calls the same
// check() with a real clock, so an end-to-end reset test would need a 60s wait.
test('the router rate-limits mutations per tenant when configured (429 + Retry-After)', async () => {
  process.env.RATE_LIMIT_PER_MIN = '3'
  try {
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      codes.push((await call('POST', '/dispatch', { title: `limited ${i}` })).status)
    }
    assert.deepEqual(codes, [200, 200, 200, 429], 'the 4th mutation in the window is refused')

    const blocked = await call('POST', '/dispatch', { title: 'still blocked' })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.json.error.code, 'limit_exceeded')
    assert.ok(blocked.headers['retry-after'], 'a Retry-After header is set')

    // GETs are never limited, even while mutations are blocked.
    assert.equal((await call('GET', '/dispatch')).status, 200)
  } finally {
    delete process.env.RATE_LIMIT_PER_MIN
  }
})
