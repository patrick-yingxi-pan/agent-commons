import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFsDocumentBytes } from './fsDocumentBytes.ts'
import { refreshAccount } from './account.ts'

test('document bytes use an explicit uncached, redirect-refusing source read and a 30-second deadline', async (t) => {
  const calls: unknown[][] = []
  const deadline = new AbortController()
  t.mock.method(AbortSignal, 'timeout', (ms) => { assert.equal(ms, 30_000); return deadline.signal })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options])
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })
  })
  for (let i = 0; i < 2; i++) assert.deepEqual(await readFsDocumentBytes('runner:one', 'docs/a & b.pdf', 8), new Uint8Array([1, 2, 3]))
  assert.equal(calls.length, 2)
  for (const [url, options] of calls) {
    assert.ok(String(url).endsWith('/fs/content?source=runner%3Aone&path=docs%2Fa%20%26%20b.pdf'))
    assert.equal(options.cache, 'no-store')
    assert.equal(options.redirect, 'error')
    assert.equal(options.signal.aborted, true, 'reader releases network lifetime on completion')
  }
})

test('invalid sources, paths, budgets and prior cancellation refuse before I/O', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected fetch') })
  for (const [source, path, limit] of [['ui-host', 'a.pdf', 8], ['cloud', '../secret.pdf', 8], ['cloud', 'a.pdf', 0], ['cloud', 'a.pdf', 8 * 1024 * 1024 + 1]]) {
    await assert.rejects(readFsDocumentBytes(source, path, limit), /source is invalid/)
  }
  const abort = new AbortController(); abort.abort()
  await assert.rejects(readFsDocumentBytes('cloud', 'a.pdf', 8, abort.signal), /aborted/i)
  assert.equal(calls, 0)
})

test('oversized declared bodies are refused before a reader is obtained', async (t) => {
  let reads = 0
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, headers: new Headers({ 'content-length': '9' }),
    body: { getReader() { reads++; throw new Error('unexpected body read') } },
  }) as unknown as Response)
  await assert.rejects(readFsDocumentBytes('cloud', 'a.pdf', 8), /up to 8 MB/)
  assert.equal(reads, 0)
})

test('streaming bytes stop at the ceiling even without a trustworthy Content-Length', async (t) => {
  let cancelled = false
  let pulls = 0
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(5)); if (pulls === 4) controller.close() },
    cancel() { cancelled = true },
  })))
  await assert.rejects(readFsDocumentBytes('cloud', 'a.pdf', 8), /up to 8 MB/)
  assert.equal(cancelled, true)
  assert.ok(pulls <= 3, 'the reader never drains an unbounded response')
})

test('empty, truncated, malformed size and HTTP errors never publish document bytes', async (t) => {
  for (const response of [
    new Response(new Uint8Array()), new Response(new Uint8Array([1]), { headers: { 'content-length': '2' } }),
    new Response(new Uint8Array([1]), { headers: { 'content-length': 'not a size' } }),
    new Response('error', { status: 404 }),
  ]) {
    t.mock.method(globalThis, 'fetch', async () => response)
    await assert.rejects(readFsDocumentBytes('cloud', 'a.pdf', 8), /could not be read|invalid document size/)
    t.mock.restoreAll()
  }
})

test('account changes and cancellation during body reads refuse late bytes', async (t) => {
  for (const kind of ['account', 'cancel', 'deadline', 'echo']) {
    const abort = new AbortController()
    const deadline = new AbortController()
    refreshAccount({ userId: 'ada', tenantId: 'a' })
    t.mock.method(AbortSignal, 'timeout', () => deadline.signal)
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      pull(controller) {
        if (kind === 'account') refreshAccount({ userId: 'grace', tenantId: 'b' })
        if (kind === 'cancel') abort.abort()
        if (kind === 'deadline') deadline.abort()
        controller.enqueue(new Uint8Array([1])); controller.close()
      },
    }), { headers: { 'x-resolved-tenant': kind === 'echo' ? 'b' : 'a' } }))
    try { await assert.rejects(readFsDocumentBytes('cloud', 'a.pdf', 8, abort.signal), /aborted|response dropped/i) }
    finally { t.mock.restoreAll(); refreshAccount(null) }
  }
})
