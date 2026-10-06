import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/identity.ts'
import type { LocalGitConnection, NativeLocalGitBridge } from '../../contract/localGitCapture.ts'
import type { LocalGitReview } from '../../contract/localGitReview.mjs'
import { refreshAccount, accountGeneration } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { AccountSwitchedError } from './client.ts'
import { keys } from './keys.ts'
import { localGitAvailable } from './localGitCapability.ts'
import { captureLocalGit, captureLocalGitSource, connectLocalGit, disconnectLocalGit, readLocalGitChanges, readLocalGitConnections } from './localGit.ts'

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
