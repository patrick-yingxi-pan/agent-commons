import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFsCatalog, readFsFolder, readFsSources } from './fsReads.ts'
import { accountGeneration, switchAccount } from './account.ts'

test('all picker reads share a 30-second deadline that also covers delayed response bodies', async (t) => {
  for (const read of [readFsSources, () => readFsCatalog('cloud'), () => readFsFolder('cloud', 'notes')]) {
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
