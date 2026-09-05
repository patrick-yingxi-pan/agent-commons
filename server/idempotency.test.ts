/** Idempotency keys for create-mutations (design F3 PD15). A retried request that
 *  carries the same `Idempotency-Key` replays the first response instead of creating
 *  a second resource; without the header, each request runs normally. Also covers
 *  the cache + capture/replay units directly. Drives the real route table via the
 *  HTTP helper (in-memory store). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './testkit/http.ts'
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IdempotencyCache,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  captureResponse,
  idempotencyPrincipalKey,
  idempotencyRequestFingerprint,
  idempotencyRequestScope,
  replayResponse,
  type CachedResponse,
} from './idempotency.ts'

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

test('one principal key replays its operation, rejects another, and bounds key size', async () => {
  const key = `request-identity-${Date.now()}`
  const first = await call('POST', '/dispatch', { title: 'Fingerprint owner' }, KEY(key))
  assert.equal(first.status, 200)

  const changedBody = await call('POST', '/dispatch', { title: 'Changed intent' }, KEY(key))
  assert.equal(changedBody.status, 200)
  assert.deepEqual(changedBody.json, first.json,
    'completed logical truth replays before a rebased or otherwise changed retry body is parsed')
  assert.equal(changedBody.headers['idempotency-replayed'], 'true')

  const changedTarget = await call('POST', '/schedules', {}, KEY(key))
  assert.equal(changedTarget.status, 409)
  assert.equal(changedTarget.json.error.code, 'conflict')

  const tooLong = await call(
    'POST',
    '/dispatch',
    { title: 'Never created' },
    KEY('x'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)),
  )
  assert.equal(tooLong.status, 400)
  assert.equal(tooLong.json.error.code, 'bad_request')
})

test('POST /sessions is idempotent under a key (no duplicate session)', async () => {
  const before = ((await call('GET', '/sessions')).json as unknown[]).length
  const first = await call('POST', '/sessions', { firstMessage: 'hi' }, KEY('session-k1'))
  const retry = await call('POST', '/sessions', { firstMessage: 'hi' }, KEY('session-k1'))
  assert.equal((first.json as { id: string }).id, (retry.json as { id: string }).id)
  const after = ((await call('GET', '/sessions')).json as unknown[]).length
  assert.equal(after - before, 1, 'one session created across two keyed POSTs')
})

test('an outer Idempotency-Key does NOT bleed into the inner dispatch (the synthetic re-entry strips it)', async () => {
  // The MCP door re-enters the router for every tools/call. The OUTER request's
  // key names the outer operation — forwarded inward, it would make the second
  // (different!) inner create replay the first's cached 2xx. Two distinct inner
  // creates under one outer key must stay distinct.
  const mcpCreate = async (id: number, title: string) => {
    const r = await call(
      'POST',
      '/mcp',
      { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'post_dispatch', arguments: { body: { title } } } },
      KEY('outer-transport-k1'),
    )
    return JSON.parse(r.json.result.content[0].text) as { status: number; body: { id: string; title: string } }
  }
  const a = await mcpCreate(9001, 'first inner create')
  const b = await mcpCreate(9002, 'second inner create')
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.notEqual(a.body.id, b.body.id, 'two distinct inner resources — no replay of an unrelated inner 2xx')
  assert.equal(b.body.title, 'second inner create', "the second create's own body ran, not the first's cache")
})

// ── Unit: the cache + capture/replay ─────────────────────────────────────────
test('IdempotencyCache stores and expires entries', () => {
  const cache = new IdempotencyCache(10_000)
  const rec: CachedResponse = { status: 200, body: '{"ok":true}', contentType: 'application/json' }
  assert.equal(cache.get('k'), undefined)
  cache.put('k', rec, 'scope')
  assert.deepEqual(cache.get('k'), rec)

  const expired = new IdempotencyCache(-1) // already-past TTL → every read is a miss
  expired.put('k', rec, 'scope')
  assert.equal(expired.get('k'), undefined, 'an expired entry reads as a miss')
})

test('request fingerprints ignore object field order but bind method, target, and body', () => {
  const a = idempotencyRequestFingerprint('post', '/widgets/one?mode=safe', { b: 2, a: { y: 2, x: 1 } })
  const reordered = idempotencyRequestFingerprint('POST', '/widgets/one?mode=safe', { a: { x: 1, y: 2 }, b: 2 })
  assert.equal(reordered, a)
  assert.notEqual(idempotencyRequestFingerprint('PATCH', '/widgets/one?mode=safe', { b: 2, a: { y: 2, x: 1 } }), a)
  assert.notEqual(idempotencyRequestFingerprint('POST', '/widgets/two?mode=safe', { b: 2, a: { y: 2, x: 1 } }), a)
  assert.notEqual(idempotencyRequestFingerprint('POST', '/widgets/one?mode=safe', { b: 3, a: { y: 2, x: 1 } }), a)
  assert.equal(
    idempotencyRequestScope('post', '/widgets/one?mode=safe'),
    idempotencyRequestScope('POST', '/widgets/one?mode=safe'),
  )
  assert.notEqual(
    idempotencyRequestScope('POST', '/widgets/one?mode=safe'),
    idempotencyRequestScope('POST', '/widgets/two?mode=safe'),
  )
  assert.notEqual(
    idempotencyPrincipalKey('actor-a', 'tenant-a', 'same-key'),
    idempotencyPrincipalKey('actor-b', 'tenant-a', 'same-key'),
  )
  assert.notEqual(
    idempotencyPrincipalKey('actor-a', 'tenant-a', 'same-key'),
    idempotencyPrincipalKey('actor-a', 'tenant-b', 'same-key'),
  )
})

test('concurrent exact requests share one owner and one response', async () => {
  const cache = new IdempotencyCache()
  const rec: CachedResponse = { status: 201, body: '{"created":1}', contentType: 'application/json' }
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let executions = 0
  const operation = async () => {
    executions += 1
    await gate
    return rec
  }

  const leader = cache.execute('shared', 'same-operation', 'same-request', operation)
  const follower = cache.execute('shared', 'same-operation', 'same-request', operation)
  assert.equal(cache.inFlight, 1)
  assert.equal(executions, 1, 'only the reservation owner enters the handler')
  release()

  const [owned, replayed] = await Promise.all([leader, follower])
  assert.deepEqual(owned, { response: rec, replayed: false })
  assert.deepEqual(replayed, { response: rec, replayed: true })
  assert.equal(executions, 1)
  assert.equal(cache.inFlight, 0)
  assert.equal(cache.size, 1)
})

test('changed concurrent input or a different completed operation conflicts', async () => {
  const cache = new IdempotencyCache()
  const rec: CachedResponse = { status: 200, body: '{}', contentType: 'application/json' }
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const leader = cache.execute('shared', 'same-operation', 'request-a', async () => {
    await gate
    return rec
  })

  await assert.rejects(
    cache.execute('shared', 'same-operation', 'request-b', async () => rec),
    IdempotencyConflictError,
  )
  release()
  await leader
  await assert.rejects(
    cache.execute('shared', 'different-operation', 'request-b', async () => rec),
    IdempotencyConflictError,
  )
})

test('completed retention and unique in-flight work are strictly bounded', async () => {
  const rec = (body: string): CachedResponse => ({ status: 200, body, contentType: 'x' })
  const cache = new IdempotencyCache(10_000, { maxEntries: 2, maxBytes: 100, maxInFlight: 1 })
  cache.put('a', rec('a'), 'a')
  cache.put('b', rec('b'), 'b')
  cache.put('c', rec('c'), 'c')
  assert.equal(cache.get('a'), undefined, 'oldest completion is evicted at the count limit')
  assert.equal(cache.size, 2)
  assert.ok(cache.bytes <= 100)

  cache.put('oversized', rec('z'.repeat(100)), 'oversized')
  assert.equal(cache.get('oversized'), undefined, 'one response cannot exceed the byte budget')
  assert.ok(cache.bytes <= 100)
  const retained = rec('retained')
  cache.put('stable', retained, 'stable')
  cache.put('stable', rec('z'.repeat(100)), 'stable')
  assert.deepEqual(cache.get('stable'), retained, 'an oversized replacement cannot erase retained truth')

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const leader = cache.execute('pending-a', 'operation-a', 'pending-a', async () => {
    await gate
    return rec('done')
  })
  await assert.rejects(
    cache.execute('pending-b', 'operation-b', 'pending-b', async () => rec('never')),
    IdempotencyCapacityError,
  )
  release()
  await leader
  assert.equal(cache.inFlight, 0)
})

test('a failed owner is shared only with current waiters and remains retryable', async () => {
  const cache = new IdempotencyCache()
  const failure: CachedResponse = { status: 503, body: '{"error":true}', contentType: 'application/json' }
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let executions = 0
  const first = cache.execute('retryable', 'same-operation', 'same', async () => {
    executions += 1
    await gate
    return failure
  })
  const concurrent = cache.execute('retryable', 'same-operation', 'same', async () => {
    executions += 1
    return failure
  })
  release()
  assert.deepEqual((await Promise.all([first, concurrent])).map((result) => result.replayed), [false, true])
  assert.equal(executions, 1)
  assert.equal(cache.size, 0, 'non-2xx responses do not graduate into retention')

  await cache.execute('retryable', 'same-operation', 'same', async () => {
    executions += 1
    return { ...failure, status: 200 }
  })
  assert.equal(executions, 2, 'a later explicit retry owns a fresh execution')
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
