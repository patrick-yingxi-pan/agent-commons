import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/identity.ts'
import type { LocalFolderConnection, NativeLocalFolderBridge } from '../../contract/localFolderCapture.ts'
import type { LocalFolderFilePreview } from '../../contract/localFolderBrowse.mjs'
import { refreshAccount, accountGeneration } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { AccountSwitchedError } from './client.ts'
import { keys } from './keys.ts'
import {
  captureLocalFolder,
  captureLocalFolderSource,
  connectLocalFolder,
  disconnectLocalFolder,
  localFolderTreeAvailable,
  localFoldersAvailable,
  readLocalFolders,
  readLocalFolderFile,
  readLocalFolderFiles,
} from './localFolders.ts'

const ada: Identity = { user: { id: 'ada', name: 'Ada' }, tenant: { id: 'tenant-a', name: 'A', kind: 'org' }, role: 'member', local: false, via: 'session' }
const grace: Identity = { ...ada, user: { id: 'grace', name: 'Grace' }, tenant: { id: 'tenant-b', name: 'B', kind: 'org' } }
const id = `LOCAL_${'A'.repeat(32)}` as LocalFolderConnection['id']
const row: LocalFolderConnection = { id, name: 'Research', remembered: false }
const file = { name: 'notes.txt', sizeBytes: 3, snapshot: { text: 'abc' } }
const snapshotId = '00000000-0000-4000-8000-000000000001'

function select(identity: Identity) {
  refreshAccount({ userId: identity.user.id, tenantId: identity.tenant.id })
  resetAll()
  setData(keys.me, identity)
}

function cleanup() {
  resetAll()
  refreshAccount(null)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function scopeFor(port: NativeLocalFolderBridge) {
  return { agentCommonsDesktop: { context: { localFolders: port } } }
}

function bridge(overrides: Partial<NativeLocalFolderBridge> = {}, calls: unknown[][] = []): NativeLocalFolderBridge {
  return {
    async list(source) { calls.push(['list', source]); return [row] },
    async connect(input, source) { calls.push(['connect', input, source]); return { status: 'connected', connection: { ...row, remembered: input.remember } } },
    async snapshot(connectionId, source) { calls.push(['snapshot', connectionId, source]); return { name: '/private/native/path', files: [file] } },
    async snapshotTree(connectionId, source) { calls.push(['snapshotTree', connectionId, source]); return { name: 'Research', files: [{ ...file, name: 'src/notes.txt' }] } },
    async files(connectionId, source) { calls.push(['files', connectionId, source]); return { version: 1, visited: 2, hiddenCount: 0, directoryCount: 1, files: [{ path: 'notes.txt', kind: 'file' }] } },
    async file(connectionId, selection, source) { calls.push(['file', connectionId, selection, source]); return { version: 1, path: selection.path, sizeBytes: 0, snapshot: { text: '' } } },
    async disconnect(connectionId, source) { calls.push(['disconnect', connectionId, source]) },
    ...overrides,
  }
}

test('local folder source is frozen from the exact cached /me and active account generation', () => {
  try {
    select(ada)
    const generation = accountGeneration()
    const captured = captureLocalFolderSource()
    assert.deepEqual(captured.source, { userId: 'ada', namespace: 'tenant-a' })
    assert.equal(captured.sourceUserId, 'ada')
    captured.assertCurrent()

    refreshAccount({ userId: 'grace', tenantId: 'tenant-b' })
    setData(keys.me, grace)
    assert.throws(captured.assertCurrent, AccountSwitchedError)
    assert.equal(accountGeneration(), generation + 1)

    refreshAccount({ userId: 'ada', tenantId: 'tenant-a' })
    setData(keys.me, ada)
    const cachedIdentity = captureLocalFolderSource()
    setData(keys.me, grace)
    assert.throws(cachedIdentity.assertCurrent, AccountSwitchedError, 'a changed /me cache is fenced even without another generation bump')
  } finally { cleanup() }
})

test('native metadata list/connect/disconnect use only the frozen source; snapshot is capture-only and path-free', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const scope = scopeFor(bridge({}, calls))
    assert.equal(localFoldersAvailable(scope), true)
    assert.deepEqual(await readLocalFolders(scope), [row])
    assert.deepEqual(await connectLocalFolder(false, scope), row, 'unchecked Remember is sent as false')
    await disconnectLocalFolder(id, scope)
    assert.deepEqual(calls, [
      ['list', { userId: 'ada', namespace: 'tenant-a' }],
      ['connect', { remember: false }, { userId: 'ada', namespace: 'tenant-a' }],
      ['disconnect', id, { userId: 'ada', namespace: 'tenant-a' }],
    ], 'metadata operations do not invoke the native snapshot capability')

    const captured = await captureLocalFolder(id, snapshotId, scope)
    assert.equal(calls[3]?.[0], 'snapshot', 'only explicit capture invokes snapshot')
    assert.deepEqual(calls[3], ['snapshot', id, { userId: 'ada', namespace: 'tenant-a' }])
    assert.equal(captured.snapshotId, snapshotId)
    assert.equal(captured.connectionId, id)
    assert.deepEqual(captured.files, [file])
    assert.equal(JSON.stringify(captured).includes('/private/native/path'), false, 'native folder paths never enter the portable capture')
    assert.deepEqual(Object.keys(captured).sort(), ['capturedAt', 'connectionId', 'files', 'snapshotId', 'version'])
  } finally { cleanup() }
})

