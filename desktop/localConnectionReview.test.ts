import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  LOCAL_GIT_CONNECTION_FILE, LOCAL_CONNECTION_FILE, MAX_LOCAL_CAPTURES, LocalConnectionError, openLocalConnectionStore,
} from './localConnectionStore.mjs'

const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
  decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
}
const owner = { namespace: 'acme', userId: 'ada' }
const foreign = { namespace: 'acme', userId: 'bob' }

async function fixture(run: (values: any) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-git-review-store-'))
  try {
    const profile = join(directory, 'profile')
    const source = join(directory, 'repository')
    await mkdir(profile, { mode: 0o700 })
    await mkdir(source)
    const inspectRoot = async (path: string) => ({ path, identity: { dev: '1', ino: '2' } })
    const options = {
      filePath: join(profile, LOCAL_GIT_CONNECTION_FILE), storage, connectionKind: 'git', inspectRoot,
    }
    await run({ directory, profile, source, options })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>((done) => { resolve = done })
  return { promise, resolve }
}

test('review is explicit, Git-only, owner-bound, and unavailable without an injected reader', async () => fixture(async ({ source, options }) => {
  let calls = 0
  const expected = { comparison: 'raw', files: [{ path: 'note.txt' }] }
  const store = await openLocalConnectionStore({ ...options, review: async (root, { signal }) => {
    calls += 1
    assert.equal(root.path, source)
    assert.ok(signal instanceof AbortSignal)
    return expected
  } })
  const connection = await store.connect({ owner, path: source, remember: true })
  const savedGrant = await readFile(options.filePath)
  assert.equal(connection.id.startsWith('GIT_'), true)
  assert.deepEqual(await store.list(owner), [connection])
  assert.equal(calls, 0, 'connecting and listing never start content review')
  await assert.rejects(store.review(foreign, connection.id), LocalConnectionError)
  await assert.rejects(store.review(owner, 'LOCAL_00000000000000000000000000000000'), LocalConnectionError)
  assert.equal(calls, 0, 'invalid and foreign requests are refused before the reader')
  assert.strictEqual(await store.review(owner, connection.id), expected)
  assert.equal(calls, 1)
  assert.deepEqual(await readFile(options.filePath), savedGrant, 'transient review results do not alter encrypted connection storage')

  const unconfigured = await openLocalConnectionStore(options)
  const unconfiguredConnection = await unconfigured.connect({ owner, path: source })
  await assert.rejects(unconfigured.review(owner, unconfiguredConnection.id), LocalConnectionError)

  const folderStore = await openLocalConnectionStore({
    ...options, filePath: join(options.filePath, '..', LOCAL_CONNECTION_FILE), connectionKind: 'folder', review: async () => expected,
  })
  const folderConnection = await folderStore.connect({ owner, path: source })
  assert.equal(folderConnection.id.startsWith('LOCAL_'), true)
  await assert.rejects(folderStore.review(owner, folderConnection.id), LocalConnectionError)
  assert.equal(calls, 1, 'review cannot use the injected Git reader for folder grants')
}))

test('disconnect and shutdown abort transient reviews and fence late results', async () => fixture(async ({ source, options }) => {
  for (const fence of ['disconnect', 'shutdown']) {
    const entered = deferred()
    const finish = deferred()
    let signal: AbortSignal | undefined
    const store = await openLocalConnectionStore({ ...options, review: async (_root, context) => {
      signal = context.signal
      entered.resolve(undefined)
      return finish.promise
    } })
    const connection = await store.connect({ owner, path: source })
    const pending = store.review(owner, connection.id)
    const rejected = assert.rejects(pending, LocalConnectionError)
    await entered.promise
    if (fence === 'disconnect') await store.disconnect(owner, connection.id)
    else store.shutdown()
    assert.equal(signal?.aborted, true, fence + ' aborts active review work')
    finish.resolve({ sensitive: 'late result must not escape' })
    await rejected
    if (fence === 'disconnect') assert.deepEqual(await store.list(owner), [])
  }
}))

test('snapshots and reviews share capacity, and settled reviews release their slots', async () => fixture(async ({ source, options }) => {
  const active: Array<{ kind: string; resolve: (value: any) => void }> = []
  const reached = new Map<number, ReturnType<typeof deferred>>()
  const reader = (kind: string) => async () => {
    const result = deferred()
    active.push({ kind, resolve: result.resolve })
    reached.get(active.length)?.resolve(undefined)
    return result.promise
  }
  const store = await openLocalConnectionStore({ ...options, capture: reader('snapshot'), review: reader('review') })
  const connection = await store.connect({ owner, path: source })
  for (let count = 1; count <= MAX_LOCAL_CAPTURES; count += 1) reached.set(count, deferred())
  const pending = [store.snapshot(owner, connection.id)]
  await reached.get(1)!.promise
  for (let index = 1; index < MAX_LOCAL_CAPTURES; index += 1) pending.push(store.review(owner, connection.id))
  await reached.get(MAX_LOCAL_CAPTURES)!.promise
  assert.deepEqual(active.map(({ kind }) => kind), ['snapshot', 'review', 'review', 'review'])
  await assert.rejects(store.review(owner, connection.id), (error) =>
    error instanceof LocalConnectionError && error.code === 'busy')

  active.forEach((item, index) => item.resolve({ index }))
  assert.deepEqual(await Promise.all(pending), [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }])

  const retryReady = reached.get(MAX_LOCAL_CAPTURES + 1) ?? deferred()
  reached.set(MAX_LOCAL_CAPTURES + 1, retryReady)
  const retry = store.review(owner, connection.id)
  await retryReady.promise
  active[MAX_LOCAL_CAPTURES]!.resolve({ retried: true })
  assert.deepEqual(await retry, { retried: true })
}))
