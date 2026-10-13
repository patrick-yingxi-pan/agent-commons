import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalConnectionError, openLocalConnectionStore } from './localConnectionStore.mjs'

const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
  decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
}
const owner = { namespace: 'tenant-a', userId: 'user-a' }
const foreign = { namespace: 'tenant-b', userId: 'user-b' }
const listing = { version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [{ path: 'note.txt', kind: 'file' }] }
const preview = { version: 1, path: 'note.txt', sizeBytes: 4, snapshot: { text: 'text' } }

async function withStore(options: any, run: (store: any, id: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'local-folder-browse-store-'))
  const profile = join(base, 'profile'), root = join(base, 'source')
  await mkdir(profile, { mode: 0o700 }); await mkdir(root)
  try {
    const store = await openLocalConnectionStore({ filePath: join(profile, 'connections.json'), storage,
      browseFiles: async () => listing, previewFile: async () => preview, ...options })
    const connection = await store.connect({ owner, path: root })
    await run(store, connection.id)
  } finally { await rm(base, { recursive: true, force: true }) }
}

test('folder browse and preview share owner-bound admission and detached parser results', async () => withStore({}, async (store, id) => {
  await assert.rejects(store.files(foreign, id), LocalConnectionError)
  await assert.rejects(store.file(foreign, id, { path: 'note.txt' }), LocalConnectionError)
  assert.deepEqual(await store.files(owner, id), listing)
  const result = await store.file(owner, id, { path: 'note.txt' })
  assert.deepEqual(result, preview)
  assert.notStrictEqual(result, preview)
  assert.notStrictEqual(result.snapshot, preview.snapshot)
}))

test('folder store refuses Git identifiers and absent browse capabilities', async () => {
  const base = await mkdtemp(join(tmpdir(), 'local-folder-browse-unavailable-'))
  const profile = join(base, 'profile'), root = join(base, 'source')
  await mkdir(profile, { mode: 0o700 }); await mkdir(root)
  try {
    const store = await openLocalConnectionStore({ filePath: join(profile, 'connections.json'), storage })
    const connection = await store.connect({ owner, path: root })
    await assert.rejects(store.files(owner, `GIT_${'A'.repeat(32)}`), LocalConnectionError)
    await assert.rejects(store.file(owner, connection.id, { path: 'note.txt' }), LocalConnectionError)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('selection is validated and frozen before read admission; disconnect and shutdown fence late results', async () => withStore({}, async (store, id) => {
  const malicious = Object.defineProperty({}, 'path', { enumerable: true, get() { throw new Error('getter') } })
  await assert.rejects(store.file(owner, id, malicious), LocalConnectionError)

  let entered!: () => void
  let finish!: (value: any) => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const held = new Promise<any>((resolve) => { finish = resolve })
  const pendingStorePromise = (async () => {
    const base = await mkdtemp(join(tmpdir(), 'local-folder-browse-fence-'))
    const profile = join(base, 'profile'), root = join(base, 'source')
    await mkdir(profile, { mode: 0o700 }); await mkdir(root)
    const fenced = await openLocalConnectionStore({ filePath: join(profile, 'connections.json'), storage,
      previewFile: async (_root: any, selection: any) => { assert.deepEqual(selection, { path: 'note.txt' }); entered(); return held } })
    const connection = await fenced.connect({ owner, path: root })
    return { fenced, id: connection.id, base }
  })()
  const { fenced, id: fencedId, base } = await pendingStorePromise
  try {
    const pending = assert.rejects(fenced.file(owner, fencedId, { path: 'note.txt' }), LocalConnectionError)
    await started
    await fenced.disconnect(owner, fencedId)
    finish(preview)
    await pending

  } finally { await rm(base, { recursive: true, force: true }) }
  let browseEntered!: () => void
  let finishBrowse!: (value: any) => void
  const browseStarted = new Promise<void>((resolve) => { browseEntered = resolve })
  const browseHeld = new Promise<any>((resolve) => { finishBrowse = resolve })
  await withStore({ browseFiles: async () => {
    browseEntered()
    return browseHeld
  } }, async (active, activeId) => {
    const pending = assert.rejects(active.files(owner, activeId), LocalConnectionError)
    await browseStarted
    active.shutdown()
    finishBrowse(listing)
    await pending
  })
}))
