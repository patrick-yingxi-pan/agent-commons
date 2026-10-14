import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/identity.ts'
import type { LocalGitConnection, NativeLocalGitBridge } from '../../contract/localGitCapture.ts'
import type { LocalGitReview } from '../../contract/localGitReview.mjs'
import type { LocalGitFileListing, LocalGitFilePreview } from '../../contract/localGitBrowse.mjs'
import { refreshAccount, accountGeneration } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { AccountSwitchedError } from './client.ts'
import { keys } from './keys.ts'
import { localGitAvailable } from './localGitCapability.ts'
import { captureLocalGit, captureLocalGitSource, connectLocalGit, disconnectLocalGit, readLocalGitChanges, readLocalGitConnections, readLocalGitFile, readLocalGitFiles } from './localGit.ts'

const ada: Identity = { user: { id: 'ada', name: 'Ada' }, tenant: { id: 'tenant-a', name: 'A', kind: 'org' }, role: 'member', local: false, via: 'session' }
const grace: Identity = { ...ada, user: { id: 'grace', name: 'Grace' }, tenant: { id: 'tenant-b', name: 'B', kind: 'org' } }
const id = `GIT_${'A'.repeat(32)}` as LocalGitConnection['id']
const row: LocalGitConnection = { id, name: 'Commons', remembered: false }
const file = { path: 'src/nested/notes.md', sizeBytes: 3, snapshot: { text: 'abc' } }
const snapshotId = '00000000-0000-4000-8000-000000000001'
const review: LocalGitReview = {
  version: 1,
  comparison: 'raw',
  head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
  excludedCount: 0,
  unchangedCount: 0,
  files: [{
    path: 'src/nested/notes.md', staged: 'modified', unstaged: 'modified',
    head: { kind: 'text', text: 'before', mode: '100644' },
    index: { kind: 'text', text: 'staged', mode: '100644' },
    working: { kind: 'text', text: 'working', mode: '100644' },
  }],
}

function select(identity: Identity) {
  refreshAccount({ userId: identity.user.id, tenantId: identity.tenant.id })
  resetAll()
  setData(keys.me, identity)
}
function cleanup() { resetAll(); refreshAccount(null) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function scopeFor(port: NativeLocalGitBridge) { return { agentCommonsDesktop: { context: { localGit: port } } } }
function bridge(overrides: Partial<NativeLocalGitBridge> = {}, calls: unknown[][] = []): NativeLocalGitBridge {
  return {
    async list(source) { calls.push(['list', source]); return [row] },
    async connect(input, source) { calls.push(['connect', input, source]); return { status: 'connected', connection: { ...row, remembered: input.remember } } },
    async snapshot(connectionId, source) { calls.push(['snapshot', connectionId, source]); return { name: 'Commons', files: [file] } },
    async review(connectionId, source) { calls.push(['review', connectionId, source]); return structuredClone(review) },
    async files(connectionId, source) { calls.push(['files', connectionId, source]); return { version: 1, files: [{ path: 'README.md', kind: 'file' }], excludedCount: 2 } },
    async file(connectionId, selection, source) { calls.push(['file', connectionId, selection, source]); return { version: 1, path: selection.path, sizeBytes: 3, snapshot: { text: 'abc' } } },
    async disconnect(connectionId, source) { calls.push(['disconnect', connectionId, source]) },
    ...overrides,
  }
}

test('native Git metadata is path-free; explicit capture preserves relative nested paths and has no source path', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const scope = scopeFor(bridge({}, calls))
    assert.equal(localGitAvailable(scope), true)
    assert.deepEqual(await readLocalGitConnections(scope), [row])
    assert.deepEqual(await connectLocalGit(false, scope), row)
    await disconnectLocalGit(id, scope)
    assert.deepEqual(calls, [
      ['list', { userId: 'ada', namespace: 'tenant-a' }],
      ['connect', { remember: false }, { userId: 'ada', namespace: 'tenant-a' }],
      ['disconnect', id, { userId: 'ada', namespace: 'tenant-a' }],
    ], 'connection management never snapshots repository content')
    const captured = await captureLocalGit(id, snapshotId, scope)
    assert.equal(calls[3]?.[0], 'snapshot', 'only explicit capture reads tracked files')
    assert.deepEqual(captured.files, [file])
    assert.deepEqual(Object.keys(captured).sort(), ['capturedAt', 'connectionId', 'files', 'snapshotId', 'version'])
    assert.equal(JSON.stringify(captured).includes('/private'), false)
  } finally { cleanup() }
})

