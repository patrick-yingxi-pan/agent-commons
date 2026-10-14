import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalConnectionHost } from './localConnectionHost.mjs'
import { LocalConnectionError } from './localConnectionStore.mjs'

const event = { sender: 'trusted' }
const otherEvent = { sender: 'other' }
const identity = { user: { id: 'user-a' }, tenant: { id: 'tenant-a', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const source = { identity, cookieGeneration: 1, cookieFingerprint: 'fingerprint-a' }
const expected = { namespace: 'tenant-a', userId: 'user-a' }
const id = `GIT_${'A'.repeat(32)}`
const operationId = '4ca5af48-2a21-4c80-9bfe-f627ef872e23'
const request = { scope: 'file-comparison', operationId, path: 'src/main.ts', comparison: 'staged' }
const ready = { version: 1, scope: 'file-comparison', path: 'src/main.ts', comparison: 'staged',
  head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, status: 'ready', change: 'modified',
  before: { kind: 'text', text: 'old', mode: '100644' }, after: { kind: 'text', text: 'new', mode: '100644' } }

function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>((done) => { resolve = done })
  return { promise, resolve }
}

function setup({ store, resolveSource = async () => source, connectionKind = 'git' }: any) {
  return createLocalConnectionHost({ store, resolveSource, connectionKind,
    assertCaller(candidate: any) { assert.ok(candidate === event || candidate === otherEvent) },
    showFolderDialog: async () => ({ canceled: true, filePaths: [] }) })
}

test('file comparison host validates closed requests before source or store access and detaches replies', async () => {
  const calls: unknown[][] = []
  const store = {
    async fileComparison(owner: any, connectionId: string, frozen: any) {
      calls.push(['read', owner, connectionId, frozen])
      return ready
    },
    async cancelFileComparison(owner: any, connectionId: string, frozen: any) {
      calls.push(['cancel', owner, connectionId, frozen])
      return true
    },
  }
  const host = setup({ store })
  const selected = { ...request }
  const result = await host.fileComparison(event, id, selected, expected)
  assert.deepEqual(calls[0], ['read', expected, id, request])
  assert.deepEqual(result, ready)
  assert.notStrictEqual(result, ready)
  assert.equal(await host.cancelFileComparison(event, id, { scope: 'file-comparison', operationId }, expected), false,
    'completed operation IDs are no longer cancellable')

  await assert.rejects(host.fileComparison(event, id, { ...request, extra: true }, expected), LocalConnectionError)
  await assert.rejects(host.fileComparison(event, id, { ...request, scope: 'untracked' }, expected), LocalConnectionError)
  await assert.rejects(host.fileComparison(event, id, { ...request, operationId: 'not-a-uuid' }, expected), LocalConnectionError)
  await assert.rejects(host.fileComparison(event, id, { ...request, comparison: 'raw' }, expected), LocalConnectionError)
  await assert.rejects(host.fileComparison(event, 'GIT_../../private', request, expected), LocalConnectionError)
  const accessor = Object.defineProperty({}, 'scope', { enumerable: true, get() { throw new Error('getter') } })
  await assert.rejects(host.fileComparison(event, id, accessor, expected), LocalConnectionError)
  await assert.rejects(host.fileComparison(event, id, request, expected, 'extra'), LocalConnectionError)
  const folder = setup({ store, connectionKind: 'folder' })
  await assert.rejects(folder.fileComparison(event, id, request, expected), LocalConnectionError)
  assert.equal(calls.length, 1, 'invalid reads are rejected before store access')
})

test('comparison host cancellation is exact to sender, connection, owner and operation, including pre-admission', async () => {
  const lookup = deferred()
  const calls: unknown[][] = []
  let reads = 0
  const host = setup({ store: {
    async fileComparison(owner: any, connectionId: string, frozen: any) {
      reads++
      calls.push(['read', owner, connectionId, frozen])
      return ready
    },
    async cancelFileComparison(owner: any, connectionId: string, frozen: any) {
      calls.push(['cancel', owner, connectionId, frozen])
      return true
    },
  }, resolveSource: async () => lookup.promise })
  const pending = assert.rejects(host.fileComparison(event, id, request, expected), LocalConnectionError)
  assert.equal(await host.cancelFileComparison(otherEvent, id, { scope: 'file-comparison', operationId }, expected), false)
  assert.equal(await host.cancelFileComparison(event, `GIT_${'B'.repeat(32)}`, { scope: 'file-comparison', operationId }, expected), false)
  assert.equal(await host.cancelFileComparison(event, id, { scope: 'file-comparison', operationId: 'd33ecf7d-167c-460e-a9fc-59b0c9cedb4d' }, expected), false)
  assert.equal(await host.cancelFileComparison(event, id, { scope: 'file-comparison', operationId }, { namespace: 'tenant-b', userId: 'other' }), false)
  assert.equal(await host.cancelFileComparison(event, id, { scope: 'file-comparison', operationId }, expected), true)
  lookup.resolve(source)
  await pending
  assert.equal(reads, 0, 'cancel before source admission does not dispatch')
  assert.deepEqual(calls, [], 'cancelling before source admission never calls the store')
})

test('comparison host freezes request before waits and rejects changed source or malformed native results', async () => {
  const lookup = deferred()
  const native = deferred()
  const received: unknown[] = []
  const selected = { ...request }
  const switched = { ...source, cookieGeneration: 2 }
  let sourceCalls = 0
  const host = setup({
    store: { async fileComparison(_owner: any, _id: string, frozen: any) { received.push(frozen); return native.promise } },
    resolveSource: async () => {
      sourceCalls++
      if (sourceCalls === 1) return lookup.promise
      return sourceCalls === 2 ? switched : source
    },
  })
  const pending = assert.rejects(host.fileComparison(event, id, selected, expected), LocalConnectionError)
  selected.path = 'changed-after-call.ts'
  lookup.resolve(source)
  while (!received.length) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(received, [request])
  native.resolve(ready)
  await pending

  const malformed = setup({ store: { async fileComparison() { return { ...ready, unexpected: true } } } })
  await assert.rejects(malformed.fileComparison(event, id, request, expected), LocalConnectionError)
  const wrongPath = setup({ store: { async fileComparison() { return { ...ready, path: 'other.ts' } } } })
  await assert.rejects(wrongPath.fileComparison(event, id, request, expected), LocalConnectionError)
})

test('a started comparison remains cancellable after a source transition and cannot publish its late result', async () => {
  const native = deferred()
  const entered = deferred()
  const switched = { ...source, cookieFingerprint: 'fingerprint-b' }
  let current = source
  const calls: unknown[][] = []
  const host = setup({
    store: {
      async fileComparison(owner: any, connectionId: string, frozen: any) {
        entered.resolve(undefined)
        calls.push(['read', owner, connectionId, frozen])
        return native.promise
      },
      async cancelFileComparison(owner: any, connectionId: string, exactId: string) {
        calls.push(['cancel', owner, connectionId, exactId])
        return true
      },
    },
    resolveSource: async () => current,
  })
  const pending = assert.rejects(host.fileComparison(event, id, request, expected), LocalConnectionError)
  await entered.promise
  // The renderer's account/cookie has moved on; cancellation still addresses
  // the captured operation through its original owner binding.
  current = switched
  assert.equal(await host.cancelFileComparison(event, id, { scope: 'file-comparison', operationId }, expected), true)
  assert.deepEqual(calls[1], ['cancel', expected, id, operationId])
  native.resolve(ready)
  await pending
})
