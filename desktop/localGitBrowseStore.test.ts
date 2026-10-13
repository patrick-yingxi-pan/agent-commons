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
