import { basename } from 'node:path'
import { LocalConnectionError } from './localConnectionStore.mjs'
import { parseLocalGitReview } from '../contract/localGitReview.mjs'
import { isFolderTreeFiles } from '../contract/localFolderTree.mjs'
import { isLocalGitFileSelection, parseLocalGitFileListing, parseLocalGitFilePreview } from '../contract/localGitBrowse.mjs'
import { parseLocalGitUntrackedFileRequest, parseLocalGitUntrackedFilesRequest,
  parseLocalGitUntrackedFileListing, parseLocalGitUntrackedFilePreview } from '../contract/localGitUntrackedBrowse.mjs'
import { isLocalFolderFileSelection, parseLocalFolderFileListing, parseLocalFolderFilePreview } from '../contract/localFolderBrowse.mjs'
import { parseLocalGitFileComparisonRequest, parseLocalGitFileComparisonCancel, parseLocalGitFileComparison } from '../contract/localGitFileComparison.mjs'

const ID = /^LOCAL_[A-F0-9]{32}$/
const fail = () => { throw new LocalConnectionError() }
const validText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(value)

function failureCode(error) {
  return error instanceof LocalConnectionError && ['busy', 'limit-reached'].includes(error.code)
    ? error.code : 'unavailable'
}

/** IPC transports a closed outcome, never an Error that Electron can decorate
 * with an internal channel or native exception details. The preload restores
 * the existing rejecting Promise API with fixed, path-free recovery guidance. */
export async function localConnectionReply(operation) {
  try { return { ok: true, value: await operation() } }
  catch (error) { return { ok: false, error: failureCode(error) } }
}

function sourceParts(source) {
  const identity = source?.identity
  if (!identity || typeof identity !== 'object' || !validText(identity.user?.id) || !validText(identity.tenant?.id)) fail()
  if (identity.via === 'session') {
    if (identity.local !== false || !['personal', 'org'].includes(identity.tenant.kind)) fail()
  } else if (identity.via === 'default') {
    if (identity.local !== true || identity.user.id !== 'user-local' || identity.tenant.id !== 'tenant-personal' ||
      identity.tenant.kind !== 'personal' || identity.role !== 'owner') fail()
  } else fail()
  if (!Number.isSafeInteger(source.cookieGeneration) || source.cookieGeneration < 0 || !validText(source.cookieFingerprint)) fail()
  return {
    owner: { namespace: identity.tenant.id, userId: identity.user.id },
    stamp: `${identity.via}:${identity.tenant.id}:${identity.user.id}:${source.cookieGeneration}:${source.cookieFingerprint}`,
  }
}

function assertExpectedSource(actual, expected) {
  const detached = expectedOwner(expected)
  if (detached.namespace !== actual.owner.namespace || detached.userId !== actual.owner.userId) fail()
}

function expectedOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
    Reflect.ownKeys(value).length !== 2 || Reflect.ownKeys(value).some((key) => !['namespace', 'userId'].includes(key))) fail()
  const namespace = Object.getOwnPropertyDescriptor(value, 'namespace')
  const userId = Object.getOwnPropertyDescriptor(value, 'userId')
  if (!namespace?.enumerable || !Object.hasOwn(namespace, 'value') || !validText(namespace.value) ||
    !userId?.enumerable || !Object.hasOwn(userId, 'value') || !validText(userId.value)) fail()
  return { namespace: namespace.value, userId: userId.value }
}

function safeSnapshot(value, connectionKind) {
  if (!value || typeof value.name !== 'string' || !Array.isArray(value.files)) fail()
  return {
    name: value.name,
    files: value.files.map((file) => {
      const key = connectionKind === 'git' ? 'path' : 'name'
      if (!file || typeof file[key] !== 'string' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) fail()
      if (file.snapshot?.text !== undefined && typeof file.snapshot.text !== 'string') fail()
      if (file.snapshot?.omitted !== undefined && !['unsupported', 'too-large', 'budget', 'unreadable'].includes(file.snapshot.omitted)) fail()
      return {
        [key]: file[key],
        sizeBytes: file.sizeBytes,
        snapshot: file.snapshot?.text !== undefined ? { text: file.snapshot.text } : { omitted: file.snapshot?.omitted ?? 'unsupported' },
      }
    }),
  }
}

function safeFolderTreeSnapshot(value) {
  if (!value || typeof value.name !== 'string' || !value.name || Buffer.byteLength(value.name) > 256 ||
    Buffer.from(value.name, 'utf8').toString('utf8') !== value.name ||
    /[\\/\x00-\x1f\x7f-\x9f]/u.test(value.name) || basename(value.name) !== value.name ||
    !Array.isArray(value.files) || !isFolderTreeFiles(value.files)) fail()
  return safeSnapshot(value, 'folder')
}

