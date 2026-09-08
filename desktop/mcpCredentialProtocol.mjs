/** Narrow supervised-child credential handoff for external MCP connections.
 * Secrets cross only this local process channel on demand; no environment
 * variable, renderer API, or product snapshot is involved. */

export const MCP_CREDENTIAL_RESOLVE = 'agent-commons:mcp-credential:resolve'
export const MCP_CREDENTIAL_RESULT = 'agent-commons:mcp-credential:result'
export const MCP_CREDENTIAL_BINDINGS = 'agent-commons:mcp-credential:bindings'
export const MCP_CREDENTIAL_SYNC = 'agent-commons:mcp-credential:sync'
export const MCP_CREDENTIAL_SYNC_RESULT = 'agent-commons:mcp-credential:sync-result'
export const MCP_CREDENTIAL_MAX_PENDING = 64
export const MCP_CREDENTIAL_MAX_BINDINGS = 4_096
export const MCP_CREDENTIAL_MAX_ID_CHARS = 256
export const MCP_CREDENTIAL_MAX_ENDPOINT_CHARS = 2_048
export const MCP_CREDENTIAL_MAX_SECRET_CHARS = 8_192

const REFERENCE_PATTERN = /^MCP_DESKTOP_[A-F0-9]{32}$/
const SYNC_FAILURE = Symbol('mcp-credential-sync-failure')
const printable = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)

export function isMcpCredentialReference(value) {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value)
}

export function isMcpBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 3 || !keys.every((key) => key === 'tenantId' || key === 'connectionId' || key === 'endpoint')) return false
  const { tenantId, connectionId, endpoint } = value
  if (!printable(tenantId, MCP_CREDENTIAL_MAX_ID_CHARS) || !printable(connectionId, MCP_CREDENTIAL_MAX_ID_CHARS)) return false
  if (!printable(endpoint, MCP_CREDENTIAL_MAX_ENDPOINT_CHARS) || endpoint.includes('#')) return false
  let parsed
  try { parsed = new URL(endpoint) } catch { return false }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.username === '' && parsed.password === '' && parsed.hash === '' && parsed.href === endpoint
}

export function isMcpCredentialSecret(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MCP_CREDENTIAL_MAX_SECRET_CHARS && /^[\x21-\x7e]+$/.test(value)
}

function safeBinding(value) {
  return isMcpBinding(value) ? {
    tenantId: value.tenantId,
    connectionId: value.connectionId,
    endpoint: value.endpoint,
  } : undefined
}

function safeAnnouncement(bindings) {
  if (!Array.isArray(bindings) || bindings.length > MCP_CREDENTIAL_MAX_BINDINGS) return undefined
  const references = new Set()
  const bindingKeys = new Set()
  const safe = []
  for (const entry of bindings) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, 'reference') || !Object.hasOwn(entry, 'binding') || !isMcpCredentialReference(entry.reference)) return undefined
    const binding = safeBinding(entry.binding)
    if (!binding) return undefined
    const bindingKey = `${binding.tenantId}\u0000${binding.connectionId}\u0000${binding.endpoint}`
    if (references.has(entry.reference) || bindingKeys.has(bindingKey)) return undefined
    references.add(entry.reference)
    bindingKeys.add(bindingKey)
    safe.push({ reference: entry.reference, binding })
  }
  return safe
}

function timeoutValue(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 60_000 ? value : 5_000
}

function pendingLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MCP_CREDENTIAL_MAX_BINDINGS ? value : MCP_CREDENTIAL_MAX_PENDING
}

function genericError(message) {
  return new Error(message)
}

/** Utility/backend half. `parentPort` accepts either MessagePort event objects
 * (`{data: message}`) or direct EventEmitter messages in tests. */
