import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalConnectionHost } from './localConnectionHost.mjs'
import { LocalConnectionError } from './localConnectionStore.mjs'

const event = { sender: 'trusted' }
const identity = { user: { id: 'user-a' }, tenant: { id: 'tenant-a', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const source = { identity, cookieGeneration: 1, cookieFingerprint: 'fingerprint-a' }
const expected = { namespace: 'tenant-a', userId: 'user-a' }
const id = `LOCAL_${'A'.repeat(32)}`
const listing = { version: 1, visited: 2, hiddenCount: 0, directoryCount: 0,
  files: [{ path: 'nested/note.txt', kind: 'file' }, { path: 'unsupported.bin', kind: 'unsupported' }] }
const preview = { version: 1, path: 'nested/note.txt', sizeBytes: 4, snapshot: { text: 'text' } }

function hostFor(store: any, resolveSource = async () => source) {
  return createLocalConnectionHost({ store, resolveSource, assertCaller(candidate: any) { assert.strictEqual(candidate, event) },
    showFolderDialog: async () => ({ canceled: true, filePaths: [] }) })
}

test('folder browse host requires exact local source and returns detached validated projections', async () => {
  const calls: any[] = []
  const store = {
    async files(owner: any, connectionId: string) { calls.push(['files', owner, connectionId]); return listing },
    async file(owner: any, connectionId: string, selection: any) { calls.push(['file', owner, connectionId, selection]); return preview },
  }
  const host = hostFor(store)
  const result = await host.files(event, id, expected)
  assert.deepEqual(result, listing)
  assert.notStrictEqual(result.files, listing.files)
  const selection = { path: 'nested/note.txt' }
  assert.deepEqual(await host.file(event, id, selection, expected), preview)
  assert.deepEqual(calls, [['files', expected, id], ['file', expected, id, { path: selection.path }]])
  await assert.rejects(host.files(event, id, { namespace: 'other', userId: 'other' }), LocalConnectionError)
  await assert.rejects(host.files(event, id, expected, 'extra'), LocalConnectionError)
  await assert.rejects(host.files(event, `GIT_${'A'.repeat(32)}`, expected), LocalConnectionError)
  await assert.rejects(host.file(event, id, { path: '.hidden.txt' }, expected), LocalConnectionError)
  await assert.rejects(host.file(event, id, { path: '../secret.txt' }, expected), LocalConnectionError)
  await assert.rejects(host.file(event, id, selection, expected, 'extra'), LocalConnectionError)
  assert.equal(calls.length, 2, 'malformed sources, IDs, and selections are refused before storage')
})

test('folder preview selection is detached across waits and source changes fence late results', async () => {
  let resolvePreview!: (value: any) => void
  let entered!: () => void
  const held = new Promise<any>((resolve) => { resolvePreview = resolve })
  const started = new Promise<void>((resolve) => { entered = resolve })
  let lookedUp = 0
  const store = {
    async file(_owner: any, _id: string, selection: any) { assert.deepEqual(selection, { path: 'nested/note.txt' }); entered(); return held },
  }
  const host = hostFor(store, async () => ++lookedUp === 1 ? source : { ...source, cookieGeneration: 2 })
  const selection = { path: 'nested/note.txt' }
  const pending = assert.rejects(host.file(event, id, selection, expected), LocalConnectionError)
  await started
  selection.path = 'changed.txt'
  resolvePreview(preview)
  await pending
})

test('corrupt listing, wrong preview path, and absent native capability fail closed', async () => {
  await assert.rejects(hostFor({ async files() { return { ...listing, rootVersion: '/private/path' } } })
    .files(event, id, expected), LocalConnectionError)
  await assert.rejects(hostFor({ async file() { return { ...preview, path: 'other.txt' } } })
    .file(event, id, { path: 'nested/note.txt' }, expected), LocalConnectionError)
  await assert.rejects(hostFor({}).files(event, id, expected), LocalConnectionError)
})
