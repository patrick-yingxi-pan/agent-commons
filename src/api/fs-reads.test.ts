import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFsCatalog, readFsFolder, readFsSources, readFsSnapshot } from './fsReads.ts'
import { accountGeneration, switchAccount } from './account.ts'

test('all picker reads share a 30-second deadline that also covers delayed response bodies', async (t) => {
  for (const read of [readFsSources, () => readFsCatalog('cloud'), () => readFsFolder('cloud', 'notes'), () => readFsSnapshot('cloud', 'notes.txt')]) {
    const deadline = new AbortController()
    let suppliedSignal: AbortSignal | undefined
    let deadlineMs = 0
    t.mock.method(AbortSignal, 'timeout', (ms: number) => { deadlineMs = ms; return deadline.signal })
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      suppliedSignal = options.signal
      return { status: 200, ok: true, headers: new Headers(), text: async () => { deadline.abort(); return '{}' } } as Response
    })
    await assert.rejects(read(), /aborted/i)
    assert.equal(deadlineMs, 30_000)
    assert.equal(suppliedSignal?.aborted, true)
    t.mock.restoreAll()
  }
})

test('folder intake cancellation and account changes cannot publish a late response', async (t) => {
  for (const change of ['cancel', 'account']) {
    const intake = new AbortController()
    const generation = accountGeneration()
    t.mock.method(globalThis, 'fetch', async (_url, options) => ({
      status: 200, ok: true, headers: new Headers(),
      text: async () => {
        if (change === 'cancel') intake.abort()
        else switchAccount({ userId: 'different-user', tenantId: 'different-tenant' })
        assert.equal(change === 'cancel' ? options.signal.aborted : accountGeneration() !== generation, true)
        return '{"artifacts":[]}'
      },
    }) as Response)
    try { await assert.rejects(readFsFolder('cloud', 'notes', intake.signal), /aborted|response dropped/i) }
    finally { t.mock.restoreAll(); switchAccount(null) }
  }
})

test('explicit snapshot reads are uncached and validate exact source, path and whole-text bounds', async (t) => {
  const snapshot = {
    version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'notes & tips.txt', text: 'saved text',
  }
  let response: unknown = snapshot
  const urls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url))
    return new Response(JSON.stringify(response), { status: 200 })
  })
  assert.deepEqual(await readFsSnapshot('cloud', snapshot.path), snapshot)
  assert.deepEqual(await readFsSnapshot('cloud', snapshot.path), snapshot)
  assert.equal(urls.length, 2, 'each explicit gesture reads once, with no query-cache reuse')
  assert.ok(urls.every((url) => url.endsWith('/fs/snapshot?source=cloud&path=notes%20%26%20tips.txt')))
  for (const bad of [
    { ...snapshot, sourceId: 'runner:other' }, { ...snapshot, path: 'other.txt' },
    { ...snapshot, text: 'é'.repeat(32_769) }, { ...snapshot, capturedAt: 'yesterday' },
  ]) {
    response = bad
    await assert.rejects(readFsSnapshot('cloud', snapshot.path), /invalid saved copy/)
  }
})

test('snapshot reads fence cancellation and switched-account response bodies', async (t) => {
  for (const change of ['cancel', 'account']) {
    const intake = new AbortController()
    t.mock.method(globalThis, 'fetch', async () => ({
      status: 200, ok: true, headers: new Headers(),
      text: async () => {
        if (change === 'cancel') intake.abort()
        else switchAccount({ userId: 'snapshot-other-user', tenantId: 'snapshot-other-tenant' })
        return '{}'
      },
    }) as Response)
    try { await assert.rejects(readFsSnapshot('cloud', 'notes.txt', intake.signal), /aborted|response dropped/i) }
    finally { t.mock.restoreAll(); switchAccount(null) }
  }
})
