import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LOCAL_CONNECTION_FILE, LOCAL_GIT_CONNECTION_FILE, LocalConnectionError, openLocalConnectionStore } from './localConnectionStore.mjs'

// Reversible fixture only; production Remember still requires OS-backed storage.
const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
  decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
}
const ada = { namespace: 'acme', userId: 'ada' }
const bob = { namespace: 'acme', userId: 'bob' }
const gitRoot = (path: string) => ({
  path, identity: { dev: '1', ino: '2' },
  repository: { path: `${path}/.git`, identity: { dev: '3', ino: '4' }, commonPath: `${path}/.git`, commonIdentity: { dev: '3', ino: '4' }, marker: null },
})
const validateGitRoot = (value: any) => !!value?.repository && typeof value.path === 'string'

async function fixture(run: (value: any) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-local-git-connections-'))
  try {
    const profile = join(directory, 'profile')
    const repo = join(directory, 'repository')
    await mkdir(profile, { mode: 0o700 })
    await mkdir(repo)
    const options = {
      filePath: join(profile, LOCAL_GIT_CONNECTION_FILE), storage, connectionKind: 'git', validateRoot: validateGitRoot,
      inspectRoot: async (path: string) => gitRoot(path),
      capture: async () => ({ name: 'repository', files: [{ path: '.github/check.yml', sizeBytes: 4, snapshot: { text: 'test' } }] }),
    }
    await run({ directory, profile, repo, options })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

function poisonedEnvelope(plaintext: string) {
  return `${JSON.stringify({ version: 1, ciphertext: storage.encryptString(plaintext).toString('base64') })}\n`
}

test('Git Remember is opt-in, survives reopen in its separate file, and remains owner-bound without listing or capturing content', async () => fixture(async ({ profile, repo, options }) => {
  let captures = 0
  const capture = async () => {
    captures++
    return { name: 'repository', files: [{ path: 'src/main.ts', sizeBytes: 1, snapshot: { text: 'x' } }] }
  }
  const store = await openLocalConnectionStore({ ...options, capture })
  const temporary = await store.connect({ owner: ada, path: repo })
  assert.match(temporary.id, /^GIT_[A-F0-9]{32}$/)
  assert.equal(temporary.remembered, false)
  assert.equal(captures, 0)
  assert.deepEqual(await store.list(ada), [temporary])
  assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [], 'Remember false does not persist across process restart')

  const remembered = await store.connect({ owner: ada, path: repo, remember: true })
  const raw = await readFile(options.filePath, 'utf8')
  assert.deepEqual(await readdir(profile), [LOCAL_GIT_CONNECTION_FILE], 'Git grants use a dedicated store file')
  assert.ok(!raw.includes(repo), 'the encrypted file does not expose the selected path')
  assert.ok(!raw.includes(remembered.id), 'the encrypted file does not expose connection identities')
  assert.equal(captures, 0, 'connect and list never read repository contents')

  const reopened = await openLocalConnectionStore({ ...options, capture })
  assert.deepEqual(await reopened.list(ada), [remembered])
  for (const owner of [bob, { namespace: 'other', userId: 'ada' }]) {
    assert.deepEqual(await reopened.list(owner), [])
    await assert.rejects(reopened.snapshot(owner, remembered.id), LocalConnectionError)
    await reopened.disconnect(owner, remembered.id)
    assert.deepEqual(await reopened.list(ada), [remembered], 'foreign owner cannot read or revoke this grant')
  }
  const snapshot = await reopened.snapshot(ada, remembered.id)
  assert.deepEqual(snapshot.files, [{ path: 'src/main.ts', sizeBytes: 1, snapshot: { text: 'x' } }])
  assert.equal(JSON.stringify(snapshot).includes(repo), false, 'explicit capture returns relative paths, never the repository root')
  assert.equal(captures, 1, 'only explicit snapshot reads tracked bytes')
}))

test('Folder and Git connection stores reject each other’s persisted ID families without rewriting disk', async () => fixture(async ({ profile, repo, options }) => {
  const gitStore = await openLocalConnectionStore(options)
  const git = await gitStore.connect({ owner: ada, path: repo, remember: true })
  const gitRaw = await readFile(options.filePath, 'utf8')
  const gitPayload = JSON.parse(storage.decryptString(Buffer.from(JSON.parse(gitRaw).ciphertext, 'base64')))
  gitPayload.entries[0].id = 'LOCAL_0123456789ABCDEF0123456789ABCDEF'
  const poisonedGit = poisonedEnvelope(JSON.stringify(gitPayload))
  await writeFile(options.filePath, poisonedGit, { mode: 0o600 })
  await assert.rejects(openLocalConnectionStore(options), LocalConnectionError, 'Git store refuses a persisted LOCAL identity')
  assert.equal(await readFile(options.filePath, 'utf8'), poisonedGit, 'invalid Git state is preserved without repair')

  const folderPath = join(profile, LOCAL_CONNECTION_FILE)
  const folderStore = await openLocalConnectionStore({ ...options, filePath: folderPath, connectionKind: 'folder',
    inspectRoot: async (path: string) => ({ path, identity: { dev: '5', ino: '6' } }), validateRoot: undefined })
  const local = await folderStore.connect({ owner: ada, path: repo, remember: true })
  const localRaw = await readFile(folderPath, 'utf8')
  const localPayload = JSON.parse(storage.decryptString(Buffer.from(JSON.parse(localRaw).ciphertext, 'base64')))
  localPayload.entries[0].id = 'GIT_0123456789ABCDEF0123456789ABCDEF'
  const poisonedFolder = poisonedEnvelope(JSON.stringify(localPayload))
  await writeFile(folderPath, poisonedFolder, { mode: 0o600 })
  await assert.rejects(openLocalConnectionStore({ ...options, filePath: folderPath, connectionKind: 'folder' }), LocalConnectionError, 'Folder store refuses a persisted GIT identity')
  assert.equal(await readFile(folderPath, 'utf8'), poisonedFolder, 'invalid Folder state is preserved without repair')
  assert.notEqual(git.id, local.id)
}))

test('Git disconnect and shutdown cancel unsettled captures without losing remembered authority', async () => fixture(async ({ repo, options }) => {
  let signal: AbortSignal | undefined
  let finishCapture: ((value: unknown) => void) | undefined
  let announceCapture: (() => void) | undefined
  const captureStarted = new Promise<void>((resolve) => { announceCapture = resolve })
  const captureHeld = new Promise((resolve) => { finishCapture = resolve })
  const store = await openLocalConnectionStore({ ...options, capture: async (_root: unknown, context: { signal: AbortSignal }) => {
    signal = context.signal
    announceCapture?.()
    return captureHeld
  } })
  const remembered = await store.connect({ owner: ada, path: repo, remember: true })
  const pending = assert.rejects(store.snapshot(ada, remembered.id), LocalConnectionError)
  await captureStarted
  store.shutdown()
  assert.equal(signal?.aborted, true, 'shutdown synchronously revokes Git capture work')
  finishCapture?.({ name: 'repository', files: [] })
  await pending
  await assert.rejects(store.list(ada), LocalConnectionError, 'shutdown fences later Git metadata reads')
  assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [remembered], 'shutdown does not erase remembered Git authority')
}))

