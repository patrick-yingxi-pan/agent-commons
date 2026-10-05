import { LocalConnectionError } from './localConnectionStore.mjs'

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
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
    Object.keys(expected).sort().join(',') !== 'namespace,userId' ||
    expected.namespace !== actual.owner.namespace || expected.userId !== actual.owner.userId) fail()
}

function safeSnapshot(value) {
  if (!value || typeof value.name !== 'string' || !Array.isArray(value.files)) fail()
  return {
    name: value.name,
    files: value.files.map((file) => {
      if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) fail()
      if (file.snapshot?.text !== undefined && typeof file.snapshot.text !== 'string') fail()
      if (file.snapshot?.omitted !== undefined && !['unsupported', 'too-large', 'budget', 'unreadable'].includes(file.snapshot.omitted)) fail()
      return {
        name: file.name,
        sizeBytes: file.sizeBytes,
        snapshot: file.snapshot?.text !== undefined ? { text: file.snapshot.text } : { omitted: file.snapshot?.omitted ?? 'unsupported' },
      }
    }),
  }
}

/** Main-process facade: renderer arguments can name a connection, never its owner or path. */
export function createLocalConnectionHost({ store, assertCaller, resolveSource, showFolderDialog, isClosing = () => false }) {
  if (!store || typeof assertCaller !== 'function' || typeof resolveSource !== 'function' || typeof showFolderDialog !== 'function') {
    throw new Error('The native local-folder host is not configured.')
  }

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
        if (typeof id !== 'string' || !ID.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        const value = await store.snapshot(before.owner, id)
        await unchanged(before)
        return safeSnapshot(value)
      })
    },
    disconnect(event, id, expectedSource, ...extra) {
      return invoke(event, async () => {
        if (extra.length) fail()
        if (typeof id !== 'string' || !ID.test(id)) fail()
        const before = await source()
        assertExpectedSource(before, expectedSource)
        await store.disconnect(before.owner, id)
        await unchanged(before)
      })
    },
  })
}
