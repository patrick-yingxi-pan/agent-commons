/** Graceful-shutdown draining (design F6 ops) — on SIGTERM the process flips a drain
 *  latch so GET /readyz fails (503) and the load balancer stops routing new traffic here,
 *  while liveness (/healthz) stays up so the orchestrator doesn't hard-kill it mid-drain.
 *  Own test file: beginDraining is a one-way latch, so it gets its own process/store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { store } from '../server/store.ts'

test('/readyz flips to 503 draining after beginDraining; /healthz stays up', async () => {
  const ready = await call('GET', '/readyz')
  assert.equal(ready.status, 200)
  assert.equal(ready.json.status, 'ready')

  store.beginDraining()

  const draining = await call('GET', '/readyz')
  assert.equal(draining.status, 503, 'a draining instance reports unready')
  assert.equal(draining.json.status, 'draining')

  const live = await call('GET', '/healthz')
  assert.equal(live.status, 200, 'liveness stays up during drain')
  assert.equal(live.json.status, 'ok')
})
