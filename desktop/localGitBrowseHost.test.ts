import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalConnectionHost } from './localConnectionHost.mjs'
import { LocalConnectionError } from './localConnectionStore.mjs'

const event = { sender: 'trusted' }
const identity = { user: { id: 'user-a' }, tenant: { id: 'tenant-a', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const source = { identity, cookieGeneration: 1, cookieFingerprint: 'fingerprint-a' }
const expected = { namespace: 'tenant-a', userId: 'user-a' }
const id = 'GIT_0123456789ABCDEF0123456789ABCDEF'
const listing = { version: 1, files: [{ path: 'src/main.ts', kind: 'file' }], excludedCount: 0 }
const preview = { version: 1, path: 'src/main.ts', sizeBytes: 4, snapshot: { text: 'test' } }

function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>((done) => { resolve = done })
  return { promise, resolve }
}

function setup({ store, resolveSource = async () => source, connectionKind = 'git' }: any) {
  return createLocalConnectionHost({ store, resolveSource, connectionKind,
    assertCaller(candidate: any) { assert.strictEqual(candidate, event) }, showFolderDialog: async () => ({ canceled: true, filePaths: [] }) })
}

test('Git browse host enforces exact arity/source, detached parsed outputs, and exact preview selection', async () => {
  const calls: any[] = []
  const store = {
    async files(owner: any, connectionId: string) { calls.push(['files', owner, connectionId]); return listing },
    async file(owner: any, connectionId: string, selection: any) { calls.push(['file', owner, connectionId, selection]); return preview },
  }
  const host = setup({ store })
  assert.deepEqual(await host.files(event, id, expected), listing)
  const selection = { path: 'src/main.ts' }
  const result = await host.file(event, id, selection, expected)
  assert.deepEqual(result, preview)
  assert.notStrictEqual(result, preview)
  assert.deepEqual(calls, [
    ['files', expected, id], ['file', expected, id, { path: 'src/main.ts' }],
  ])

  await assert.rejects(host.files(event, id, expected, 'extra'), LocalConnectionError)
  await assert.rejects(host.file(event, id, selection, expected, 'extra'), LocalConnectionError)
  await assert.rejects(host.file(event, id, { path: '../private' }, expected), LocalConnectionError)
  await assert.rejects(host.file(event, id, Object.defineProperty({}, 'path', { enumerable: true, get() { throw new Error('getter') } }), expected), LocalConnectionError)
  await assert.rejects(host.files(event, 'GIT_../../private', expected), LocalConnectionError)
  const folder = setup({ store, connectionKind: 'folder' })
  await assert.rejects(folder.files(event, id, expected), LocalConnectionError)
  await assert.rejects(folder.file(event, id, selection, expected), LocalConnectionError)
  assert.equal(calls.length, 2, 'invalid calls are refused before store access')
})

test('browse and preview recheck identity after waits; changed caller selection cannot change admitted preview', async () => {
  const held = deferred()
  const entered = deferred()
  const calls: any[] = []
  const store = {
    async files() { entered.resolve(undefined); return held.promise },
    async file(_owner: any, _id: string, selected: any) { calls.push({ ...selected }); entered.resolve(undefined); return preview },
  }
  let sourceReads = 0
  const switched = { ...source, cookieGeneration: 2 }
  const host = setup({ store, resolveSource: async () => ++sourceReads === 1 ? source : switched })
  const listingPending = assert.rejects(host.files(event, id, expected), LocalConnectionError)
  await entered.promise
  held.resolve(listing)
  await listingPending

  const chosen = { path: 'src/main.ts' }
  const previewEntered = deferred()
  const previewHeld = deferred()
  const previewCalls: any[] = []
  const previewHost = setup({ store: {
    async file(_owner: any, _id: string, selection: any) {
      previewCalls.push({ ...selection })
      previewEntered.resolve(undefined)
      return previewHeld.promise
    },
  }, resolveSource: async () => source })
  const previewPending = previewHost.file(event, id, chosen, expected)
  await previewEntered.promise
  chosen.path = 'changed.txt'
  previewHeld.resolve(preview)
  const previewResult = await previewPending
  assert.deepEqual(previewCalls, [{ path: 'src/main.ts' }])
  assert.deepEqual(previewResult, preview)
})

test('corrupt listing, mismatched preview path, and changed identity during preview fail closed', async () => {
  const badListing = setup({ store: { async files() { return { ...listing, extra: true } }, async file() { return preview } } })
  await assert.rejects(badListing.files(event, id, expected), LocalConnectionError)
  const wrongPath = setup({ store: { async files() { return listing }, async file() { return { ...preview, path: 'other.ts' } } } })
  await assert.rejects(wrongPath.file(event, id, { path: 'src/main.ts' }, expected), LocalConnectionError)

  const held = deferred()
  const entered = deferred()
  let lookups = 0
  const changed = setup({
    store: { async files() { return listing }, async file() { entered.resolve(undefined); return held.promise } },
    resolveSource: async () => ++lookups === 1 ? source : { ...source, cookieFingerprint: 'changed' },
  })
  const pending = assert.rejects(changed.file(event, id, { path: 'src/main.ts' }, expected), LocalConnectionError)
  await entered.promise
  held.resolve(preview)
  await pending
})

test('untracked host validates explicit scope, binds cancellation to source/window/connection, and parses outputs', async () => {
  const operationId = '4ca5af48-2a21-4c80-9bfe-f627ef872e23'
  const request = { scope: 'untracked', operationId }
  const untrackedListing = { scope: 'untracked', version: 1, files: [{ path: 'draft.md', kind: 'file' }], excludedCount: 0 }
  const pending = deferred()
  const calls: unknown[][] = []
  const store = {
    async untrackedFiles(owner: any, connectionId: string, frozen: any) {
      calls.push(['files', owner, connectionId, frozen])
      return pending.promise
    },
    async cancelUntrackedRead(owner: any, connectionId: string, operation: string) {
      calls.push(['cancel', owner, connectionId, operation])
      return true
    },
  }
  const host = setup({ store })
  const listingPending = host.untrackedFiles(event, id, request, expected)
  while (!calls.length) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls[0], ['files', expected, id, request])
  assert.equal(await host.cancelUntrackedRead(event, id, request, expected), true)
  assert.deepEqual(calls[1], ['cancel', expected, id, operationId])
  pending.resolve(untrackedListing)
  assert.deepEqual(await listingPending, untrackedListing)
  await assert.rejects(host.untrackedFiles(event, id, { ...request, scope: 'tracked' }, expected), LocalConnectionError)
  await assert.rejects(host.untrackedFiles(event, id, { ...request, extra: true }, expected), LocalConnectionError)
  const malformed = setup({ store: { async untrackedFiles() { return { ...untrackedListing, scope: 'tracked' } } } })
  await assert.rejects(malformed.untrackedFiles(event, id, request, expected), LocalConnectionError)
})

