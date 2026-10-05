import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalConnectionHost } from './localConnectionHost.mjs'
import { LocalConnectionError } from './localConnectionStore.mjs'

const event = { sender: 'trusted' }
const identityA = { user: { id: 'user-a' }, tenant: { id: 'tenant-a', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const identityB = { user: { id: 'user-b' }, tenant: { id: 'tenant-b', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
const validId = 'LOCAL_0123456789ABCDEF0123456789ABCDEF'
const source = (identity = identityA, cookieGeneration = 1, cookieFingerprint = 'fingerprint-a') => ({ identity, cookieGeneration, cookieFingerprint })

function fakeStore(overrides = {}) {
  const calls = []
  return {
    calls,
    async list(owner) { calls.push(['list', owner]); return [{ id: validId, name: 'selected', remembered: false, rootPath: '/private/path' }] },
    async connect(input) { calls.push(['connect', input]); return { id: validId, name: 'selected', remembered: input.remember, root: { path: input.path } } },
    async snapshot(owner, id) { calls.push(['snapshot', owner, id]); return { name: 'selected', path: '/private/path', files: [{ name: 'note.txt', sizeBytes: 4, snapshot: { text: 'body' } }] } },
    async disconnect(owner, id) { calls.push(['disconnect', owner, id]) },
    ...overrides,
  }
}

function makeHost({ store = fakeStore(), resolveSource = async () => source(), assertCaller = (candidate) => assert.equal(candidate, event), showFolderDialog = async () => ({ canceled: false, filePaths: ['/private/path'] }) } = {}) {
  return { host: createLocalConnectionHost({ store, resolveSource, assertCaller, showFolderDialog }), store }
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
