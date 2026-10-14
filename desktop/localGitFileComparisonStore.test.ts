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
const idA = '4ca5af48-2a21-4c80-9bfe-f627ef872e23'
const idB = 'd33ecf7d-167c-460e-a9fc-59b0c9cedb4d'
const comparisonRequest = (operationId: string) => ({ scope: 'file-comparison', operationId, path: 'src/main.ts', comparison: 'staged' })
const untrackedRequest = (operationId: string) => ({ scope: 'untracked', operationId })
const ready = { version: 1, scope: 'file-comparison', path: 'src/main.ts', comparison: 'staged',
  head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, status: 'ready', change: 'modified',
  before: { kind: 'text', text: 'old', mode: '100644' }, after: { kind: 'text', text: 'new', mode: '100644' } }

async function fixture(run: (value: any) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-git-comparison-store-'))
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

test('file comparison store is explicit, owner-bound, Git-only and closed before reader access', async () => fixture(async ({ source, options }) => {
  const calls: unknown[][] = []
  const store = await openLocalConnectionStore({ ...options,
    fileComparison: async (root: any, selection: any, { signal }: any) => {
      calls.push([root.path, selection, signal])
      return ready
    },
  })
  const connection = await store.connect({ owner, path: source })
  assert.deepEqual(await store.fileComparison(owner, connection.id, comparisonRequest(idA)), ready)
  assert.deepEqual(calls.map(([path, selection]) => [path, selection]), [
    [source, { path: 'src/main.ts', comparison: 'staged' }],
  ])
  assert.ok(calls[0]?.[2] instanceof AbortSignal)
  await assert.rejects(store.fileComparison(foreign, connection.id, comparisonRequest(idB)), LocalConnectionError)
  await assert.rejects(store.fileComparison(owner, connection.id, { ...comparisonRequest(idB), extra: true }), LocalConnectionError)
  await assert.rejects(store.fileComparison(owner, connection.id, { ...comparisonRequest(idB), scope: 'untracked' }), LocalConnectionError)
  await assert.rejects(store.fileComparison(owner, connection.id, { ...comparisonRequest(idB), comparison: 'raw' }), LocalConnectionError)
  assert.equal(calls.length, 1, 'invalid and foreign requests never reach the reader')

  const unconfigured = await openLocalConnectionStore(options)
  const unavailable = await unconfigured.connect({ owner, path: source })
  await assert.rejects(unconfigured.fileComparison(owner, unavailable.id, comparisonRequest(idA)), LocalConnectionError)
  const folder = await openLocalConnectionStore({ ...options, connectionKind: 'folder', validateRoot: undefined,
    filePath: join(options.filePath, '..', 'local-connections.v1.json'),
    inspectRoot: async (path: string) => ({ path, identity: { dev: '1', ino: '2' } }),
    fileComparison: async () => ready })
  const folderConnection = await folder.connect({ owner, path: source })
  await assert.rejects(folder.fileComparison(owner, folderConnection.id, comparisonRequest(idA)), LocalConnectionError)
}))

test('comparison cancellation shares capture slots until the reader settles and cannot cross untracked scope', async () => fixture(async ({ source, options }) => {
  const held: Array<{ resolve(value: any): void; signal: AbortSignal; selection: any }> = []
  const reader = async (_root: any, selection: any, { signal }: any) => {
    const pending = deferred()
    held.push({ resolve: pending.resolve, signal, selection })
    return pending.promise
  }
  const store = await openLocalConnectionStore({ ...options, fileComparison: reader,
    browseUntracked: async (_root: any, { signal }: any) => {
      const pending = deferred()
      held.push({ resolve: pending.resolve, signal, selection: { scope: 'untracked' } })
      return pending.promise
    },
  })
  const connection = await store.connect({ owner, path: source })
  const comparison = store.fileComparison(owner, connection.id, comparisonRequest(idA))
  while (held.length < 1) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(held[0]?.selection, { path: 'src/main.ts', comparison: 'staged' })
  assert.equal(await store.cancelUntrackedRead(owner, connection.id, idA), false)
  assert.equal(await store.cancelFileComparison(foreign, connection.id, idA), false)
  assert.equal(await store.cancelFileComparison(owner, connection.id, idB), false)
  assert.equal(await store.cancelFileComparison(owner, connection.id, idA), true)
  assert.equal(held[0]?.signal.aborted, true)

  const sameIdUntracked = store.untrackedFiles(owner, connection.id, untrackedRequest(idA))
  while (held.length < 2) await new Promise(resolve => setImmediate(resolve))
  assert.equal(await store.cancelFileComparison(owner, connection.id, idA), true,
    'the same UUID still addresses the comparison operation only')
  assert.equal(held[1]?.signal.aborted, false, 'comparison cancellation leaves untracked work active')
  assert.equal(await store.cancelUntrackedRead(owner, connection.id, idA), true)
  held[0]?.resolve(ready)
  held[1]?.resolve({ version: 1, files: [], excludedCount: 0 })
  await assert.rejects(comparison, LocalConnectionError)
  await assert.rejects(sameIdUntracked, LocalConnectionError)
  assert.equal(await store.cancelFileComparison(owner, connection.id, idA), false)
}))

test('cancelled comparison keeps its shared read slot occupied until physical reader settlement', async () => fixture(async ({ source, options }) => {
  const pending: Array<{ resolve(value: any): void; signal: AbortSignal }> = []
  const reader = async (_root: any, _selection: any, { signal }: any) => {
    const held = deferred()
    pending.push({ resolve: held.resolve, signal })
    return held.promise
  }
  const store = await openLocalConnectionStore({ ...options, fileComparison: reader })
  const connection = await store.connect({ owner, path: source })
  const comparisons: Promise<any>[] = []
  const admissionErrors: unknown[] = []
  for (let index = 0; index < MAX_LOCAL_CAPTURES; index++) {
    comparisons.push(store.fileComparison(owner, connection.id, comparisonRequest(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`))
      .catch(error => { admissionErrors.push(error); throw error }))
  }
  for (let spin = 0; spin < 100 && pending.length + admissionErrors.length < MAX_LOCAL_CAPTURES; spin++) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.deepEqual(admissionErrors, [], 'every comparison occupies a slot before cancellation')
  assert.equal(pending.length, MAX_LOCAL_CAPTURES, 'all shared slots are held by physical reads')
  assert.equal(await store.cancelFileComparison(owner, connection.id, '00000000-0000-4000-8000-000000000001'), true)
  const overflowId = '00000000-0000-4000-8000-999999999999'
  await assert.rejects(store.fileComparison(owner, connection.id, comparisonRequest(overflowId)),
    (error: any) => error instanceof LocalConnectionError && error.code === 'busy')
  assert.equal(pending[0]?.signal.aborted, true)
  pending[0]?.resolve(ready)
  await assert.rejects(comparisons[0], LocalConnectionError)
  for (const held of pending.slice(1)) held.resolve(ready)
  for (const result of comparisons.slice(1)) assert.deepEqual(await result, ready)
}))

test('disconnect and shutdown abort pending comparison reads and fence late results', async () => fixture(async ({ source, options }) => {
  const holds: Array<{ resolve(value: any): void; signal: AbortSignal }> = []
  const compare = async (_root: any, _selection: any, { signal }: any) => {
    const held = deferred()
    holds.push({ resolve: held.resolve, signal })
    return held.promise
  }
  const store = await openLocalConnectionStore({ ...options, fileComparison: compare })
  const connection = await store.connect({ owner, path: source })
  const disconnected = assert.rejects(store.fileComparison(owner, connection.id, comparisonRequest(idA)), LocalConnectionError)
  while (holds.length < 1) await new Promise(resolve => setImmediate(resolve))
  await store.disconnect(owner, connection.id)
  assert.equal(holds[0]?.signal.aborted, true)
  holds[0]?.resolve(ready)
  await disconnected

  const shutdownStore = await openLocalConnectionStore({ ...options, fileComparison: compare,
    filePath: join(options.filePath, '..', 'shutdown-git-connections.v1.json') })
  const second = await shutdownStore.connect({ owner, path: source })
  const shutDown = assert.rejects(shutdownStore.fileComparison(owner, second.id, comparisonRequest(idB)), LocalConnectionError)
  while (holds.length < 2) await new Promise(resolve => setImmediate(resolve))
  shutdownStore.shutdown()
  assert.equal(holds[1]?.signal.aborted, true)
  holds[1]?.resolve(ready)
  await shutDown
}))