test('untracked host cancellation reserves synchronously and prevents a late source lookup from dispatching', async () => {
  const operationId = 'f1e5a0d7-ab85-4e7c-9a03-8c51ead2d938'
  const request = { scope: 'untracked', operationId }
  const sourceLookup = deferred()
  let lookups = 0
  let reads = 0
  const store = {
    async untrackedFiles() { reads++; return { scope: 'untracked', version: 1, files: [], excludedCount: 0 } },
    async cancelUntrackedRead() { return true },
  }
  const host = setup({ store, resolveSource: async () => ++lookups === 1 ? sourceLookup.promise : source })
  const pending = assert.rejects(host.untrackedFiles(event, id, request, expected), LocalConnectionError)
  await assert.rejects(host.untrackedFiles(event, id, request, expected), LocalConnectionError, 'duplicate reserved IDs refuse before dispatch')
  assert.equal(await host.cancelUntrackedRead(event, id, request, expected), true)
  sourceLookup.resolve(source)
  await pending
  assert.equal(reads, 0, 'cancelled source lookup cannot start a native reader')
})

test('untracked host freezes path before waits and rejects a cookie/source transition after native read', async () => {
  const operationId = 'f6ff7431-4e82-49c1-b341-d46e32978a69'
  const selected = { scope: 'untracked', path: 'draft.md', operationId }
  const lookup = deferred()
  const native = deferred()
  const received: unknown[] = []
  const switchedSource = { ...source, cookieGeneration: 2 }
  let sourceCalls = 0
  const host = setup({
    store: { async untrackedFile(_owner: any, _id: string, request: any) { received.push(request); return native.promise } },
    resolveSource: async () => {
      sourceCalls++
      if (sourceCalls === 1) return lookup.promise
      return sourceCalls === 2 ? switchedSource : source
    },
  })
  const pending = assert.rejects(host.untrackedFile(event, id, selected, expected), LocalConnectionError)
  selected.path = 'changed-after-call.md'
  lookup.resolve(source)
  while (!received.length) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(received, [{ scope: 'untracked', path: 'draft.md', operationId }])
  native.resolve({ scope: 'untracked', version: 1, path: 'draft.md', sizeBytes: 0, snapshot: { text: '' } })
  await pending
})

test('untracked cancellation still reaches its exact old operation after a source transition', async () => {
  const operationId = '9f4fb75a-44da-496d-9c3d-c29e614e4641'
  const request = { scope: 'untracked', operationId }
  const native = deferred()
  const switched = { ...source, cookieGeneration: 2 }
  const calls: unknown[][] = []
  let reads = 0
  const host = setup({ store: {
    async untrackedFiles(owner: any, connectionId: string) { reads++; calls.push(['read', owner, connectionId]); return native.promise },
    async cancelUntrackedRead(owner: any, connectionId: string, exactId: string) {
      calls.push(['cancel', owner, connectionId, exactId])
      return true
    },
  }, resolveSource: async () => reads === 0 ? source : switched })
  const pending = assert.rejects(host.untrackedFiles(event, id, request, expected), LocalConnectionError)
  while (!reads) await new Promise(resolve => setImmediate(resolve))
  assert.equal(await host.cancelUntrackedRead(event, `GIT_${'B'.repeat(32)}`, request, expected), false)
  assert.equal(await host.cancelUntrackedRead(event, id, { scope: 'untracked', operationId: 'c24a0060-b05e-4b8b-8a8d-37b927606a5c' }, expected), false)
  assert.equal(await host.cancelUntrackedRead(event, id, request, { namespace: 'acme', userId: 'other' }), false)
  assert.equal(await host.cancelUntrackedRead(event, id, request, expected), true)
  assert.deepEqual(calls[1], ['cancel', expected, id, operationId])
  native.resolve({ scope: 'untracked', version: 1, files: [], excludedCount: 0 })
  await pending
})