export function installMcpCredentialRuntime(parentPort = globalThis.process?.parentPort, { timeoutMs = 5_000, maxPending = MCP_CREDENTIAL_MAX_PENDING } = {}) {
  if (!parentPort) return null
  const deadline = timeoutValue(timeoutMs)
  const limit = pendingLimit(maxPending)
  let sequence = 0
  let closed = false
  const pending = new Map()
  const pendingSync = new Map()
  const messageOf = (event) => event && typeof event === 'object' && Object.hasOwn(event, 'data') ? event.data : event
  const send = (message) => {
    try { parentPort.postMessage(message); return true } catch { return false }
  }
  const onMessage = (event) => {
    const message = messageOf(event)
    if (message?.type === MCP_CREDENTIAL_SYNC_RESULT && Number.isSafeInteger(message.requestId) && message.requestId > 0) {
      const entry = pendingSync.get(message.requestId)
      if (!entry) return
      pendingSync.delete(message.requestId)
      clearTimeout(entry.timer)
      if (Object.hasOwn(message, 'error')) {
        if (message.error === 'failed') entry.reject(genericError('The MCP credential synchronization failed.'))
        else entry.reject(genericError('The MCP credential synchronization response is invalid.'))
      } else if (typeof message.available === 'boolean') entry.resolve({ available: message.available })
      else entry.reject(genericError('The MCP credential synchronization response is invalid.'))
      return
    }
    if (!message || message.type !== MCP_CREDENTIAL_RESULT || !Number.isSafeInteger(message.requestId) || message.requestId < 1) return
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)
    clearTimeout(entry.timer)
    if (message.ok === true && isMcpCredentialSecret(message.secret)) entry.resolve(message.secret)
    else entry.reject(genericError('The MCP credential is unavailable.'))
  }
  parentPort.on('message', onMessage)

  const close = () => {
    if (closed) return
    closed = true
    parentPort.off?.('message', onMessage)
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(genericError('The MCP credential channel is unavailable.'))
    }
    pending.clear()
    for (const entry of pendingSync.values()) {
      clearTimeout(entry.timer)
      entry.reject(genericError('The MCP credential channel is unavailable.'))
    }
    pendingSync.clear()
  }
  const resolve = (reference, binding) => {
    if (closed) return Promise.reject(genericError('The MCP credential channel is unavailable.'))
    if (!isMcpCredentialReference(reference) || !isMcpBinding(binding)) {
      return Promise.reject(genericError('The MCP credential request is invalid.'))
    }
    if (pending.size >= limit) return Promise.reject(genericError('The MCP credential channel is busy.'))
    const requestId = (sequence += 1)
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(genericError('The MCP credential request timed out.'))
      }, deadline)
      pending.set(requestId, { resolve: resolvePromise, reject, timer })
      if (!send({ type: MCP_CREDENTIAL_RESOLVE, requestId, reference, binding: safeBinding(binding) })) {
        pending.delete(requestId)
        clearTimeout(timer)
        reject(genericError('The MCP credential channel is unavailable.'))
      }
    })
  }
  const announceBindings = (bindings) => {
    if (closed) return
    const safe = safeAnnouncement(bindings)
    if (safe) send({ type: MCP_CREDENTIAL_BINDINGS, bindings: safe })
  }
  let syncChain = Promise.resolve()
  let syncPendingCount = 0
  const synchronizeBindings = (bindings) => {
    const safe = safeAnnouncement(bindings)
    if (!safe) return Promise.reject(genericError('The MCP credential bindings snapshot is invalid.'))
    if (syncPendingCount >= limit) return Promise.reject(genericError('The MCP credential channel is busy.'))
    syncPendingCount += 1
    const operation = syncChain.then(() => {
      if (closed) throw genericError('The MCP credential channel is unavailable.')
      const requestId = (sequence += 1)
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          pendingSync.delete(requestId)
          reject(genericError('The MCP credential synchronization timed out.'))
        }, deadline)
        pendingSync.set(requestId, { resolve: resolvePromise, reject, timer })
        if (!send({ type: MCP_CREDENTIAL_SYNC, requestId, bindings: safe })) {
          pendingSync.delete(requestId)
          clearTimeout(timer)
          reject(genericError('The MCP credential channel is unavailable.'))
        }
      })
    }).finally(() => { syncPendingCount -= 1 })
    syncChain = operation.then(() => undefined, () => undefined)
    return operation
  }
  return { resolve, announceBindings, synchronizeBindings, close }
}

/** Main/host half. `resolve` is the host-only vault reader and receives the
 * exact validated reference plus binding; it is never exposed to the child. */
