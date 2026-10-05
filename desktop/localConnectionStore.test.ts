import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, rename, stat, symlink, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as fs from 'node:fs/promises'
import { LOCAL_CONNECTION_FILE, MAX_LOCAL_CONNECTIONS, MAX_LOCAL_CAPTURES, LocalConnectionError, openLocalConnectionStore } from './localConnectionStore.mjs'

// Reversible test stand-in, not an encryption provider or native Keychain proof.
const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
  decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
}
const ada = { namespace: 'acme', userId: 'ada' }
const bob = { namespace: 'acme', userId: 'bob' }
const otherAda = { namespace: 'other', userId: 'ada' }
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-local-connections-'))
  try {
    const profile = join(directory, 'profile')
    const folder = join(directory, 'source')
    await mkdir(profile, { mode: 0o700 })
    await mkdir(folder)
    await writeFile(join(folder, 'note.txt'), 'saved source text')
    const options = { filePath: join(profile, LOCAL_CONNECTION_FILE), storage }
    await run({ directory, profile, folder, options })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('selection defaults to process lifetime; listing and remembering never capture or attach content', async () => fixture(async ({ profile, folder, options }) => {
  let captures = 0
  const store = await openLocalConnectionStore({ ...options, capture: async () => { captures++; throw new Error('must not read') } })
  const connection = await store.connect({ owner: ada, path: folder })
  assert.deepEqual(Object.keys(connection).sort(), ['id', 'name', 'remembered'])
  assert.equal(connection.name, 'source')
  assert.equal(connection.remembered, false)
  assert.equal(captures, 0)
  assert.deepEqual(await store.list(ada), [connection])
  assert.deepEqual(await readdir(profile), [], 'no default disk grant or plaintext fallback')
  const reopened = await openLocalConnectionStore(options)
  assert.deepEqual(await reopened.list(ada), [], 'unremembered selection requires choosing again after restart')
  const remembered = await store.connect({ owner: ada, path: folder, remember: true })
  assert.equal(remembered.remembered, true)
  assert.equal(captures, 0)
  assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [remembered], 'later opt-in cannot persist other process-lifetime grants')
}))

test('only opted-in exact-owner grants survive reopen; bytes and root paths never enter descriptors', async () => fixture(async ({ profile, folder, options }) => {
  const first = await openLocalConnectionStore(options)
  const connection = await first.connect({ owner: ada, path: folder, remember: true })
  const raw = await readFile(options.filePath, 'utf8')
  for (const privateValue of [folder, 'saved source text', 'acme', connection.id]) assert.ok(!raw.includes(privateValue))
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['ciphertext', 'version'])
  assert.equal((await stat(options.filePath)).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(profile), [LOCAL_CONNECTION_FILE])
  const second = await openLocalConnectionStore(options)
  assert.deepEqual(await second.list(ada), [connection])
  for (const owner of [bob, otherAda]) {
    assert.deepEqual(await second.list(owner), [])
    await assert.rejects(second.snapshot(owner, connection.id), LocalConnectionError)
    await second.disconnect(owner, connection.id)
    assert.deepEqual(await second.list(ada), [connection], 'foreign disconnect cannot affect the owner')
  }
  const snapshot = await second.snapshot(ada, connection.id)
  assert.equal(snapshot.name, 'source')
  assert.equal(snapshot.files[0].snapshot.text, 'saved source text')
  assert.ok(!JSON.stringify(snapshot).includes(folder))
  assert.equal(await readFile(options.filePath, 'utf8'), raw, 'explicit snapshot does not rewrite the grant')
}))

test('disconnect revokes future and unsettled captures, preserves saved copies, and survives reopen', async () => fixture(async ({ folder, options }) => {
  let finish
  let started
  const held = new Promise((resolve) => { finish = resolve })
  const entered = new Promise((resolve) => { started = resolve })
  const store = await openLocalConnectionStore({ ...options, capture: () => { started(); return held } })
  const connection = await store.connect({ owner: ada, path: folder, remember: true })
  const pending = store.snapshot(ada, connection.id)
  const rejected = assert.rejects(pending, LocalConnectionError)
  await entered
  await store.disconnect(ada, connection.id)
  const savedCopy = { name: 'source', files: [{ name: 'note.txt', sizeBytes: 17, text: 'saved source text' }] }
  finish(savedCopy)
  await rejected
  assert.equal(savedCopy.files[0].text, 'saved source text')
  assert.equal(await readFile(join(folder, 'note.txt'), 'utf8'), 'saved source text')
  await assert.rejects(store.snapshot(ada, connection.id), LocalConnectionError)
  assert.deepEqual(await store.list(ada), [])
  await store.disconnect(ada, connection.id) // exact owner replay is harmless
  const reopened = await openLocalConnectionStore(options)
  assert.deepEqual(await reopened.list(ada), [])
}))

