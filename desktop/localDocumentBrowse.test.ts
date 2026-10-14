import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalConnectionError, openLocalConnectionStore } from './localConnectionStore.mjs'
import { createLocalConnectionHost } from './localConnectionHost.mjs'

const storage = {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString(),
}
const owner = { namespace: 'tenant-a', userId: 'user-a' }
const foreign = { namespace: 'tenant-a', userId: 'user-b' }
const source = { identity: { user: { id: owner.userId }, tenant: { id: owner.namespace, kind: 'personal' },
  role: 'owner', local: false, via: 'session' }, cookieGeneration: 1, cookieFingerprint: 'fingerprint-a' }
const event = { sender: 'trusted' }
const rawPreview = () => ({ version: 1, path: 'selected.pdf', sizeBytes: 3,
  snapshot: { document: { format: 'pdf', bytes: new Uint8Array([0, 255, 1]) } } })

function deferred() {
  let resolve!: (value?: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(kind: 'folder' | 'git', preview: (...args: any[]) => any, run: (data: any) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'local-document-browse-'))
  const profile = join(base, 'profile'), root = join(base, 'source')
  await mkdir(profile, { mode: 0o700 }); await mkdir(root)
  try {
    const store = await openLocalConnectionStore({ filePath: join(profile, 'connections.json'), storage, connectionKind: kind,
      ...(kind === 'git' ? {
        validateRoot: (value: any) => !!value?.repository && typeof value.path === 'string',
        inspectRoot: async (path: string) => ({ path, identity: { dev: '1', ino: '2' }, repository: {} }), preview,
      } : { previewFile: preview }) })
    const connection = await store.connect({ owner, path: root })
    const host = createLocalConnectionHost({ store, connectionKind: kind, resolveSource: async () => source,
      assertCaller: (candidate: any) => assert.strictEqual(candidate, event), showFolderDialog: async () => ({ canceled: true, filePaths: [] }) })
    await run({ store, host, id: connection.id })
  } finally { await rm(base, { recursive: true, force: true }) }
}

for (const kind of ['folder', 'git'] as const) {
  test(`${kind} selected-document store and host detach bytes and preserve exact owner/source admission`, async () => {
    const original = rawPreview()
    let reads = 0
    await fixture(kind, async () => { reads++; return original }, async ({ store, host, id }) => {
      await assert.rejects(store.file(foreign, id, { path: original.path }), LocalConnectionError)
      await assert.rejects(host.file(event, id, { path: original.path }, foreign), LocalConnectionError)
      assert.equal(reads, 0)
      const parsed = await store.file(owner, id, { path: original.path })
      const delivered = await host.file(event, id, { path: original.path }, owner)
      assert.deepEqual(parsed, original)
      assert.deepEqual(delivered, original)
      assert.notStrictEqual(parsed.snapshot.document.bytes, original.snapshot.document.bytes)
      assert.notStrictEqual(delivered.snapshot.document.bytes, original.snapshot.document.bytes)
      original.snapshot.document.bytes[0] = 99
      assert.equal(parsed.snapshot.document.bytes[0], 0)
      assert.equal(delivered.snapshot.document.bytes[0], 0)
      assert.equal(reads, 2)
    })
  })

  test(`${kind} selected-document malformed bytes and late disconnect results fail closed`, async () => {
    await fixture(kind, async () => ({ ...rawPreview(), sizeBytes: 99 }), async ({ host, id }) => {
      await assert.rejects(host.file(event, id, { path: 'selected.pdf' }, owner), LocalConnectionError)
    })
    const entered = deferred(), held = deferred()
    await fixture(kind, async () => { entered.resolve(); return held.promise }, async ({ store, host, id }) => {
      const pending = assert.rejects(host.file(event, id, { path: 'selected.pdf' }, owner), LocalConnectionError)
      await entered.promise
      await store.disconnect(owner, id)
      held.resolve(rawPreview())
      await pending
    })
  })
}