test('Git disconnect revokes a started capture before it can return and removes only its remembered grant', async () => fixture(async ({ repo, options }) => {
  let signal: AbortSignal | undefined
  let finishCapture: ((value: unknown) => void) | undefined
  let announceCapture: (() => void) | undefined
  const captureStarted = new Promise<void>((resolve) => { announceCapture = resolve })
  const captureHeld = new Promise((resolve) => { finishCapture = resolve })
  const store = await openLocalConnectionStore({ ...options, capture: async (_root: unknown, context: { signal: AbortSignal }) => {
    signal = context.signal
    announceCapture?.()
    return captureHeld
  } })
  const remembered = await store.connect({ owner: ada, path: repo, remember: true })
  const pending = assert.rejects(store.snapshot(ada, remembered.id), LocalConnectionError)
  await captureStarted
  await store.disconnect(ada, remembered.id)
  assert.equal(signal?.aborted, true, 'disconnect aborts capture work for that exact connection')
  finishCapture?.({ name: 'repository', files: [{ path: 'src/main.ts', sizeBytes: 1, snapshot: { text: 'x' } }] })
  await pending
  assert.deepEqual(await store.list(ada), [])
  assert.deepEqual(await (await openLocalConnectionStore(options)).list(ada), [], 'disconnect persists revocation across reopen')
}))
