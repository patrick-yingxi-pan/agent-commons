/** Idempotency keys for create-mutations (design F3 PD15). A retried request that
 *  carries the same `Idempotency-Key` replays the first response instead of creating
 *  a second resource; without the header, each request runs normally. Also covers
 *  the cache + capture/replay units directly. Drives the real route table via the
 *  HTTP helper (in-memory store). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { IdempotencyCache, captureResponse, replayResponse, type CachedResponse } from '../server/idempotency.ts'

const KEY = (k: string) => ({ 'idempotency-key': k })

test('POST /dispatch with the same key creates exactly one run and replays the response', async () => {
  const before = ((await call('GET', '/dispatch')).json as unknown[]).length

  const first = await call('POST', '/dispatch', { title: 'Idempotent run' }, KEY('dispatch-k1'))
  const retry = await call('POST', '/dispatch', { title: 'Idempotent run' }, KEY('dispatch-k1'))

  assert.equal(first.status, 200)
  assert.equal(retry.status, 200)
  assert.deepEqual(retry.json, first.json, 'the retry replays the identical recorded response')

  const after = ((await call('GET', '/dispatch')).json as unknown[]).length
  assert.equal(after - before, 1, 'the handler ran once despite two requests')
})

test('POST /dispatch without a key is not deduplicated (transparent)', async () => {
  const before = ((await call('GET', '/dispatch')).json as { id: string }[])
  const a = await call('POST', '/dispatch', { title: 'Plain run' })
  const b = await call('POST', '/dispatch', { title: 'Plain run' })
  assert.notEqual((a.json as { id: string }).id, (b.json as { id: string }).id, 'two distinct runs')
  const after = ((await call('GET', '/dispatch')).json as unknown[]).length
  assert.equal(after - before.length, 2, 'both requests created a run')
})

test('distinct keys do not collide', async () => {
  const a = await call('POST', '/dispatch', { title: 'A' }, KEY('dispatch-kA'))
  const b = await call('POST', '/dispatch', { title: 'B' }, KEY('dispatch-kB'))
  assert.notEqual((a.json as { id: string }).id, (b.json as { id: string }).id)
})

test('POST /sessions is idempotent under a key (no duplicate session)', async () => {
  const before = ((await call('GET', '/sessions')).json as unknown[]).length
  const first = await call('POST', '/sessions', { firstMessage: 'hi' }, KEY('session-k1'))
  const retry = await call('POST', '/sessions', { firstMessage: 'hi' }, KEY('session-k1'))
  assert.equal((first.json as { id: string }).id, (retry.json as { id: string }).id)
  const after = ((await call('GET', '/sessions')).json as unknown[]).length
  assert.equal(after - before, 1, 'one session created across two keyed POSTs')
})

// ── Unit: the cache + capture/replay ─────────────────────────────────────────
test('IdempotencyCache stores and expires entries', () => {
  const cache = new IdempotencyCache(10_000)
  const rec: CachedResponse = { status: 200, body: '{"ok":true}', contentType: 'application/json' }
  assert.equal(cache.get('k'), undefined)
  cache.put('k', rec)
  assert.deepEqual(cache.get('k'), rec)

  const expired = new IdempotencyCache(-1) // already-past TTL → every read is a miss
  expired.put('k', rec)
  assert.equal(expired.get('k'), undefined, 'an expired entry reads as a miss')
})

test('captureResponse records what was written and forwards to the real response', () => {
  let realStatus = 0
  let realBody = ''
  const real: any = {
    writeHead(s: number) {
      realStatus = s
      return real
    },
    end(chunk?: string) {
      if (chunk) realBody += chunk
    },
    setHeader() {},
    write(c: string) {
      realBody += c
      return true
    },
    flushHeaders() {},
    on() {},
    get writableEnded() {
      return false
    },
  }
  const cap = captureResponse(real)
  cap.res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' })
  cap.res.end('{"created":1}')
  assert.equal(realStatus, 201, 'forwarded to the real response')
  assert.equal(realBody, '{"created":1}')
  assert.deepEqual(cap.record(), { status: 201, body: '{"created":1}', contentType: 'application/json; charset=utf-8' })

  // A handler that wrote nothing is not cacheable.
  const empty = captureResponse(real)
  assert.equal(empty.record(), null)
})

test('replayResponse re-emits a recorded response with the replayed marker', () => {
  let status = 0
  let body = ''
  const headers: Record<string, string> = {}
  const res: any = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s
      Object.assign(headers, h)
      return res
    },
    end(chunk?: string) {
      if (chunk) body += chunk
    },
    setHeader() {},
    write() {
      return true
    },
    flushHeaders() {},
    on() {},
    get writableEnded() {
      return false
    },
  }
  replayResponse(res, { status: 200, body: '{"x":1}', contentType: 'application/json' })
  assert.equal(status, 200)
  assert.equal(body, '{"x":1}')
  assert.equal(headers['Idempotency-Replayed'], 'true')
})
