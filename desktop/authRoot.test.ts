import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AUTH_ROOT_FILE, DesktopAuthRootError, loadDesktopAuthSecret } from './authRoot.mjs'

// An injected reversible stand-in, never shipped as an encryption provider.
const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (secret: string) => Buffer.from([...secret].reverse().join('')),
  decryptString: (bytes: Buffer) => [...bytes.toString()].reverse().join(''),
}

async function fixture(run: (directory: string, filePath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-auth-root-test-'))
  try { await run(directory, join(directory, AUTH_ROOT_FILE)) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('a device publishes one encrypted private root and reopens it without generating another', async () => fixture(async (directory, filePath) => {
  const first = await loadDesktopAuthSecret({ filePath, storage })
  assert.equal(Buffer.from(first, 'base64url').length, 32)
  const raw = await readFile(filePath, 'utf8')
  assert.ok(!raw.includes(first), 'the root must never be stored in plaintext')
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['ciphertext', 'version'])
  const second = await loadDesktopAuthSecret({ filePath, storage, random: () => { throw new Error('must not mint') } })
  assert.equal(second, first)
  assert.equal(await readFile(filePath, 'utf8'), raw, 'ordinary reopen is read-only apart from file permissions')
  assert.deepEqual(await readdir(directory), [AUTH_ROOT_FILE], 'no provisional file remains')
  if (process.platform !== 'win32') assert.equal((await stat(filePath)).mode & 0o777, 0o600)
  const other = await loadDesktopAuthSecret({ filePath: join(directory, 'other', AUTH_ROOT_FILE), storage })
  assert.notEqual(other, first, 'separate user-data directories never share an app root')
}))

test('concurrent first opens converge on the exclusively published root', async () => fixture(async (directory, filePath) => {
  const roots = await Promise.all(Array.from({ length: 8 }, () => loadDesktopAuthSecret({ filePath, storage })))
  assert.equal(new Set(roots).size, 1)
  assert.deepEqual(await readdir(directory), [AUTH_ROOT_FILE])
  assert.equal(await loadDesktopAuthSecret({ filePath, storage }), roots[0])
}))

test('unavailable or insecure OS storage never creates a fallback root', async () => fixture(async (directory, filePath) => {
  for (const overrides of [
    { isEncryptionAvailable: () => false },
    { getSelectedStorageBackend: () => 'basic_text' },
    { getSelectedStorageBackend: () => 'unknown' },
  ]) {
    await assert.rejects(loadDesktopAuthSecret({ filePath, platform: 'linux', storage: { ...storage, ...overrides } }), DesktopAuthRootError)
    assert.deepEqual(await readdir(directory), [])
  }
}))

test('existing corrupt, oversized, or undecryptable roots remain byte-for-byte unchanged', async () => fixture(async (_directory, filePath) => {
  for (const raw of [
    '', 'broken JSON', ' '.repeat(4097),
    JSON.stringify({ version: 2, ciphertext: 'YQ==' }),
    JSON.stringify({ version: 1, ciphertext: 'not base64' }),
    JSON.stringify({ version: 1, ciphertext: 'YQ==', extra: true }),
    JSON.stringify({ version: 1, ciphertext: 'YQ==' }),
  ]) {
    await writeFile(filePath, raw)
    await assert.rejects(loadDesktopAuthSecret({ filePath, storage }), DesktopAuthRootError)
    assert.equal(await readFile(filePath, 'utf8'), raw)
  }
  await rm(filePath)
  const original = await loadDesktopAuthSecret({ filePath, storage })
  const raw = await readFile(filePath, 'utf8')
  await assert.rejects(loadDesktopAuthSecret({
    filePath,
    storage: { ...storage, decryptString: () => { throw new Error(`OS failure containing ${original}`) } },
  }), (error: Error) => error instanceof DesktopAuthRootError && !error.message.includes(original) && !error.cause)
  assert.equal(await readFile(filePath, 'utf8'), raw)
  assert.equal(await loadDesktopAuthSecret({ filePath, storage }), original, 'unlocking later preserves the original identity')
}))

test('symlinks and encryption failures cannot publish or replace an authentication root', async () => fixture(async (directory, filePath) => {
  const target = join(directory, 'target')
  await writeFile(target, 'unrelated file')
  await symlink(target, filePath)
  await assert.rejects(loadDesktopAuthSecret({ filePath, storage }), DesktopAuthRootError)
  assert.equal(await readFile(target, 'utf8'), 'unrelated file')
  await rm(filePath)
  await assert.rejects(loadDesktopAuthSecret({ filePath, storage: { ...storage, encryptString: () => Buffer.from('wrong key') } }), DesktopAuthRootError)
  await assert.rejects(loadDesktopAuthSecret({ filePath, storage, random: () => Buffer.from('short') }), DesktopAuthRootError)
  assert.deepEqual(await readdir(directory), ['target'])
}))