test('web without a native bridge fails closed, and malformed native metadata or captures are refused', async () => {
  try {
    select(ada)
    const absent = {}
    assert.equal(localFoldersAvailable(absent), false)
    assert.equal(localFolderTreeAvailable(absent), false)
    await assert.rejects(readLocalFolders(absent), /desktop app/)
    await assert.rejects(connectLocalFolder(false, absent), /desktop app/)
    await assert.rejects(disconnectLocalFolder(id, absent), /desktop app/)
    await assert.rejects(captureLocalFolder(id, snapshotId, absent), /desktop app/)

    const extraPath = scopeFor(bridge({ list: async () => [{ ...row, path: '/private/folder' } as never] }))
    await assert.rejects(readLocalFolders(extraPath), /invalid connection list/)
    const invalidName = scopeFor(bridge({ list: async () => [{ ...row, name: '../private' }] }))
    await assert.rejects(readLocalFolders(invalidName), /invalid connection list/)
    const duplicate = scopeFor(bridge({ list: async () => [row, { ...row }] }))
    await assert.rejects(readLocalFolders(duplicate), /invalid connection list/)
    const inconsistentAck = scopeFor(bridge({ connect: async () => ({ status: 'connected', connection: { ...row, remembered: true } }) }))
    await assert.rejects(connectLocalFolder(false, inconsistentAck), /Could not confirm/)
    const pathInFiles = scopeFor(bridge({ snapshot: async () => ({ name: 'Research', files: [{ ...file, name: '../notes.txt' }] }) }))
    await assert.rejects(captureLocalFolder(id, snapshotId, pathInFiles), /complete supported snapshot/)
  } finally { cleanup() }
})

test('recursive capture is explicit, validates root-relative files, and refuses to fall back to flat capture', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const scope = scopeFor(bridge({}, calls))
    assert.equal(localFolderTreeAvailable(scope), true)
    const capture = await captureLocalFolder(id, snapshotId, scope, 'recursive')
    assert.deepEqual(capture, {
      version: 2, scope: 'recursive', snapshotId, capturedAt: capture.capturedAt,
      connectionId: id, files: [{ ...file, name: 'src/notes.txt' }],
    })
    assert.deepEqual(calls.map(call => call[0]), ['snapshotTree'])

    const flatOnly = scopeFor(bridge({ snapshotTree: undefined }, calls))
    assert.equal(localFolderTreeAvailable(flatOnly), false)
    await assert.rejects(captureLocalFolder(id, snapshotId, flatOnly, 'recursive'), /Recursive folder refresh is unavailable/)
    assert.deepEqual(calls.map(call => call[0]), ['snapshotTree'], 'unsupported recursive scope never invokes flat snapshot')
    await assert.rejects(captureLocalFolder(id, snapshotId, scope, 'unexpected' as never), /capture scope is unavailable/)
    assert.deepEqual(calls.map(call => call[0]), ['snapshotTree'], 'an invalid runtime scope is not normalized to flat')

    const malformedTree = scopeFor(bridge({ snapshotTree: async () => ({ name: 'Research', files: [{ ...file, name: '../escape.txt' }] }) }))
    await assert.rejects(captureLocalFolder(id, snapshotId, malformedTree, 'recursive'), /complete supported snapshot/)
  } finally { cleanup() }
})

test('local file browsing is a separate explicit bounded listing and exact preview capability', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const scope = scopeFor(bridge({}, calls))
    assert.deepEqual(await readLocalFolderFiles(id, scope), {
      version: 1, visited: 2, hiddenCount: 0, directoryCount: 1, files: [{ path: 'notes.txt', kind: 'file' }],
    })
    assert.deepEqual(calls, [['files', id, { userId: 'ada', namespace: 'tenant-a' }]], 'listing never reads file content or captures a snapshot')
    assert.deepEqual(await readLocalFolderFile(id, 'notes.txt', scope), { version: 1, path: 'notes.txt', sizeBytes: 0, snapshot: { text: '' } })
    assert.deepEqual(calls[1], ['file', id, { path: 'notes.txt' }, { userId: 'ada', namespace: 'tenant-a' }])
    await assert.rejects(readLocalFolderFile(id, '../outside.txt', scope), /valid folder path/)
    assert.equal(calls.length, 2, 'an invalid path never reaches the native bridge')
  } finally { cleanup() }
})

