/** Baseline security headers (design F5) — every API response (success and error) carries
 *  nosniff, frame-options/CSP frame-ancestors, and a referrer policy. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { sendText, sendBytes } from '../server/http/respond.ts'
import { openSse } from '../server/http/sse.ts'
import { replayResponse } from '../server/idempotency.ts'

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

test('the 304 conditional-GET path carries security headers', async () => {
  const first = await call('GET', '/capabilities')
  const etag = first.headers['etag']
  assert.ok(etag)
  const notModified = await call('GET', '/capabilities', undefined, { 'if-none-match': etag })
  assert.equal(notModified.status, 304)
  assert.equal(notModified.headers['x-content-type-options'], 'nosniff', '304 is not exempt')
})

// Pin EACH writeHead site independently (not just the shared JSON path), so a future
// refactor of one sender can't silently drop the security set.
function fakeRes() {
  const headers: Record<string, string> = {}
  const res = {
    writeHead(_s: number, h?: Record<string, string>) {
      if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v)
      return res
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = String(v)
    },
    write: () => true,
    end: () => {},
    flushHeaders: () => {},
    on: () => {},
    writableEnded: false,
  }
  return { res, headers }
}

test('the text, bytes, SSE, and idempotency-replay senders all carry nosniff', () => {
  const t = fakeRes()
  sendText(t.res as never, 'hi')
  assert.equal(t.headers['x-content-type-options'], 'nosniff', 'sendText (/metrics)')

  const b = fakeRes()
  sendBytes(b.res as never, new Uint8Array([1, 2, 3]), 'image/png')
  assert.equal(b.headers['x-content-type-options'], 'nosniff', 'sendBytes (/fs/content)')

  const s = fakeRes()
  openSse(s.res as never)
  assert.equal(s.headers['x-content-type-options'], 'nosniff', 'SSE stream')

  const r = fakeRes()
  replayResponse(r.res as never, { status: 200, body: '{}', contentType: 'application/json; charset=utf-8' } as never)
  assert.equal(r.headers['x-content-type-options'], 'nosniff', 'idempotency replay')
})
