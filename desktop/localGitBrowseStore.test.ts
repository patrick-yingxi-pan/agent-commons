import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LOCAL_GIT_CONNECTION_FILE, LocalConnectionError, MAX_LOCAL_CAPTURES, openLocalConnectionStore } from './localConnectionStore.mjs'

const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
  decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
}
const owner = { namespace: 'acme', userId: 'ada' }
const foreign = { namespace: 'acme', userId: 'bob' }
const listing = { version: 1, files: [{ path: 'src/main.ts', kind: 'file' }], excludedCount: 0 }
const preview = { version: 1, path: 'src/main.ts', sizeBytes: 4, snapshot: { text: 'test' } }

async function fixture(run: (value: any) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-git-browse-store-'))
  try {
    const profile = join(directory, 'profile')
    const source = join(directory, 'repository')
    await mkdir(profile, { mode: 0o700 })
    await mkdir(source)
    const options = {
      filePath: join(profile, LOCAL_GIT_CONNECTION_FILE), storage, connectionKind: 'git',
      validateRoot: (value: any) => !!value?.repository && typeof value.path === 'string',
      inspectRoot: async (path: string) => ({ path, identity: { dev: '1', ino: '2' }, repository: {} }),
    }
    await run({ source, options })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>((done) => { resolve = done })
  return { promise, resolve }
}

test('Git file browse and preview are explicit, owner-bound, Git-only, and reader-capability gated', async () => fixture(async ({ source, options }) => {
  let lists = 0
  let reads = 0
  const store = await openLocalConnectionStore({ ...options,
    browse: async (root: any, { signal }: any) => { lists++; assert.equal(root.path, source); assert.ok(signal instanceof AbortSignal); return listing },
    preview: async (root: any, { signal, selection }: any) => { reads++; assert.equal(root.path, source); assert.ok(signal instanceof AbortSignal); return { ...preview, path: selection.path } },
  })
  const connection = await store.connect({ owner, path: source })
  assert.deepEqual(await store.files(owner, connection.id), listing)
  assert.deepEqual(await store.file(owner, connection.id, { path: 'src/main.ts' }), preview)
  assert.equal(lists, 1)
  assert.equal(reads, 1)
  await assert.rejects(store.files(foreign, connection.id), LocalConnectionError)
  await assert.rejects(store.file(foreign, connection.id, { path: 'src/main.ts' }), LocalConnectionError)
  await assert.rejects(store.file(owner, connection.id, { path: '../private' }), LocalConnectionError)
  assert.equal(lists, 1)
  assert.equal(reads, 1)

  const unconfigured = await openLocalConnectionStore(options)
  const unavailable = await unconfigured.connect({ owner, path: source })
  await assert.rejects(unconfigured.files(owner, unavailable.id), LocalConnectionError)
  await assert.rejects(unconfigured.file(owner, unavailable.id, { path: 'src/main.ts' }), LocalConnectionError)

  const folder = await openLocalConnectionStore({ ...options, connectionKind: 'folder', validateRoot: undefined,
    filePath: join(options.filePath, '..', 'local-connections.v1.json'),
    inspectRoot: async (path: string) => ({ path, identity: { dev: '1', ino: '2' } }),
    browse: async () => listing, preview: async () => preview })
  const folderConnection = await folder.connect({ owner, path: source })
  await assert.rejects(folder.files(owner, folderConnection.id), LocalConnectionError)
  await assert.rejects(folder.file(owner, folderConnection.id, { path: 'src/main.ts' }), LocalConnectionError)
}))

test('file selection is detached before admission; browse and preview share slots and disconnect/shutdown fences', async () => fixture(async ({ source, options }) => {
  const entered = new Map<number, ReturnType<typeof deferred>>()
  const holds: Array<{ resolve: (value: any) => void; signal?: AbortSignal }> = []
  const reader = async (_root: any, context: any) => {
    const held = deferred()
    holds.push({ resolve: held.resolve, signal: context.signal })
    entered.get(holds.length)?.resolve(undefined)
    return held.promise
  }
  const store = await openLocalConnectionStore({ ...options, browse: reader, preview: async (_root: any, context: any) => {
    assert.deepEqual(context.selection, { path: 'src/main.ts' })
    return reader(_root, context)
  } })
  const connection = await store.connect({ owner, path: source })
  for (let count = 1; count <= MAX_LOCAL_CAPTURES; count += 1) entered.set(count, deferred())
  const selected = { path: 'src/main.ts' }
  const pending = [store.file(owner, connection.id, selected)]
  selected.path = '../changed-after-call'
  await entered.get(1)!.promise
  for (let index = 1; index < MAX_LOCAL_CAPTURES; index += 1) pending.push(store.files(owner, connection.id))
  await entered.get(MAX_LOCAL_CAPTURES)!.promise
  await assert.rejects(store.file(owner, connection.id, { path: 'src/main.ts' }), (error) =>
    error instanceof LocalConnectionError && error.code === 'busy')
  await store.disconnect(owner, connection.id)
  assert.ok(holds.every((held) => held.signal?.aborted), 'disconnect aborts every active browse/preview read')
  holds.forEach(({ resolve }, index) => resolve(index === 0 ? preview : listing))
  for (const result of pending) await assert.rejects(result, LocalConnectionError)

  const shutdownStore = await openLocalConnectionStore({ ...options, browse: reader, preview: reader })
  const second = await shutdownStore.connect({ owner, path: source })
  const nextEntered = deferred()
  entered.set(holds.length + 1, nextEntered)
  const late = assert.rejects(shutdownStore.files(owner, second.id), LocalConnectionError)
  await nextEntered.promise
  shutdownStore.shutdown()
  assert.equal(holds.at(-1)?.signal?.aborted, true)
  holds.at(-1)?.resolve(listing)
  await late
}))

test('untracked reads use closed scope requests, share read capacity, and cancellation targets one operation', async () => fixture(async ({ source, options }) => {
  const held: Array<{ resolve(value: any): void; signal: AbortSignal }> = []
  const reader = async (_root: any, context: any) => {
    const pending = deferred()
    held.push({ resolve: pending.resolve, signal: context.signal })
    return pending.promise
  }
  const store = await openLocalConnectionStore({ ...options, browse: reader, browseUntracked: reader, previewUntracked: reader })
  const connection = await store.connect({ owner, path: source })
  const opA = '4ca5af48-2a21-4c80-9bfe-f627ef872e23'
  const opB = 'd33ecf7d-167c-460e-a9fc-59b0c9cedb4d'
  const a = store.untrackedFiles(owner, connection.id, { scope: 'untracked', operationId: opA })
  const b = store.untrackedFile(owner, connection.id, { scope: 'untracked', path: 'draft.md', operationId: opB })
  const c = store.files(owner, connection.id)
  const d = store.files(owner, connection.id)
  while (held.length < MAX_LOCAL_CAPTURES) await new Promise(resolve => setImmediate(resolve))
  assert.equal(await store.cancelUntrackedRead(foreign, connection.id, opA), false)
  assert.equal(await store.cancelUntrackedRead(owner, connection.id, opB), true)
  assert.equal(held[0].signal.aborted, false)
  assert.equal(held[1].signal.aborted, true)
  await assert.rejects(store.untrackedFiles(owner, connection.id, { scope: 'tracked', operationId: 'b613715a-e469-4efb-9b4b-d5406286f8c5' }), LocalConnectionError)
  const busy = store.files(owner, connection.id)
  await assert.rejects(busy, (error: any) => error instanceof LocalConnectionError && error.code === 'busy')
  held[1].resolve({ version: 1, path: 'draft.md', sizeBytes: 0, snapshot: { text: '' } })
  await assert.rejects(b, LocalConnectionError)
  held[0].resolve({ version: 1, files: [], excludedCount: 0 })
  assert.equal((await a).scope, 'untracked')
  held[2].resolve({ version: 1, files: [], excludedCount: 0 })
  held[3].resolve({ version: 1, files: [], excludedCount: 0 })
  await Promise.all([c, d])
  assert.equal(await store.cancelUntrackedRead(owner, connection.id, opA), false)
}))

test('untracked cancellation also fences an operation queued behind connection persistence', async () => fixture(async ({ source, options }) => {
  const held = deferred<void>()
  let holdWrites = false
  let readerCalls = 0
  const gatedStorage = { ...storage, async encryptString(value: string) {
    if (holdWrites) await held.promise
    return Buffer.from([...value].reverse().join(''))
  } }
  const store = await openLocalConnectionStore({ ...options, storage: gatedStorage,
    browseUntracked: async () => { readerCalls++; return { version: 1, files: [], excludedCount: 0 } } })
  const connection = await store.connect({ owner, path: source, remember: true })
  holdWrites = true
  const connecting = store.connect({ owner, path: `${source}/another`, remember: true })
  const operationId = 'c24a0060-b05e-4b8b-8a8d-37b927606a5c'
  const read = store.untrackedFiles(owner, connection.id, { scope: 'untracked', operationId })
  assert.equal(await store.cancelUntrackedRead(owner, connection.id, operationId), true)
  held.resolve()
  await connecting
  await assert.rejects(read, LocalConnectionError)
  assert.equal(readerCalls, 0, 'a cancelled queued operation never dispatches a source reader')
}))