test('native Git bridge fails closed on malformed metadata and unsupported capture shapes', async () => {
  try {
    select(ada)
    assert.equal(localGitAvailable({}), false)
    await assert.rejects(readLocalGitConnections({}), /desktop app/)
    const hiddenPath = scopeFor(bridge({ list: async () => [{ ...row, path: '/private/repo' } as never] }))
    await assert.rejects(readLocalGitConnections(hiddenPath), /invalid repository connection list/)
    const malformedPath = scopeFor(bridge({ snapshot: async () => ({ name: 'Commons', files: [{ ...file, path: '../secret.md' }] }) }))
    await assert.rejects(captureLocalGit(id, snapshotId, malformedPath), /complete supported snapshot/)
    const nativePath = scopeFor(bridge({ snapshot: async () => ({ name: '/private/repo', files: [file] }) }))
    await assert.rejects(captureLocalGit(id, snapshotId, nativePath), /invalid display name/)
    const inconsistentRemember = scopeFor(bridge({ connect: async () => ({ status: 'connected', connection: { ...row, remembered: true } }) }))
    await assert.rejects(connectLocalGit(false, inconsistentRemember), /Could not confirm/)
  } finally { cleanup() }
})

test('native Git operation results are fenced when account identity changes', async () => {
  try {
    select(ada)
    const startGeneration = accountGeneration()
    const source = captureLocalGitSource()
    assert.deepEqual(source.source, { userId: 'ada', namespace: 'tenant-a' })
    const switchAccount = () => { refreshAccount({ userId: 'grace', tenantId: 'tenant-b' }); setData(keys.me, grace) }

    const pendingList = deferred<LocalGitConnection[]>()
    let scope = scopeFor(bridge({ list: () => pendingList.promise }))
    const list = readLocalGitConnections(scope)
    switchAccount()
    pendingList.resolve([row])
    await assert.rejects(list, AccountSwitchedError)

    select(ada)
    const pendingConnect = deferred<{ status: 'connected'; connection: LocalGitConnection }>()
    scope = scopeFor(bridge({ connect: () => pendingConnect.promise }))
    const connect = connectLocalGit(false, scope)
    switchAccount()
    pendingConnect.resolve({ status: 'connected', connection: row })
    await assert.rejects(connect, AccountSwitchedError)

    select(ada)
    const pendingDisconnect = deferred<void>()
    scope = scopeFor(bridge({ disconnect: () => pendingDisconnect.promise }))
    const disconnect = disconnectLocalGit(id, scope)
    switchAccount()
    pendingDisconnect.resolve(undefined)
    await assert.rejects(disconnect, AccountSwitchedError)

    select(ada)
    const pendingCapture = deferred<{ name: string; files: typeof file[] }>()
    scope = scopeFor(bridge({ snapshot: () => pendingCapture.promise }))
    const capture = captureLocalGit(id, snapshotId, scope)
    switchAccount()
    pendingCapture.resolve({ name: 'Commons', files: [file] })
    await assert.rejects(capture, AccountSwitchedError)
    assert.throws(source.assertCurrent, AccountSwitchedError)
    assert.equal(accountGeneration(), startGeneration + 7)
    assert.equal(peek<Identity>(keys.me)?.user.id, 'grace')
  } finally { cleanup() }
})

test('local Git review is explicit, account-scoped, validated and detached from native output', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const nativeReview = structuredClone(review)
    const scope = scopeFor(bridge({ review: async (connectionId, source) => {
      calls.push(['review', connectionId, source])
      return nativeReview
    } }, calls))
    const result = await readLocalGitChanges(id, scope)
    assert.deepEqual(calls, [['review', id, { userId: 'ada', namespace: 'tenant-a' }]])
    assert.deepEqual(result, review)
    nativeReview.files[0]!.head.kind === 'text' && (nativeReview.files[0]!.head.text = 'mutated after return')
    assert.equal(result.files[0]!.head.kind === 'text' ? result.files[0]!.head.text : '', 'before')

    await assert.rejects(readLocalGitChanges('not-a-connection', scope), /connection is unavailable/i)
    assert.equal(calls.length, 1, 'an invalid id never reaches the native bridge')
    const malformed = scopeFor(bridge({ review: async () => ({ ...review, privatePath: '/private/repository' } as never) }))
    await assert.rejects(readLocalGitChanges(id, malformed), /invalid review/i)
  } finally { cleanup() }
})

test('native Git review response is fenced across an account switch', async () => {
  try {
    select(ada)
    const pending = deferred<LocalGitReview>()
    const calls: unknown[][] = []
    const scope = scopeFor(bridge({ review: (connectionId, source) => {
      calls.push([connectionId, source])
      return pending.promise
    } }))
    const reading = readLocalGitChanges(id, scope)
    refreshAccount({ userId: 'grace', tenantId: 'tenant-b' })
    setData(keys.me, grace)
    pending.resolve(review)
    await assert.rejects(reading, AccountSwitchedError)
    assert.deepEqual(calls, [[id, { userId: 'ada', namespace: 'tenant-a' }]])
  } finally { cleanup() }
})

