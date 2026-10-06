import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { secureStorageAvailable } from './credentialVault.mjs'
import { inspectLocalFolderRoot, readLocalFolderSnapshot } from './localFolderReader.mjs'

export const LOCAL_CONNECTION_FILE = 'local-connections.v1.json'
export const LOCAL_GIT_CONNECTION_FILE = 'git-connections.v1.json'
export const MAX_LOCAL_CONNECTIONS = 64
export const MAX_LOCAL_CAPTURES = 4
const MAX_PLAINTEXT_BYTES = 256 * 1024
const MAX_FILE_BYTES = 512 * 1024
const ID = /^LOCAL_[A-F0-9]{32}$/
const REAL_FS = { lstat, open, rename, unlink }

/** No paths, decrypted state or OS exception causes cross this boundary. */
export class LocalConnectionError extends Error {
  constructor(code = 'unavailable') {
    super(code === 'busy' ? 'Local folder reads are busy. Try again when the current reads finish.' : code === 'limit-reached'
      ? 'This device has reached its local connection limit. Disconnect an unused connection first.'
      : 'The local connection is unavailable. Your saved snapshots have not been changed.')
    this.name = 'LocalConnectionError'
    this.code = code
  }
}
const fail = () => { throw new LocalConnectionError() }
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const printable = (value, max = 256) => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value) <= max && !/[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(value)
const validOwner = (value) => exactKeys(value, ['namespace', 'userId']) && printable(value.namespace) && printable(value.userId)
const sameOwner = (left, right) => left.namespace === right.namespace && left.userId === right.userId
const validRoot = (value) => exactKeys(value, ['path', 'identity']) && typeof value.path === 'string' &&
  Buffer.byteLength(value.path) <= 4096 && !value.path.includes('\0') && isAbsolute(value.path) && resolve(value.path) === value.path &&
  printable(basename(value.path)) && exactKeys(value.identity, ['dev', 'ino']) &&
  [value.identity.dev, value.identity.ino].every((number) => typeof number === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(number))
const descriptor = (entry) => ({ id: entry.id, name: basename(entry.root.path), remembered: entry.remembered })
const sameFile = (left, right) => ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every((key) => left[key] === right[key])

async function inspectPrivateDirectory(filePath, io) {
  const info = await io.lstat(dirname(filePath))
  if (!info.isDirectory() || info.isSymbolicLink() ||
    (process.platform !== 'win32' && ((info.mode & 0o777) !== 0o700 || info.uid !== process.geteuid()))) fail()
  return info
}

async function readEncryptedFile(filePath, io) {
  let file
  try { file = await io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)) }
  catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > MAX_FILE_BYTES ||
      (process.platform !== 'win32' && ((before.mode & 0o777) !== 0o600 || before.uid !== process.geteuid()))) fail()
    const bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== before.size || !sameFile(before, await file.stat())) fail()
    return bytes.subarray(0, offset).toString('utf8')
  } finally { await file.close() }
}

function parseConnections(plaintext, idPattern, validateRoot) {
  if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > MAX_PLAINTEXT_BYTES) fail()
  const parsed = JSON.parse(plaintext)
  if (!exactKeys(parsed, ['version', 'entries']) || parsed.version !== 1 ||
    !Array.isArray(parsed.entries) || parsed.entries.length > MAX_LOCAL_CONNECTIONS) fail()
  const result = new Map()
  for (const entry of parsed.entries) {
    if (!exactKeys(entry, ['id', 'owner', 'root']) || typeof entry.id !== 'string' || !idPattern.test(entry.id) ||
      !validOwner(entry.owner) || !validateRoot(entry.root) || result.has(entry.id)) fail()
    result.set(entry.id, { ...entry, remembered: true })
  }
  return result
}

