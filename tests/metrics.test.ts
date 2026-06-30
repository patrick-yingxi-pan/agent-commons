/** /metrics (design F6 PD31) — Prometheus text exposition: per-method request
 *  counters (over matched routes), process uptime, and the store epoch as an info
 *  label. Uses callRaw because the body is text, not JSON. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'

const getCount = (body: string): number => {
  const m = body.match(/http_requests_total\{method="GET"\} (\d+)/)
  return m ? Number(m[1]) : -1
}

test('GET /metrics exposes per-method counters, uptime, and the epoch in Prometheus text', async () => {
  const res = await callRaw('GET', '/metrics')
  assert.equal(res.status, 200)
  assert.match(res.body, /# TYPE http_requests_total counter/)
  assert.match(res.body, /http_requests_total\{method="GET"\} \d+/)
  assert.match(res.body, /process_uptime_seconds \d/, 'uptime is reported')
  assert.match(res.body, /store_epoch_info\{epoch="[^"]+"\} 1/, 'the epoch is an info label')
})

test('the GET counter actually increments (not stuck at a constant)', async () => {
  const before = getCount((await callRaw('GET', '/metrics')).body)
  await call('GET', '/healthz')
  await call('GET', '/healthz')
  const after = getCount((await callRaw('GET', '/metrics')).body)
  // Two explicit GET /healthz plus the second /metrics scrape itself ⇒ delta ≥ 2.
  assert.ok(before >= 0 && after - before >= 2, `GET count rose by ${after - before} (expected ≥ 2)`)
})