test('folder browse fails closed when optional native file methods are absent or return malformed data', async () => {
  try {
    select(ada)
    const noBrowser = scopeFor(bridge({ files: undefined, file: undefined }))
    await assert.rejects(readLocalFolderFiles(id, noBrowser), /Path browsing is unavailable/)
    await assert.rejects(readLocalFolderFile(id, 'notes.txt', noBrowser), /File preview is unavailable/)
    const badListing = scopeFor(bridge({ files: async () => ({ version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [] }) }))
    await assert.rejects(readLocalFolderFiles(id, badListing), /invalid folder path listing/)
    const mismatchedPreview = scopeFor(bridge({ file: async () => ({ version: 1, path: 'other.txt', sizeBytes: 0, snapshot: { text: '' } }) }))
    await assert.rejects(readLocalFolderFile(id, 'notes.txt', mismatchedPreview), /invalid folder file preview/)
  } finally { cleanup() }
})

test('folder document reads return detached containers for renderer extraction and fence identity changes', async () => {
  try {
    for (const format of ['pdf', 'docx', 'xlsx', 'pptx'] as const) {
      select(ada)
      const path = `reports/data.${format}`
      const bytes = new Uint8Array([1, 2, 3])
      const preview: LocalFolderFilePreview = { version: 1, path, sizeBytes: 3, snapshot: { document: { format, bytes } } }
      const scope = scopeFor(bridge({ file: async () => preview }))
      const result = await readLocalFolderFile(id, path, scope)
      assert.ok('document' in result.snapshot)
      assert.deepEqual(result.snapshot.document.bytes, bytes)
      bytes[0] = 9
      assert.equal(result.snapshot.document.bytes[0], 1, 'native output cannot mutate the accepted renderer input')
      const pending = deferred<LocalFolderFilePreview>()
      const reading = readLocalFolderFile(id, path, scopeFor(bridge({ file: () => pending.promise })))
      select(grace)
      pending.resolve(preview)
      await assert.rejects(reading, AccountSwitchedError)
    }
  } finally { cleanup() }
})

test('late native list, connect, disconnect, and capture results are fenced after account change', async () => {
  try {
    select(ada)
    const listPending = deferred<LocalFolderConnection[]>()
    const connectPending = deferred<{ status: 'connected'; connection: LocalFolderConnection }>()
    const disconnectPending = deferred<void>()
    const capturePending = deferred<{ name: string; files: Array<typeof file> }>()
    const browseListingPending = deferred<{ version: 1; visited: number; hiddenCount: number; directoryCount: number; files: Array<{ path: string; kind: 'file' | 'unsupported' }> }>()
    const browsePreviewPending = deferred<{ version: 1; path: string; sizeBytes: number; snapshot: { text: string } | { omitted: 'too-large' | 'unsupported' | 'unreadable' } }>()
    let listMode = false
    let connectMode = false
    let disconnectMode = false
    let captureMode = false
    let browseListingMode = false
    let browsePreviewMode = false
    const port = bridge({
      list: () => listMode ? listPending.promise : Promise.resolve([row]),
      connect: () => connectMode ? connectPending.promise : Promise.resolve({ status: 'connected', connection: row }),
      disconnect: () => disconnectMode ? disconnectPending.promise : Promise.resolve(),
      snapshot: () => captureMode ? capturePending.promise : Promise.resolve({ name: 'Research', files: [file] }),
      files: () => browseListingMode ? browseListingPending.promise : Promise.resolve({ version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [{ path: 'notes.txt', kind: 'file' as const }] }),
      file: (_connection, selection) => browsePreviewMode ? browsePreviewPending.promise : Promise.resolve({ version: 1, path: selection.path, sizeBytes: 0, snapshot: { text: '' } }),
    })
    const scope = scopeFor(port)
    const losesIdentity = () => { refreshAccount({ userId: 'grace', tenantId: 'tenant-b' }); setData(keys.me, grace) }

    listMode = true
    const read = readLocalFolders(scope)
    losesIdentity()
    listPending.resolve([row])
    await assert.rejects(read, AccountSwitchedError)

    select(ada)
    connectMode = true
    const connect = connectLocalFolder(false, scope)
    losesIdentity()
    connectPending.resolve({ status: 'connected', connection: row })
    await assert.rejects(connect, AccountSwitchedError)

    select(ada)
    disconnectMode = true
    const disconnect = disconnectLocalFolder(id, scope)
    losesIdentity()
    disconnectPending.resolve()
    await assert.rejects(disconnect, AccountSwitchedError)

    select(ada)
    captureMode = true
    const capture = captureLocalFolder(id, snapshotId, scope)
    losesIdentity()
    capturePending.resolve({ name: 'Research', files: [file] })
    await assert.rejects(capture, AccountSwitchedError)

    select(ada)
    browseListingMode = true
    const browseListing = readLocalFolderFiles(id, scope)
    losesIdentity()
    browseListingPending.resolve({ version: 1, visited: 1, hiddenCount: 0, directoryCount: 0, files: [{ path: 'notes.txt', kind: 'file' }] })
    await assert.rejects(browseListing, AccountSwitchedError)

    select(ada)
    browseListingMode = false
    await readLocalFolderFiles(id, scope)
    browsePreviewMode = true
    const browsePreview = readLocalFolderFile(id, 'notes.txt', scope)
    losesIdentity()
    browsePreviewPending.resolve({ version: 1, path: 'notes.txt', sizeBytes: 0, snapshot: { text: '' } })
    await assert.rejects(browsePreview, AccountSwitchedError)
  } finally { cleanup() }
})
