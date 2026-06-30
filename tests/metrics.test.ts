/** /metrics (design F6 PD31) — Prometheus text exposition: per-method request
 *  counters (over matched routes), process uptime, and the store epoch as an info
 *  label. Uses callRaw because the body is text, not JSON. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'

test('GET /metrics exposes per-method counters, uptime, and the epoch in Prometheus text', async () => {
  await call('GET', '/healthz')
  await call('GET', '/healthz')
  const res = await callRaw('GET', '/metrics')
  assert.equal(res.status, 200)
  assert.match(res.body, /# TYPE http_requests_total counter/)
  assert.match(res.body, /http_requests_total\{method="GET"\} \d+/, 'GET requests are counted')
  assert.match(res.body, /process_uptime_seconds \d/, 'uptime is reported')
  assert.match(res.body, /store_epoch_info\{epoch="[^"]+"\} 1/, 'the epoch is an info label')
})
