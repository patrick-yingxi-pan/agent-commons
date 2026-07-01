/** P7 dispatch concurrency limiting — bound the in-flight one-off runs so unbounded dispatch
 *  can't pile up. Opt-in via DISPATCH_MAX_CONCURRENT (off by default, so the demo + the other
 *  dispatch tests are unaffected), mirroring the rate-limiter's opt-in shape. Only LIVE-minted
 *  (d-new-*) running runs count toward the cap — the seed feed's permanent 'running' fixture
 *  (d1) has no completing timer and must not consume a slot. The runs created here settle a
 *  beat later via their timers (harmless); the checks are synchronous, before any fire. */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call, callRaw } from './helpers/http.ts'

afterEach(() => {
  delete process.env.DISPATCH_MAX_CONCURRENT
})

test('over the cap, addDispatch refuses with a limit_exceeded error (store guard)', () => {
  process.env.DISPATCH_MAX_CONCURRENT = '2'
  const a = store.addDispatch('run A')
  const b = store.addDispatch('run B')
  assert.equal(a.status, 'running', 'first run is admitted')
  assert.equal(b.status, 'running', 'second run fills the cap')
  // The third exceeds the cap → refused (the route maps this to a 429).
  assert.throws(
    () => store.addDispatch('run C'),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'limit_exceeded',
    'a run over the concurrency cap is refused',
  )
})

test('the cap is off by default (unset ⇒ unlimited)', () => {
  // No env → many runs land without refusal.
  for (let i = 0; i < 6; i += 1) assert.equal(store.addDispatch(`unlimited ${i}`).status, 'running')
})

test('POST /dispatch returns 429 when the concurrency cap is reached (route mapping)', async () => {
  // Cap = current in-flight + 1, so exactly one more run fills the last slot and the next is
  // refused — robust to runs the earlier tests left in-flight (their timers haven't fired yet).
  const inFlight = store.listDispatch().filter((r) => r.status === 'running' && r.id.startsWith('d-new-')).length
  process.env.DISPATCH_MAX_CONCURRENT = String(inFlight + 1)
  const first = await call('POST', '/dispatch', { title: 'route run 1' })
  assert.equal(first.status, 200, 'the run filling the last slot is admitted')
  const second = await callRaw('POST', '/dispatch', { title: 'route run 2' })
  assert.equal(second.status, 429, 'the next run is refused over the cap')
  const body = JSON.parse(second.body)
  assert.equal(body.error.code, 'limit_exceeded', 'the refusal is a limit_exceeded error')
})