export function createMcpCredentialHost(child, { resolve, onBindings = () => {}, onSynchronizeBindings = async () => false,
  timeoutMs = 5_000, maxPending = MCP_CREDENTIAL_MAX_PENDING } = {}) {
  if (!child || typeof resolve !== 'function') throw new Error('The MCP credential host is unavailable.')
  const deadline = timeoutValue(timeoutMs)
  const limit = pendingLimit(maxPending)
  let closed = false
  const active = new Map()
  let syncChain = Promise.resolve()
  let syncQueued = 0
  const send = (message) => {
    try { child.postMessage(message); return true } catch { return false }
  }
  const onMessage = (message) => {
    if (closed || !message || typeof message !== 'object') return
    if (message.type === MCP_CREDENTIAL_SYNC) {
      const safe = Number.isSafeInteger(message.requestId) && message.requestId > 0 ? safeAnnouncement(message.bindings) : undefined
      if (!safe || syncQueued >= limit) {
        if (Number.isSafeInteger(message.requestId) && message.requestId > 0) {
          send({ type: MCP_CREDENTIAL_SYNC_RESULT, requestId: message.requestId, error: 'failed' })
        }
        return
      }
      syncQueued += 1
      const apply = syncChain.then(async () => {
        syncQueued -= 1
        if (closed) return false
        let timer
        try {
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(genericError('The MCP credential synchronization timed out.')), deadline)
          })
          const result = await Promise.race([Promise.resolve().then(() => onSynchronizeBindings(safe)), timeout])
          if (result === true || (result && typeof result === 'object' && result.available === true)) return true
          if (result === false || (result && typeof result === 'object' && result.available === false)) return false
          return SYNC_FAILURE
        } catch {
          return SYNC_FAILURE
        } finally {
          clearTimeout(timer)
        }
      })
      syncChain = apply.then(() => undefined, () => undefined)
      void apply.then((result) => {
        if (closed) return
        if (result === SYNC_FAILURE) send({ type: MCP_CREDENTIAL_SYNC_RESULT, requestId: message.requestId, error: 'failed' })
        else send({ type: MCP_CREDENTIAL_SYNC_RESULT, requestId: message.requestId, available: result === true })
      })
      return
    }
    if (message.type === MCP_CREDENTIAL_BINDINGS) {
      const safe = safeAnnouncement(message.bindings)
      if (safe) {
        try {
          const result = onBindings(safe)
          if (result && typeof result.then === 'function') result.catch(() => {})
        } catch { /* callbacks cannot affect the channel */ }
      }
      return
    }
    if (message.type !== MCP_CREDENTIAL_RESOLVE || !Number.isSafeInteger(message.requestId) || message.requestId < 1 || active.has(message.requestId)) return
    if (active.size >= limit || !isMcpCredentialReference(message.reference) || !isMcpBinding(message.binding)) {
      send({ type: MCP_CREDENTIAL_RESULT, requestId: message.requestId, ok: false, error: 'unavailable' })
      return
    }
    const requestId = message.requestId
    const entryToken = {}
    const entry = { token: entryToken, timer: undefined }
    entry.timer = setTimeout(() => {
      const activeEntry = active.get(requestId)
      if (!activeEntry || activeEntry.token !== entryToken || closed) return
      active.delete(requestId)
      send({ type: MCP_CREDENTIAL_RESULT, requestId, ok: false, error: 'unavailable' })
    }, deadline)
    active.set(requestId, entry)
    const reference = message.reference
    const binding = safeBinding(message.binding)
    Promise.resolve().then(() => resolve(reference, binding)).then((secret) => {
      const activeEntry = active.get(requestId)
      if (!activeEntry || activeEntry.token !== entryToken || closed) return
      clearTimeout(activeEntry.timer)
      active.delete(requestId)
      if (isMcpCredentialSecret(secret)) send({ type: MCP_CREDENTIAL_RESULT, requestId, ok: true, secret })
      else send({ type: MCP_CREDENTIAL_RESULT, requestId, ok: false, error: 'unavailable' })
    }).catch(() => {
      const activeEntry = active.get(requestId)
      if (!activeEntry || activeEntry.token !== entryToken || closed) return
      clearTimeout(activeEntry.timer)
      active.delete(requestId)
      send({ type: MCP_CREDENTIAL_RESULT, requestId, ok: false, error: 'unavailable' })
    })
  }
  child.on('message', onMessage)
  return {
    close() {
      if (closed) return
      closed = true
      child.off?.('message', onMessage)
      for (const entry of active.values()) clearTimeout(entry.timer)
      active.clear()
    },
  }
}