test('remembered roots retain identity and are never silently rebound to a replacement directory', async () => fixture(async ({ directory, folder, options }) => {
  const store = await openLocalConnectionStore(options)
  const connection = await store.connect({ owner: ada, path: folder, remember: true })
  await rename(folder, join(directory, 'original'))
  await mkdir(folder)
  await writeFile(join(folder, 'note.txt'), 'different data')
  const reopened = await openLocalConnectionStore(options)
  assert.deepEqual(await reopened.list(ada), [connection], 'listing is metadata-only, not a claim of availability')
  await assert.rejects(reopened.snapshot(ada, connection.id), LocalConnectionError)
  assert.deepEqual(await reopened.list(ada), [connection], 'failed capture preserves reconnectable metadata')
}))

test('explicit secure-storage opt-in fails closed without affecting process-lifetime selection', async () => fixture(async ({ profile, folder, options }) => {
  const store = await openLocalConnectionStore({ ...options, platform: 'linux', storage: { ...storage, getSelectedStorageBackend: () => 'basic_text' } })
  const ephemeral = await store.connect({ owner: ada, path: folder })
  await assert.rejects(store.connect({ owner: ada, path: folder, remember: true }), LocalConnectionError)
  assert.deepEqual(await store.list(ada), [ephemeral])
  assert.deepEqual(await readdir(profile), [])
  assert.equal((await store.snapshot(ada, ephemeral.id)).files[0].snapshot.text, 'saved source text')
}))

test('corrupt or undecryptable storage is preserved, never reset or exposed in errors', async () => fixture(async ({ folder, options }) => {
  const first = await openLocalConnectionStore(options)
  await first.connect({ owner: ada, path: folder, remember: true })
  const raw = await readFile(options.filePath, 'utf8')
  await assert.rejects(openLocalConnectionStore({ ...options, storage: { ...storage, decryptString: () => { throw new Error(folder) } } }),
    (error) => error instanceof LocalConnectionError && !error.message.includes(folder) && !error.cause)
  assert.equal(await readFile(options.filePath, 'utf8'), raw)
  for (const malformed of ['', 'invalid', ' '.repeat(600_000), '{"version":2,"ciphertext":"eA=="}']) {
    await writeFile(options.filePath, malformed, { mode: 0o600 })
    await assert.rejects(openLocalConnectionStore(options), LocalConnectionError)
    assert.equal(await readFile(options.filePath, 'utf8'), malformed)
  }
}))

test('unsafe storage is refused without following links or repairing permissions', async () => fixture(async ({ directory, profile, folder, options }) => {
  const target = join(directory, 'unrelated')
  await writeFile(target, 'keep me')
  await symlink(target, options.filePath)
  await assert.rejects(openLocalConnectionStore(options), LocalConnectionError)
  assert.equal(await readFile(target, 'utf8'), 'keep me')
  await rm(options.filePath)
  const store = await openLocalConnectionStore(options)
  await store.connect({ owner: ada, path: folder, remember: true })
  await chmod(options.filePath, 0o644)
  await assert.rejects(openLocalConnectionStore(options), LocalConnectionError)
  assert.equal((await stat(options.filePath)).mode & 0o777, 0o644)
  await chmod(options.filePath, 0o600)
  await chmod(profile, 0o755)
  await assert.rejects(openLocalConnectionStore(options), LocalConnectionError)
  assert.equal((await stat(profile)).mode & 0o777, 0o755)
}))

test('queued remembered changes preserve every connection and returned metadata cannot mutate authority', async () => fixture(async ({ folder, options }) => {
  const store = await openLocalConnectionStore(options)
  const connections = await Promise.all(Array.from({ length: 5 }, () => store.connect({ owner: ada, path: folder, remember: true })))
  connections[0].name = 'changed by caller'
  const listed = await store.list(ada)
  assert.equal(listed[0].name, 'source')
  const reopened = await openLocalConnectionStore(options)
  assert.deepEqual(await reopened.list(ada), listed)
  await Promise.all(listed.map((connection) => store.disconnect(ada, connection.id)))
  assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [])
}))

