import { randomBytes } from 'node:crypto'
import { basename, isAbsolute, resolve } from 'node:path'
import { secureStorageAvailable } from './credentialVault.mjs'
import { inspectLocalFolderRoot, readLocalFolderSnapshot } from './localFolderReader.mjs'
import { openPrivateTextFile } from './privateTextFile.mjs'
import { isLocalGitFileSelection, parseLocalGitFileListing, parseLocalGitFilePreview } from '../contract/localGitBrowse.mjs'
import { parseLocalGitUntrackedFileRequest, parseLocalGitUntrackedFilesRequest,
  parseLocalGitUntrackedFileListing, parseLocalGitUntrackedFilePreview } from '../contract/localGitUntrackedBrowse.mjs'
import { isLocalFolderFileSelection, parseLocalFolderFileListing, parseLocalFolderFilePreview } from '../contract/localFolderBrowse.mjs'

export const LOCAL_CONNECTION_FILE = 'local-connections.v1.json'
export const LOCAL_GIT_CONNECTION_FILE = 'git-connections.v1.json'
export const MAX_LOCAL_CONNECTIONS = 64
export const MAX_LOCAL_CAPTURES = 4
const MAX_PLAINTEXT_BYTES = 256 * 1024
const MAX_FILE_BYTES = 512 * 1024
const ID = /^LOCAL_[A-F0-9]{32}$/

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
 * Only explicit snapshot methods read content; list/reopen never probe selected roots.
 * shutdown() fences future work and cancels captures without rewriting grants.
 */
export async function openLocalConnectionStore({
  filePath, storage, platform = process.platform,
  inspectRoot = inspectLocalFolderRoot, capture = readLocalFolderSnapshot, captureTree, review: reviewGit,
  browse: browseGit, preview: previewGit, browseFiles: browseFolder, previewFile: previewFolder, fsApi,
  browseUntracked: browseUntrackedGit, previewUntracked: previewUntrackedGit,
  connectionKind = 'folder', validateRoot = validRoot,
} = {}) {
  try {
    if (!['folder', 'git'].includes(connectionKind) || typeof validateRoot !== 'function') fail()
    const idPattern = connectionKind === 'git' ? /^GIT_[A-F0-9]{32}$/ : ID
    const idPrefix = connectionKind === 'git' ? 'GIT' : 'LOCAL'
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) fail()
    const privateFile = await openPrivateTextFile({ filePath, maxBytes: MAX_FILE_BYTES, fsApi })
    const diskText = privateFile.text
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
    const untrackedOperations = new Map()
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
      try {
        await privateFile.replace(text, { beforePublish: () => !unavailable })
      } catch (error) {
        if (privateFile.unavailable) shutdown()
        throw error
      }
    }

    async function read(owner, id, reader, operationId) {
      if (!validOwner(owner) || typeof id !== 'string' || !idPattern.test(id)) fail()
      if (operationId !== undefined && (connectionKind !== 'git' || typeof operationId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId))) fail()
      const binding = { ...owner }
      if (operationId && untrackedOperations.has(operationId)) fail()
      const pending = { entry: null, controller: new AbortController() }
      if (operationId) untrackedOperations.set(operationId, { pending, owner: binding, id })
      try {
        await serial(() => {
          const found = entries.get(id)
          if (!found || !sameOwner(found.owner, binding) || pending.controller.signal.aborted) fail()
          if (captures.size >= MAX_LOCAL_CAPTURES) throw new LocalConnectionError('busy')
          pending.entry = found
          captures.add(pending)
        })
      } catch (error) {
        captures.delete(pending)
        if (operationId && untrackedOperations.get(operationId)?.pending === pending) untrackedOperations.delete(operationId)
        if (error instanceof LocalConnectionError) throw error
        throw new LocalConnectionError()
      }
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
      finally {
        captures.delete(pending)
        if (operationId && untrackedOperations.get(operationId)?.pending === pending) untrackedOperations.delete(operationId)
      }
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
      async snapshotTree(owner, id) {
        if (connectionKind !== 'folder' || typeof captureTree !== 'function') fail()
        return read(owner, id, captureTree)
      },
      async review(owner, id) {
        if (connectionKind !== 'git' || typeof reviewGit !== 'function') fail()
        return read(owner, id, reviewGit)
      },
      async files(owner, id) {
        if (connectionKind === 'git') {
          if (typeof browseGit !== 'function') fail()
          return read(owner, id, async (root, context) => {
            const result = await browseGit(root, context)
            const parsed = parseLocalGitFileListing(result)
            if (!parsed) fail()
            return parsed
          })
        }
        if (typeof browseFolder !== 'function') fail()
        return read(owner, id, async (root, context) => {
          const result = await browseFolder(root, context)
          const parsed = parseLocalFolderFileListing(result)
          if (!parsed) fail()
          return parsed
        })
      },
      async file(owner, id, selection) {
        // Freeze a validated detached selection before it can wait for the
        // serial admission queue or compete for a read slot.
        const isGit = connectionKind === 'git'
        if ((isGit ? typeof previewGit !== 'function' || !isLocalGitFileSelection(selection)
          : typeof previewFolder !== 'function' || !isLocalFolderFileSelection(selection))) fail()
        const detached = { path: selection.path }
        return read(owner, id, async (root, context) => {
          const result = isGit
            ? await previewGit(root, { ...context, selection: detached })
            : await previewFolder(root, detached, context)
          const parsed = isGit ? parseLocalGitFilePreview(result) : parseLocalFolderFilePreview(result)
          if (!parsed || parsed.path !== detached.path) fail()
          return parsed
        })
      },
      async untrackedFiles(owner, id, request) {
        const detached = parseLocalGitUntrackedFilesRequest(request)
        if (connectionKind !== 'git' || typeof browseUntrackedGit !== 'function' || !detached) fail()
        return read(owner, id, async (root, context) => {
          const result = await browseUntrackedGit(root, context)
          const detachedResult = parseLocalGitFileListing(result)
          const parsed = detachedResult && parseLocalGitUntrackedFileListing({ scope: 'untracked', ...detachedResult })
          if (!parsed) fail()
          return parsed
        }, detached.operationId)
      },
      async untrackedFile(owner, id, request) {
        const detached = parseLocalGitUntrackedFileRequest(request)
        if (connectionKind !== 'git' || typeof previewUntrackedGit !== 'function' || !detached) fail()
        const selection = { path: detached.path }
        return read(owner, id, async (root, context) => {
          const result = await previewUntrackedGit(root, { ...context, selection })
          const detachedResult = parseLocalGitFilePreview(result)
          const parsed = detachedResult && parseLocalGitUntrackedFilePreview({ scope: 'untracked', ...detachedResult })
          if (!parsed || parsed.path !== selection.path) fail()
          return parsed
        }, detached.operationId)
      },
      cancelUntrackedRead(owner, id, operationId) {
        if (!validOwner(owner) || typeof id !== 'string' || !/^GIT_[A-F0-9]{32}$/.test(id) ||
          typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
          return Promise.reject(new LocalConnectionError())
        }
        const active = untrackedOperations.get(operationId)
        if (!active || active.id !== id || !sameOwner(active.owner, owner)) return Promise.resolve(false)
        active.pending.controller.abort()
        return Promise.resolve(true)
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