test('native Git browsing lists metadata separately and reads only the explicitly selected path', async () => {
  try {
    select(ada)
    const calls: unknown[][] = []
    const listing: LocalGitFileListing = { version: 1, excludedCount: 3, files: [
      { path: 'README.md', kind: 'file' }, { path: 'merge.txt', kind: 'conflict' }, { path: 'src/lazy.ts', kind: 'sparse' },
    ] }
    const preview: LocalGitFilePreview = { version: 1, path: 'README.md', sizeBytes: 3, snapshot: { text: 'abc' } }
    const scope = scopeFor(bridge({
      files: async (connectionId, source) => { calls.push(['files', connectionId, source]); return listing },
      file: async (connectionId, selection, source) => { calls.push(['file', connectionId, selection, source]); return preview },
    }, calls))
    assert.deepEqual(await readLocalGitFiles(id, scope), listing)
    assert.deepEqual(calls, [['files', id, { userId: 'ada', namespace: 'tenant-a' }]], 'listing does not read file contents')
    assert.deepEqual(await readLocalGitFile(id, 'README.md', scope), preview)
    assert.deepEqual(calls[1], ['file', id, { path: 'README.md' }, { userId: 'ada', namespace: 'tenant-a' }])
    await assert.rejects(readLocalGitFile(id, '../secret', scope), /valid tracked file path/i)
    await assert.rejects(readLocalGitFiles('not-a-connection', scope), /connection is unavailable/i)
    assert.equal(calls.length, 2, 'invalid ids and paths never reach the native bridge')

    const malformed = scopeFor(bridge({ files: async () => ({ version: 1, files: [{ path: '../secret', kind: 'file' }], excludedCount: 0 } as never) }))
    await assert.rejects(readLocalGitFiles(id, malformed), /invalid file listing/i)
    const mismatched = scopeFor(bridge({ file: async () => ({ ...preview, path: 'other.txt' }) }))
    await assert.rejects(readLocalGitFile(id, 'README.md', mismatched), /invalid file preview/i)
  } finally { cleanup() }
})

test('native Git browsing results are fenced across account switches', async () => {
  try {
    select(ada)
    const pending = deferred<LocalGitFileListing>()
    const scope = scopeFor(bridge({ files: () => pending.promise }))
    const reading = readLocalGitFiles(id, scope)
    refreshAccount({ userId: 'grace', tenantId: 'tenant-b' })
    setData(keys.me, grace)
    pending.resolve({ version: 1, files: [{ path: 'README.md', kind: 'file' }], excludedCount: 0 })
    await assert.rejects(reading, AccountSwitchedError)

    select(ada)
    const pendingPreview = deferred<LocalGitFilePreview>()
    const previewScope = scopeFor(bridge({ file: () => pendingPreview.promise }))
    const previewRead = readLocalGitFile(id, 'README.md', previewScope)
    refreshAccount({ userId: 'grace', tenantId: 'tenant-b' })
    setData(keys.me, grace)
    pendingPreview.resolve({ version: 1, path: 'README.md', sizeBytes: 3, snapshot: { text: 'abc' } })
    await assert.rejects(previewRead, AccountSwitchedError)
  } finally { cleanup() }
})

test('Git document reads return detached containers for renderer extraction and fence identity changes', async () => {
  try {
    for (const format of ['pdf', 'docx', 'xlsx', 'pptx'] as const) {
      select(ada)
      const path = `reports/data.${format}`
      const bytes = new Uint8Array([1, 2, 3])
      const preview: LocalGitFilePreview = { version: 1, path, sizeBytes: 3, snapshot: { document: { format, bytes } } }
      const scope = scopeFor(bridge({ file: async () => preview }))
      const result = await readLocalGitFile(id, path, scope)
      assert.ok('document' in result.snapshot)
      assert.deepEqual(result.snapshot.document.bytes, bytes)
      bytes[0] = 9
      assert.equal(result.snapshot.document.bytes[0], 1, 'native output cannot mutate the accepted renderer input')
      const pending = deferred<LocalGitFilePreview>()
      const reading = readLocalGitFile(id, path, scopeFor(bridge({ file: () => pending.promise })))
      select(grace)
      pending.resolve(preview)
      await assert.rejects(reading, AccountSwitchedError)
    }
  } finally { cleanup() }
})