test('invalid identities and opt-in values fail before root inspection; queued bindings are frozen copies', async () => fixture(async ({ folder, options }) => {
  const store = await openLocalConnectionStore({ ...options, inspectRoot: () => { throw new Error('must not inspect') } })
  for (const owner of [null, {}, { namespace: 'acme' }, { ...ada, extra: 'authority' }, { ...ada, userId: '' }, { ...ada, namespace: 'a\nb' }]) {
    await assert.rejects(store.connect({ owner, path: folder }), LocalConnectionError)
    await assert.rejects(store.list(owner), LocalConnectionError)
  }
  for (const remember of ['yes', 1, null]) await assert.rejects(store.connect({ owner: ada, path: folder, remember }), LocalConnectionError)
  const working = await openLocalConnectionStore(options)
  const owner = { ...ada }
  const pending = working.connect({ owner, path: folder })
  owner.userId = 'bob'
  const connection = await pending
  assert.deepEqual(await working.list(ada), [connection])
  assert.deepEqual(await working.list(bob), [])
}))

test('the device-wide limit is bounded across accounts without dropping prior grants', async () => fixture(async ({ folder, options }) => {
  const store = await openLocalConnectionStore(options)
  for (let index = 0; index < MAX_LOCAL_CONNECTIONS; index++) await store.connect({ owner: ada, path: folder })
  await assert.rejects(store.connect({ owner: bob, path: folder }), (error) => error instanceof LocalConnectionError && error.code === 'limit-reached')
  const connections = await store.list(ada)
  assert.equal(connections.length, MAX_LOCAL_CONNECTIONS)
  await store.disconnect(ada, connections[0].id)
  assert.equal((await store.connect({ owner: bob, path: folder })).remembered, false)
}))

test('failed encryption cannot claim a remembered connection or acknowledge disconnect', async () => fixture(async ({ folder, options }) => {
  let locked = false
  const store = await openLocalConnectionStore({ ...options, storage: {
    ...storage, encryptString: (value) => { if (locked) throw new Error(folder); return storage.encryptString(value) },
  } })
  const connection = await store.connect({ owner: ada, path: folder, remember: true })
  const raw = await readFile(options.filePath, 'utf8')
  locked = true
  await assert.rejects(store.connect({ owner: ada, path: folder, remember: true }), LocalConnectionError)
  await assert.rejects(store.disconnect(ada, connection.id), LocalConnectionError)
  assert.equal(await readFile(options.filePath, 'utf8'), raw)
  assert.deepEqual(await store.list(ada), [connection])
  locked = false
  await store.disconnect(ada, connection.id)
  assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [])
}))

test('external vault replacement fails closed without overwriting it or continuing captures', async () => fixture(async ({ folder, options }) => {
  const store = await openLocalConnectionStore(options)
  const connection = await store.connect({ owner: ada, path: folder, remember: true })
  await writeFile(options.filePath, 'externally changed', { mode: 0o600 })
  await assert.rejects(store.disconnect(ada, connection.id), LocalConnectionError)
  assert.equal(await readFile(options.filePath, 'utf8'), 'externally changed')
  await assert.rejects(store.snapshot(ada, connection.id), LocalConnectionError)
  await assert.rejects(store.list(ada), LocalConnectionError)
}))

test('decrypted payloads have a closed, bounded schema and cannot rebind malformed roots', async () => fixture(async ({ folder, options }) => {
  const store = await openLocalConnectionStore(options)
  await store.connect({ owner: ada, path: folder, remember: true })
  const raw = JSON.parse(await readFile(options.filePath, 'utf8'))
  const valid = JSON.parse(storage.decryptString(Buffer.from(raw.ciphertext, 'base64')))
  const mutations = [
    (data) => { data.version = 2 },
    (data) => { data.extra = true },
    (data) => { data.entries.push(data.entries[0]) },
    (data) => { data.entries[0].id = [data.entries[0].id] },
    (data) => { data.entries[0].owner.userId = '' },
    (data) => { data.entries[0].root.path = '../different' },
    (data) => { data.entries[0].root.path += '/..' },
    (data) => { data.entries[0].root.identity.ino = 'invalid' },
    (data) => { data.entries[0].root.identity.dev = -1 },
    (data) => { data.entries[0].remembered = false },
  ]
  for (const mutate of mutations) {
    const payload = structuredClone(valid)
    mutate(payload)
    const poisoned = JSON.stringify({ version: 1, ciphertext: storage.encryptString(JSON.stringify(payload)).toString('base64') })
    await writeFile(options.filePath, poisoned, { mode: 0o600 })
    await assert.rejects(openLocalConnectionStore(options), LocalConnectionError)
    assert.equal(await readFile(options.filePath, 'utf8'), poisoned)
  }
}))