/** Main-process facade: renderer arguments can name a connection, never its owner or path. */
export function createLocalConnectionHost({ store, assertCaller, resolveSource, showFolderDialog, isClosing = () => false, connectionKind = 'folder' }) {
  if (!store || typeof assertCaller !== 'function' || typeof resolveSource !== 'function' || typeof showFolderDialog !== 'function') {
    throw new Error('The native local-folder host is not configured.')
  }
  if (!['folder', 'git'].includes(connectionKind)) throw new Error('Invalid native connection kind.')
  const idPattern = connectionKind === 'git' ? /^GIT_[A-F0-9]{32}$/ : ID
  const untrackedOperations = new Map()
  const comparisonOperations = new Map()
  const validOperationId = (value) => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

  const source = async () => {
    if (isClosing()) fail()
    return sourceParts(await resolveSource())
  }
  const unchanged = async (expected) => {
    const current = await source()
    if (current.stamp !== expected.stamp || current.owner.namespace !== expected.owner.namespace || current.owner.userId !== expected.owner.userId) fail()
  }
  const invoke = async (event, operation) => {
    try {
      assertCaller(event)
      return await operation()
    } catch (error) { throw new LocalConnectionError(failureCode(error)) }
  }

  return Object.freeze({
    list(event, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const result = await store.list(before.owner)
        await unchanged(before)
        return result.map(({ id, name, remembered }) => ({ id, name, remembered }))
      })
    },
    connect(event, input, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length) fail()
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'remember' || typeof input.remember !== 'boolean') fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const selection = await showFolderDialog()
        await unchanged(before)
        if (selection?.canceled) return { status: 'cancelled' }
        if (!Array.isArray(selection?.filePaths) || selection.filePaths.length !== 1 || typeof selection.filePaths[0] !== 'string') fail()
        const connection = await store.connect({ owner: before.owner, path: selection.filePaths[0], remember: input.remember })
        try { await unchanged(before) }
        catch {
          await store.disconnect(before.owner, connection.id).catch(() => {})
          fail()
        }
        return { status: 'connected', connection: { id: connection.id, name: connection.name, remembered: connection.remembered } }
      })
    },
    snapshot(event, id, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length) fail()
        if (typeof id !== 'string' || !idPattern.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const value = await store.snapshot(before.owner, id)
        await unchanged(before)
        return safeSnapshot(value, connectionKind)
      })
    },
    snapshotTree(event, id, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length || connectionKind !== 'folder') fail()
        if (typeof id !== 'string' || !ID.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const value = await store.snapshotTree(before.owner, id)
        await unchanged(before)
        return safeFolderTreeSnapshot(value)
      })
    },
    review(event, id, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length || connectionKind !== 'git') fail()
        if (typeof id !== 'string' || !/^GIT_[A-F0-9]{32}$/.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const value = await store.review(before.owner, id)
        await unchanged(before)
        const parsed = parseLocalGitReview(value)
        if (!parsed) fail()
        return parsed
      })
    },
    fileComparison(event, id, request, expectedSource, ...extra) {
      return invoke(event, async () => {
        const detached = parseLocalGitFileComparisonRequest(request)
        if (extra.length || connectionKind !== 'git' || !detached ||
          typeof id !== 'string' || !idPattern.test(id) || comparisonOperations.has(detached.operationId)) fail()
        // Reserve before the first identity lookup: cancellation while that
        // lookup waits must prevent later dispatch, not just hide its reply.
        const binding = { sender: event.sender, owner: expectedOwner(expectedSource), id, cancelled: false, started: false }
        comparisonOperations.set(detached.operationId, binding)
        try {
          const before = await source()
          assertExpectedSource(before, binding.owner)
          if (binding.cancelled) fail()
          binding.started = true
          const value = await store.fileComparison(before.owner, id, detached)
          await unchanged(before)
          if (binding.cancelled) fail()
          const parsed = parseLocalGitFileComparison(value)
          if (!parsed || parsed.path !== detached.path || parsed.comparison !== detached.comparison) fail()
          return parsed
        } finally {
          if (comparisonOperations.get(detached.operationId) === binding) comparisonOperations.delete(detached.operationId)
        }
      })
    },
    cancelFileComparison(event, id, request, expectedSource, ...extra) {
      return invoke(event, async () => {
        const detached = parseLocalGitFileComparisonCancel(request)
        if (extra.length || connectionKind !== 'git' || !detached || typeof id !== 'string' || !idPattern.test(id)) fail()
        const owner = expectedOwner(expectedSource)
        const active = comparisonOperations.get(detached.operationId)
        if (!active || active.sender !== event.sender || active.id !== id ||
          active.owner.namespace !== owner.namespace || active.owner.userId !== owner.userId) return false
        // The captured operation may be cancelled after account/cookie change.
        // Keep its publication fence even if its native read already settled.
        active.cancelled = true
        if (active.started) await store.cancelFileComparison(owner, id, detached.operationId)
        return true
      })
    },
    files(event, id, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length) fail()
        if (typeof id !== 'string' || !idPattern.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const value = await store.files(before.owner, id)
        await unchanged(before)
        const parsed = connectionKind === 'git' ? parseLocalGitFileListing(value) : parseLocalFolderFileListing(value)
        if (!parsed) fail()
        return parsed
      })
    },
    file(event, id, selection, expectedSource, ...extra) {
      return invoke(event, async () => {
        // Reject mutable, accessor-bearing, or malformed selections before
        // source lookup and before the store can wait for read admission.
        const isGit = connectionKind === 'git'
        if (extra.length || (isGit ? !isLocalGitFileSelection(selection) : !isLocalFolderFileSelection(selection))) fail()
        if (typeof id !== 'string' || !idPattern.test(id)) fail()
        const detached = { path: selection.path }
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const value = await store.file(before.owner, id, detached)
        await unchanged(before)
        const parsed = isGit ? parseLocalGitFilePreview(value) : parseLocalFolderFilePreview(value)
        if (!parsed || parsed.path !== detached.path) fail()
        return parsed
      })
    },
    untrackedFiles(event, id, request, expectedSource, ...extra) {
      return invoke(event, async () => {
        const detached = parseLocalGitUntrackedFilesRequest(request)
        if (extra.length || connectionKind !== 'git' || !detached || !validOperationId(detached.operationId) ||
          typeof id !== 'string' || !/^GIT_[A-F0-9]{32}$/.test(id) || untrackedOperations.has(detached.operationId)) fail()
        const binding = { sender: event.sender, stamp: null, owner: expectedOwner(expectedSource), id, cancelled: false, started: false }
        untrackedOperations.set(detached.operationId, binding)
        try {
          const before = await source()
          assertExpectedSource(before, binding.owner)
          if (binding.cancelled) fail()
          binding.stamp = before.stamp
          binding.owner = before.owner
          binding.started = true
          const value = await store.untrackedFiles(before.owner, id, detached)
          await unchanged(before)
          const parsed = parseLocalGitUntrackedFileListing(value)
          if (!parsed) fail()
          return parsed
        } finally { if (untrackedOperations.get(detached.operationId) === binding) untrackedOperations.delete(detached.operationId) }
      })
    },
    untrackedFile(event, id, request, expectedSource, ...extra) {
      return invoke(event, async () => {
        const detached = parseLocalGitUntrackedFileRequest(request)
        if (extra.length || connectionKind !== 'git' || !detached || !validOperationId(detached.operationId) ||
          typeof id !== 'string' || !/^GIT_[A-F0-9]{32}$/.test(id) || untrackedOperations.has(detached.operationId)) fail()
        const binding = { sender: event.sender, stamp: null, owner: expectedOwner(expectedSource), id, cancelled: false, started: false }
        untrackedOperations.set(detached.operationId, binding)
        try {
          const before = await source()
          assertExpectedSource(before, binding.owner)
          if (binding.cancelled) fail()
          binding.stamp = before.stamp
          binding.owner = before.owner
          binding.started = true
          const value = await store.untrackedFile(before.owner, id, detached)
          await unchanged(before)
          const parsed = parseLocalGitUntrackedFilePreview(value)
          if (!parsed || parsed.path !== detached.path) fail()
          return parsed
        } finally { if (untrackedOperations.get(detached.operationId) === binding) untrackedOperations.delete(detached.operationId) }
      })
    },
    cancelUntrackedRead(event, id, request, expectedSource, ...extra) {
      return invoke(event, async () => {
        const detached = parseLocalGitUntrackedFilesRequest(request)
        if (extra.length || connectionKind !== 'git' || !detached || !validOperationId(detached.operationId) ||
          typeof id !== 'string' || !/^GIT_[A-F0-9]{32}$/.test(id)) fail()
        const owner = expectedOwner(expectedSource)
        const active = untrackedOperations.get(detached.operationId)
        if (!active || active.sender !== event.sender || active.id !== id ||
          active.owner.namespace !== owner.namespace || active.owner.userId !== owner.userId) return false
        if (active.stamp === null) { active.cancelled = true; return true }
        if (!active.started) { active.cancelled = true; return true }
        // Cancellation cannot disclose source data, and must remain usable
        // after account/cookie transitions so an exact captured operation
        // releases its shared read capacity promptly.
        return await store.cancelUntrackedRead(owner, id, detached.operationId) === true
      })
    },
    disconnect(event, id, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length) fail()
        if (typeof id !== 'string' || !idPattern.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        await store.disconnect(before.owner, id)
        await unchanged(before)
      })
    },
  })
}
