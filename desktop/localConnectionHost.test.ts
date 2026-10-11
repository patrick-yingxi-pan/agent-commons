import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalConnectionHost, localConnectionReply } from './localConnectionHost.mjs'
import { LocalConnectionError } from './localConnectionStore.mjs'

const event = { sender: 'trusted' }
const identityA = { user: { id: 'user-a' }, tenant: { id: 'tenant-a', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const identityB = { user: { id: 'user-b' }, tenant: { id: 'tenant-b', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const validId = 'LOCAL_0123456789ABCDEF0123456789ABCDEF'
const validGitId = 'GIT_0123456789ABCDEF0123456789ABCDEF'
const source = (identity = identityA, cookieGeneration = 1, cookieFingerprint = 'fingerprint-a') => ({ identity, cookieGeneration, cookieFingerprint })
const validReview = () => ({
  version: 1, comparison: 'raw', head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
  excludedCount: 0, unchangedCount: 0,
  files: [{
    path: 'src/note.txt', staged: 'modified', unstaged: 'modified',
    head: { kind: 'text', text: 'head\n', mode: '100644' },
    index: { kind: 'text', text: 'index\n', mode: '100644' },
    working: { kind: 'text', text: 'working\n', mode: '100644' },
  }],
})

function fakeStore(overrides = {}) {
  const calls = []
  return {
    calls,
    async list(owner) { calls.push(['list', owner]); return [{ id: validId, name: 'selected', remembered: false, rootPath: '/private/path' }] },
    async connect(input) { calls.push(['connect', input]); return { id: validId, name: 'selected', remembered: input.remember, root: { path: input.path } } },
    async snapshot(owner, id) { calls.push(['snapshot', owner, id]); return { name: 'selected', path: '/private/path', files: [{ name: 'note.txt', sizeBytes: 4, snapshot: { text: 'body' } }] } },
    async snapshotTree(owner, id) { calls.push(['snapshotTree', owner, id]); return { name: 'selected', path: '/private/path', files: [{ name: 'nested/note.txt', sizeBytes: 4, snapshot: { text: 'body' } }] } },
    async review(owner, id) { calls.push(['review', owner, id]); return validReview() },
    async disconnect(owner, id) { calls.push(['disconnect', owner, id]) },
    ...overrides,
  }
}

function makeHost({ store = fakeStore(), resolveSource = async () => source(), assertCaller = (candidate) => assert.equal(candidate, event), showFolderDialog = async () => ({ canceled: false, filePaths: ['/private/path'] }), connectionKind = 'folder' } = {}) {
  return { host: createLocalConnectionHost({ store, resolveSource, assertCaller, showFolderDialog, connectionKind }), store }
}

test('connect derives exact owner, uses only the native-selected path, and does not capture content', async () => {
  const { host, store } = makeHost()
  const result = await host.connect(event, { remember: true }, { namespace: 'tenant-a', userId: 'user-a' })
  assert.deepEqual(result, { status: 'connected', connection: { id: validId, name: 'selected', remembered: true } })
  assert.deepEqual(store.calls, [['connect', { owner: { namespace: 'tenant-a', userId: 'user-a' }, path: '/private/path', remember: true }]])
})

test('credential-less desktop default maps only its fixed local identity', async () => {
  const localIdentity = { user: { id: 'user-local' }, tenant: { id: 'tenant-personal', kind: 'personal' }, role: 'owner', local: true, via: 'default' }
  const { host, store } = makeHost({ resolveSource: async () => source(localIdentity) })
  assert.deepEqual(await host.list(event, { namespace: 'tenant-personal', userId: 'user-local' }), [
    { id: validId, name: 'selected', remembered: false },
  ])
  assert.deepEqual(store.calls, [['list', { namespace: 'tenant-personal', userId: 'user-local' }]])
})

test('renderer owner and path claims are rejected before opening the dialog', async () => {
  let dialogs = 0
  const { host, store } = makeHost({ showFolderDialog: async () => { dialogs++; return { canceled: false, filePaths: ['/safe'] } } })
  await assert.rejects(host.connect(event, { remember: false, path: '/attacker/path', owner: { namespace: 'tenant-b', userId: 'user-b' } }, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  assert.equal(dialogs, 0)
  assert.deepEqual(store.calls, [])
})

test('account change during the native dialog refuses the selection without persisting a grant', async () => {
  let lookups = 0
  const { host, store } = makeHost({
    resolveSource: async () => ++lookups === 1 ? source(identityA) : source(identityB, 2, 'fingerprint-b'),
  })
  await assert.rejects(host.connect(event, { remember: true }, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  assert.deepEqual(store.calls, [])
})

test('account change while persistence is pending rolls back the exact newly created grant', async () => {
  let lookups = 0
  const store = fakeStore({
    async connect(input) { this.calls.push(['connect', input]); return { id: validId, name: 'selected', remembered: input.remember } },
  })
  const { host } = makeHost({
    store,
    resolveSource: async () => ++lookups <= 2 ? source(identityA) : source(identityB, 2, 'fingerprint-b'),
  })
  await assert.rejects(host.connect(event, { remember: true }, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  assert.deepEqual(store.calls.map(([name, ...args]) => [name, ...args]), [
    ['connect', { owner: { namespace: 'tenant-a', userId: 'user-a' }, path: '/private/path', remember: true }],
    ['disconnect', { namespace: 'tenant-a', userId: 'user-a' }, validId],
  ])
})

test('cookie generation fences away-and-back account changes during capture', async () => {
  let lookups = 0
  const { host, store } = makeHost({
    resolveSource: async () => ++lookups === 1 ? source(identityA, 7, 'same-cookie') : source(identityA, 9, 'same-cookie'),
  })
  await assert.rejects(host.snapshot(event, validId, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  assert.deepEqual(store.calls, [['snapshot', { namespace: 'tenant-a', userId: 'user-a' }, validId]])
})

test('snapshot output is fenced and projected to path-free snapshot fields', async () => {
  const { host } = makeHost()
  assert.deepEqual(await host.snapshot(event, validId, { namespace: 'tenant-a', userId: 'user-a' }), {
    name: 'selected', files: [{ name: 'note.txt', sizeBytes: 4, snapshot: { text: 'body' } }],
  })
})

test('recursive folder snapshot is exact-arity, account-fenced, validated, and strictly path-free', async () => {
  const { host, store } = makeHost()
  const result = await host.snapshotTree(event, validId, { namespace: 'tenant-a', userId: 'user-a' })
  assert.deepEqual(store.calls, [['snapshotTree', { namespace: 'tenant-a', userId: 'user-a' }, validId]])
  assert.deepEqual(result, { name: 'selected', files: [{ name: 'nested/note.txt', sizeBytes: 4, snapshot: { text: 'body' } }] })
  assert.equal(JSON.stringify(result).includes('/private/path'), false)

  await assert.rejects(host.snapshotTree(event, validId, { namespace: 'tenant-a', userId: 'user-a' }, 'extra'), LocalConnectionError)
  await assert.rejects(host.snapshotTree(event, 'LOCAL_../../private/path', { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)

  const malformed = fakeStore({ async snapshotTree() { return { name: '/private/path', files: [{ name: '../secret.txt', sizeBytes: 4, snapshot: { text: 'body' } }] } } })
  const malformedHost = makeHost({ store: malformed }).host
  await assert.rejects(malformedHost.snapshotTree(event, validId, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)

  const git = makeHost({ connectionKind: 'git' }).host
  await assert.rejects(git.snapshotTree(event, validId, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)

  let lookups = 0
  const switched = makeHost({ resolveSource: async () => ++lookups === 1 ? source(identityA) : source(identityB, 2, 'fingerprint-b') }).host
  await assert.rejects(switched.snapshotTree(event, validId, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
})

test('Git review uses the native connection ID, fences account identity, and returns detached path-free output', async () => {
  const raw = validReview()
  const store = fakeStore({ async review(owner, id) { this.calls.push(['review', owner, id]); return raw } })
  const { host } = makeHost({ store, connectionKind: 'git' })
  const result = await host.review(event, validGitId, { namespace: 'tenant-a', userId: 'user-a' })
  assert.deepEqual(store.calls, [['review', { namespace: 'tenant-a', userId: 'user-a' }, validGitId]])
  assert.deepEqual(result, raw)
  assert.notStrictEqual(result, raw)
  assert.notStrictEqual(result.files, raw.files)
  raw.files[0].working.text = 'mutated after IPC projection'
  assert.equal(result.files[0].working.text, 'working\n', 'the host returns parser-detached data')
  assert.equal(JSON.stringify(result).includes('/private/path'), false)

  let lookups = 0
  const staleStore = fakeStore()
  const staleHost = makeHost({
    store: staleStore,
    connectionKind: 'git',
    resolveSource: async () => ++lookups === 1 ? source(identityA) : source(identityB, 2, 'fingerprint-b'),
  }).host
  await assert.rejects(staleHost.review(event, validGitId, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  assert.deepEqual(staleStore.calls, [['review', { namespace: 'tenant-a', userId: 'user-a' }, validGitId]],
    'an account switch during content review fences its late result')
})

test('review is exact-arity Git-only and malformed parser output becomes generic unavailable', async () => {
  const folder = makeHost().host
  await assert.rejects(folder.review(event, validGitId, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  const store = fakeStore()
  const { host } = makeHost({ store, connectionKind: 'git' })
  await assert.rejects(host.review(event, validGitId, { namespace: 'tenant-a', userId: 'user-a' }, 'extra'), LocalConnectionError)
  await assert.rejects(host.review(event, 'GIT_../../private/path', { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  const unsafe = fakeStore({ async review() { return { ...validReview(), files: [{ ...validReview().files[0], path: '/Users/private/source.txt' }] } } })
  const unsafeHost = makeHost({ store: unsafe, connectionKind: 'git' }).host
  await assert.rejects(unsafeHost.review(event, validGitId, { namespace: 'tenant-a', userId: 'user-a' }), (error) => {
    assert.ok(error instanceof LocalConnectionError)
    assert.equal(error.message.includes('/Users/private'), false)
    assert.equal(error.cause, undefined)
    return true
  })
  assert.deepEqual(store.calls, [], 'invalid argument shape and identity never reaches storage')
})

test('unauthorized sender is refused before identity lookup, dialog, or store access', async () => {
  let sourceReads = 0
  let dialogs = 0
  const store = fakeStore()
  const { host } = makeHost({
    store,
    assertCaller: () => { throw new Error('untrusted sender') },
    resolveSource: async () => { sourceReads++; return source() },
    showFolderDialog: async () => { dialogs++; return { canceled: true, filePaths: [] } },
  })
  await assert.rejects(host.list(event, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  await assert.rejects(host.connect(event, { remember: false }, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  assert.equal(sourceReads, 0)
  assert.equal(dialogs, 0)
  assert.deepEqual(store.calls, [])
})

test('header-derived and anonymous identities fail closed', async () => {
  const { host } = makeHost({ resolveSource: async () => source({ ...identityA, via: 'headers' }) })
  await assert.rejects(host.list(event, { namespace: 'tenant-a', userId: 'user-a' }), LocalConnectionError)
  const anonymous = { user: { id: 'user-anonymous' }, tenant: { id: 'tenant-anonymous', kind: 'personal' }, role: 'member', local: false, via: 'default' }
  const anonymousHost = makeHost({ resolveSource: async () => source(anonymous) }).host
  await assert.rejects(anonymousHost.list(event, { namespace: 'tenant-anonymous', userId: 'user-anonymous' }), LocalConnectionError)
})

test('stale UI identity preconditions cannot list or mutate the current account', async () => {
  const { host, store } = makeHost()
  for (const stale of [undefined, null, { namespace: 'tenant-b', userId: 'user-b' }, { namespace: 'tenant-a', userId: 'user-a', extra: true }]) {
    await assert.rejects(host.list(event, stale), LocalConnectionError)
    await assert.rejects(host.disconnect(event, validId, stale), LocalConnectionError)
  }
  await assert.rejects(host.list(event, { namespace: 'tenant-a', userId: 'user-a' }, 'unexpected'), LocalConnectionError)
  assert.deepEqual(store.calls, [])
})

test('local connection replies retain only known store failure codes and never serialize error details', async () => {
  assert.deepEqual(await localConnectionReply(async () => ({ safe: true })), { ok: true, value: { safe: true } })
  for (const code of ['busy', 'limit-reached']) {
    const failure = new LocalConnectionError(code)
    failure.message = '/private/path must not cross IPC'
    failure.cause = new Error('private native cause')
    assert.deepEqual(await localConnectionReply(async () => { throw failure }), { ok: false, error: code })
  }

  for (const failure of [
    new LocalConnectionError('future-code'),
    Object.assign(new Error('/private/path'), { code: 'busy', cause: new Error('native cause') }),
  ]) {
    assert.deepEqual(await localConnectionReply(async () => { throw failure }), { ok: false, error: 'unavailable' })
  }
})

test('host preserves known store guidance for snapshot and connect failures', async () => {
  const busyStore = fakeStore({ async snapshot() { throw new LocalConnectionError('busy') } })
  const { host: busyHost } = makeHost({ store: busyStore })
  await assert.rejects(busyHost.snapshot(event, validId, { namespace: 'tenant-a', userId: 'user-a' }), (error) => {
    assert.ok(error instanceof LocalConnectionError)
    assert.equal(error.code, 'busy')
    return true
  })

  const limitedStore = fakeStore({ async connect() { throw new LocalConnectionError('limit-reached') } })
  const { host: limitedHost } = makeHost({ store: limitedStore })
  await assert.rejects(limitedHost.connect(event, { remember: true }, { namespace: 'tenant-a', userId: 'user-a' }), (error) => {
    assert.ok(error instanceof LocalConnectionError)
    assert.equal(error.code, 'limit-reached')
    return true
  })
})