function assertStorage(storage, platform) {
  if (!storage || !secureStorageAvailable({
    platform, encryptionAvailable: storage.isEncryptionAvailable(),
    linuxBackend: platform === 'linux' ? storage.getSelectedStorageBackend() : undefined,
  })) fail()
}

/** Native-only device-private storage used behind the main-process host. The
 * host derives owners from authenticated app identity and supplies only native
 * dialog paths; this store itself is never exposed through HTTP or renderer IPC.
 * The app's single-instance lock and admitted private profile are prerequisites.
 * Only explicit snapshot() reads content; list/reopen never probe selected roots.
 * shutdown() fences future work and cancels captures without rewriting grants.
 */
export async function openLocalConnectionStore({
  filePath, storage, platform = process.platform,
  inspectRoot = inspectLocalFolderRoot, capture = readLocalFolderSnapshot, review: reviewGit, fsApi = REAL_FS,
  connectionKind = 'folder', validateRoot = validRoot,
} = {}) {
  try {
    if (!['folder', 'git'].includes(connectionKind) || typeof validateRoot !== 'function') fail()
    const idPattern = connectionKind === 'git' ? /^GIT_[A-F0-9]{32}$/ : ID
    const idPrefix = connectionKind === 'git' ? 'GIT' : 'LOCAL'
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) fail()
    const directoryIdentity = await inspectPrivateDirectory(filePath, fsApi)
    let diskText = await readEncryptedFile(filePath, fsApi)
    let entries = new Map()
    if (diskText !== undefined) {
      assertStorage(storage, platform)
      const record = JSON.parse(diskText)
      if (!exactKeys(record, ['version', 'ciphertext']) || record.version !== 1 ||
        typeof record.ciphertext !== 'string' || !record.ciphertext ||
        Buffer.from(record.ciphertext, 'base64').toString('base64') !== record.ciphertext) fail()
      entries = parseConnections(await storage.decryptString(Buffer.from(record.ciphertext, 'base64')), idPattern, validateRoot)
    }
    let queue = Promise.resolve()
    let unavailable = false
    const captures = new Set()
    const shutdown = () => {
      unavailable = true
      for (const pending of captures) pending.controller.abort()
    }
    const available = () => { if (unavailable) fail() }
    const serial = (operation) => {
      const pending = queue.then(async () => { available(); return operation() }).catch((error) => {
        throw error instanceof LocalConnectionError ? error : new LocalConnectionError()
      })
      queue = pending.then(() => undefined, () => undefined)
      return pending
    }

    async function persist(next) {
      assertStorage(storage, platform)
      const remembered = [...next.values()].filter((entry) => entry.remembered)
        .map(({ id, owner, root }) => ({ id, owner, root }))
      const plaintext = JSON.stringify({ version: 1, entries: remembered })
      if (Buffer.byteLength(plaintext) > MAX_PLAINTEXT_BYTES) throw new LocalConnectionError('limit-reached')
      const encrypted = await storage.encryptString(plaintext)
      if (!(encrypted instanceof Uint8Array) || !encrypted.byteLength ||
        await storage.decryptString(encrypted) !== plaintext) fail()
      const text = `${JSON.stringify({ version: 1, ciphertext: Buffer.from(encrypted).toString('base64') })}\n`
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) fail()
      let before
      try {
        before = await inspectPrivateDirectory(filePath, fsApi)
        if (before.dev !== directoryIdentity.dev || before.ino !== directoryIdentity.ino ||
          await readEncryptedFile(filePath, fsApi) !== diskText) fail()
      } catch { shutdown(); fail() }
      const temporary = `${filePath}.${randomBytes(16).toString('hex')}.tmp`
      let file
      let published = false
      try {
        file = await fsApi.open(temporary, 'wx', 0o600)
        await file.writeFile(text, 'utf8')
        await file.sync()
        await file.close()
        const after = await inspectPrivateDirectory(filePath, fsApi)
        if (after.dev !== before.dev || after.ino !== before.ino) fail()
        await fsApi.rename(temporary, filePath)
        published = true
        if (process.platform !== 'win32') {
          const directory = await fsApi.open(dirname(filePath), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          try { await directory.sync() } finally { await directory.close() }
        }
        diskText = text
      } catch (error) {
        // If directory sync fails after rename, durability is uncertain. Never
        // publish memory-only success or overwrite that disk truth on a retry.
        if (published) shutdown()
        throw error
      } finally {
        await file?.close().catch(() => {})
        await fsApi.unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') { shutdown(); fail() } })
      }
    }

    async function read(owner, id, reader) {
      if (!validOwner(owner) || typeof id !== 'string' || !idPattern.test(id)) fail()
      const binding = { ...owner }
      const pending = await serial(() => {
        const found = entries.get(id)
        if (!found || !sameOwner(found.owner, binding)) fail()
        if (captures.size >= MAX_LOCAL_CAPTURES) throw new LocalConnectionError('busy')
        const pending = { entry: found, controller: new AbortController() }
        captures.add(pending)
        return pending
      })
      try {
        available()
        if (entries.get(id) !== pending.entry || pending.controller.signal.aborted) fail()
        const result = await reader(structuredClone(pending.entry.root), { signal: pending.controller.signal })
        // Reads stay outside the disk queue so disconnect can revoke them promptly.
        return await serial(() => {
          if (entries.get(id) !== pending.entry || pending.controller.signal.aborted) fail()
          return result
        })
      } catch { throw new LocalConnectionError() }
      finally { captures.delete(pending) }
    }

    return {
      connect({ owner, path, remember = false } = {}) {
        // Copy the binding before any asynchronous selection inspection.
        if (!validOwner(owner) || typeof remember !== 'boolean') return Promise.reject(new LocalConnectionError())
        const binding = { ...owner }
        return serial(async () => {
          if (entries.size >= MAX_LOCAL_CONNECTIONS) throw new LocalConnectionError('limit-reached')
          const root = await inspectRoot(path)
          // Root inspection can be slow (including on mounted volumes). Do not
          // publish a connection if shutdown began while it was in progress.
          available()
          if (!validateRoot(root)) fail()
          const entry = { id: `${idPrefix}_${randomBytes(16).toString('hex').toUpperCase()}`, owner: binding,
            root: structuredClone(root), remembered: remember }
          if (entries.has(entry.id)) fail()
          const next = new Map(entries).set(entry.id, entry)
          if (remember) await persist(next)
          entries = next
          return descriptor(entry)
        })
      },
      list(owner) {
        if (!validOwner(owner)) return Promise.reject(new LocalConnectionError())
        const binding = { ...owner }
        return serial(() => [...entries.values()].filter((entry) => sameOwner(entry.owner, binding)).map(descriptor))
      },
      snapshot(owner, id) {
        return read(owner, id, capture)
      },
      async review(owner, id) {
        if (connectionKind !== 'git' || typeof reviewGit !== 'function') fail()
        return read(owner, id, reviewGit)
      },
      disconnect(owner, id) {
        if (!validOwner(owner) || typeof id !== 'string' || !idPattern.test(id)) return Promise.reject(new LocalConnectionError())
        const binding = { ...owner }
        return serial(async () => {
          const entry = entries.get(id)
          // Unknown and foreign IDs have the same no-op response. A reference
          // never reveals another account's connection or grants read access.
          if (!entry || !sameOwner(entry.owner, binding)) return
          const next = new Map(entries)
          next.delete(id)
          if (entry.remembered) await persist(next)
          entries = next
          for (const pending of captures) if (pending.entry === entry) pending.controller.abort()
        })
      },
      // Permanently fences new work and aborts active captures. In-flight disk
      // commits are allowed to finish atomically; shutdown itself never mutates
      // remembered entries or discards authority.
      shutdown,
    }
  } catch { throw new LocalConnectionError() }
}
