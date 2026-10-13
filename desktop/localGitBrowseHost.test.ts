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