test('capture capacity is bounded and disconnect cancels outstanding read work', async () => fixture(async ({ folder, options }) => {
  const signals: AbortSignal[] = []
  let announceStarted
  const allStarted = new Promise((resolve) => { announceStarted = resolve })
  const store = await openLocalConnectionStore({ ...options, capture: async (_root, { signal }) => {
    signals.push(signal)
    if (signals.length === MAX_LOCAL_CAPTURES) announceStarted()
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    throw new Error('cancelled')
  } })
  const connection = await store.connect({ owner: ada, path: folder })
  const rejected = Array.from({ length: MAX_LOCAL_CAPTURES }, () => assert.rejects(store.snapshot(ada, connection.id), LocalConnectionError))
  await allStarted
  await assert.rejects(store.snapshot(ada, connection.id), (error) => error instanceof LocalConnectionError && error.code === 'busy')
  await store.disconnect(ada, connection.id)
  assert.equal(signals.length, MAX_LOCAL_CAPTURES)
  assert.ok(signals.every((signal) => signal.aborted))
  await Promise.all(rejected)
}))

// Wrap real descriptors rather than substituting an in-memory filesystem: the
// published bytes, temp cleanup, reopened state and acknowledgement stay real.
function failingDisk(profile: string, shouldFail: (phase: string) => boolean) {
  return {
    ...fs,
    rename: async (...args) => {
      if (shouldFail('rename')) throw new Error('injected rename failure')
      return fs.rename(...args)
    },
    open: async (path, flags, ...args) => {
      if (flags === 'wx' && shouldFail('open')) throw new Error('injected open failure')
      const handle = await fs.open(path, flags, ...args)
      return new Proxy(handle, { get(target, key) {
        const value = Reflect.get(target, key, target)
        if (flags === 'wx' && ['writeFile', 'sync'].includes(String(key))) return async (...values) => {
          if (shouldFail(String(key))) throw new Error('injected temporary file failure')
          return value.apply(target, values)
        }
        if (path === profile && key === 'sync') return async () => {
          if (shouldFail('directory-sync')) throw new Error('injected directory sync failure')
          return value.call(target)
        }
        return typeof value === 'function' ? value.bind(target) : value
      } })
    },
  }
}

for (const phase of ['open', 'writeFile', 'sync', 'rename', 'directory-sync']) {
  test(`disconnect cannot falsely acknowledge ${phase} failure or overwrite uncertain disk truth`, async () => fixture(async ({ profile, folder, options }) => {
    let armed = false
    const store = await openLocalConnectionStore({ ...options, fsApi: failingDisk(profile, (stage) => armed && stage === phase) })
    const connection = await store.connect({ owner: ada, path: folder, remember: true })
    const raw = await readFile(options.filePath, 'utf8')
    armed = true
    await assert.rejects(store.disconnect(ada, connection.id), LocalConnectionError)
    assert.deepEqual(await readdir(profile), [LOCAL_CONNECTION_FILE], 'temporary encrypted files are cleaned up')
    armed = false
    if (phase === 'directory-sync') {
      assert.notEqual(await readFile(options.filePath, 'utf8'), raw, 'rename happened but durability was not acknowledged')
      const uncertain = await readFile(options.filePath, 'utf8')
      await assert.rejects(store.list(ada), LocalConnectionError)
      await assert.rejects(store.snapshot(ada, connection.id), LocalConnectionError)
      await assert.rejects(store.disconnect(ada, connection.id), LocalConnectionError)
      assert.equal(await readFile(options.filePath, 'utf8'), uncertain)
      assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [], 'reopen adopts the actual durable state')
    } else {
      assert.equal(await readFile(options.filePath, 'utf8'), raw)
      assert.deepEqual(await store.list(ada), [connection])
      assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [connection])
      await store.disconnect(ada, connection.id)
      assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [])
    }
  }))
}
