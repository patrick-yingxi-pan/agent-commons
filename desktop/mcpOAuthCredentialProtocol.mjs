/** Narrow child/main OAuth resolution channel. Unlike the bearer resolver,
 * this carries person + revision fences and never accepts caller functions. */
import { isMcpCredentialReference, isMcpCredentialSecret } from './mcpCredentialProtocol.mjs'
import { parseOutboundEndpoint } from '../server/outboundAddressCore.mjs'

export const MCP_OAUTH_CREDENTIAL_RESOLVE = 'agent-commons:mcp-oauth-credential:resolve'
export const MCP_OAUTH_CREDENTIAL_RESULT = 'agent-commons:mcp-oauth-credential:result'
export const MCP_OAUTH_CREDENTIAL_CANCEL = 'agent-commons:mcp-oauth-credential:cancel'

const generic = message => new Error(message)
const timeoutValue = value => Number.isSafeInteger(value) && value >= 1 && value <= 60_000 ? value : 30_000
const pendingValue = value => Number.isSafeInteger(value) && value >= 1 && value <= 64 ? value : 8

function ownRecord(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  try {
    if (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) return undefined
    const ownKeys = Reflect.ownKeys(raw)
    if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(raw)
    const copy = Object.create(null)
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
      copy[key] = descriptor.value
    }
    return copy
  } catch { return undefined }
}

function snapshotBinding(raw) {
  const value = ownRecord(raw, ['tenantId', 'connectionId', 'endpoint', 'ownerUserId', 'connectionRevision'])
  if (!value || typeof value.tenantId !== 'string' || value.tenantId.length < 1 || value.tenantId.length > 256 ||
      !/^[\x20-\x7e]+$/.test(value.tenantId) || typeof value.connectionId !== 'string' ||
      value.connectionId.length < 1 || value.connectionId.length > 256 || !/^[\x20-\x7e]+$/.test(value.connectionId) ||
      typeof value.ownerUserId !== 'string' || value.ownerUserId.trim().length === 0 || value.ownerUserId.length > 200 ||
      !/^[\x20-\x7e]+$/.test(value.ownerUserId) || !Number.isSafeInteger(value.connectionRevision) || value.connectionRevision < 0 ||
      typeof value.endpoint !== 'string') return undefined
  try {
    const endpoint = parseOutboundEndpoint(value.endpoint, 'public')
    if (endpoint.href !== value.endpoint) return undefined
  } catch { return undefined }
  return Object.freeze({ tenantId: value.tenantId, connectionId: value.connectionId, endpoint: value.endpoint,
    ownerUserId: value.ownerUserId, connectionRevision: value.connectionRevision })
}

function current(check) {
  try {
    const result = typeof check === 'function' ? check() : false
    if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); return false }
    return result === true
  } catch { return false }
}

function messageOf(event) {
  return event && typeof event === 'object' && Object.hasOwn(event, 'data') ? event.data : event
}

function listen(port, handler) {
  if (typeof port?.on === 'function') {
    port.on('message', handler)
    return () => port.off?.('message', handler)
  }
  if (typeof port?.addEventListener === 'function') {
    const wrapped = event => handler(event)
    port.addEventListener('message', wrapped)
    return () => port.removeEventListener?.('message', wrapped)
  }
  throw generic('The OAuth credential channel is unavailable.')
}

/** Backend/utility half. Each call is one request; cancellation is explicit and
 * late replies cannot re-open a resolved promise or its freshness fence. */
export function installMcpOAuthCredentialRuntime(parentPort = globalThis.process?.parentPort,
  { timeoutMs = 30_000, maxPending = 8 } = {}) {
  if (!parentPort) return null
  const deadline = timeoutValue(timeoutMs)
  const limit = pendingValue(maxPending)
  let sequence = 0
  let closed = false
  const pending = new Map()
  const post = message => { try { parentPort.postMessage(message); return true } catch { return false } }
  const onMessage = event => {
    const message = messageOf(event)
    if (!message || message.type !== MCP_OAUTH_CREDENTIAL_RESULT || !Number.isSafeInteger(message.requestId) || message.requestId < 1) return
    const entry = pending.get(message.requestId)
    if (!entry) return
    const success = ownRecord(message, ['type', 'requestId', 'ok', 'secret'])
    const failure = ownRecord(message, ['type', 'requestId', 'ok', 'error'])
    if ((!success || success.ok !== true || !isMcpCredentialSecret(success.secret)) &&
        (!failure || failure.ok !== false || failure.error !== 'unavailable')) return
    pending.delete(message.requestId)
    clearTimeout(entry.timer)
    entry.signal?.removeEventListener('abort', entry.abort)
    if (entry.signal?.aborted || !current(entry.isCurrent)) entry.reject(generic('The OAuth credential is unavailable.'))
    else if (success) entry.resolve(success.secret)
    else entry.reject(generic('The OAuth credential is unavailable.'))
  }
  const detach = listen(parentPort, onMessage)
  const close = () => {
    if (closed) return
    closed = true
    detach()
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timer)
      entry.signal?.removeEventListener('abort', entry.abort)
      post({ type: MCP_OAUTH_CREDENTIAL_CANCEL, requestId })
      entry.reject(generic('The OAuth credential channel is unavailable.'))
    }
    pending.clear()
  }
  return Object.freeze({
    resolve(reference, rawBinding, { signal, isCurrent } = {}) {
      if (closed) return Promise.reject(generic('The OAuth credential channel is unavailable.'))
      const binding = snapshotBinding(rawBinding)
      if (!isMcpCredentialReference(reference) || !binding || signal?.aborted || !current(isCurrent)) {
        return Promise.reject(generic('The OAuth credential request is invalid or stale.'))
      }
      if (pending.size >= limit) return Promise.reject(generic('The OAuth credential channel is busy.'))
      const requestId = ++sequence
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, signal, isCurrent, timer: undefined, abort: undefined }
        const finish = error => {
          if (pending.get(requestId) !== entry) return
          pending.delete(requestId)
          clearTimeout(entry.timer)
          signal?.removeEventListener('abort', entry.abort)
          if (error) reject(generic(error))
        }
        entry.abort = () => {
          if (!pending.has(requestId)) return
          post({ type: MCP_OAUTH_CREDENTIAL_CANCEL, requestId })
          finish('The OAuth credential request was cancelled.')
        }
        entry.timer = setTimeout(() => {
          post({ type: MCP_OAUTH_CREDENTIAL_CANCEL, requestId })
          finish('The OAuth credential request timed out.')
        }, deadline)
        pending.set(requestId, entry)
        signal?.addEventListener('abort', entry.abort, { once: true })
        if (signal?.aborted) return entry.abort()
        if (!current(isCurrent)) { finish('The OAuth credential request is stale.'); return }
        if (!post({ type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId, reference, binding })) {
          finish('The OAuth credential channel is unavailable.')
        }
      })
    },
    close,
  })
}

/** Main-process half. Timeouts/cancellation answer promptly but the active
 * slot remains occupied until the actual vault/refresh operation settles. */
export function createMcpOAuthCredentialHost(child, { resolve, timeoutMs = 30_000, maxPending = 8 } = {}) {
  if (!child || typeof resolve !== 'function') throw generic('The OAuth credential host is unavailable.')
  const deadline = timeoutValue(timeoutMs)
  const limit = pendingValue(maxPending)
  let closed = false
  let greatestAdmittedRequestId = 0
  const active = new Map()
  const post = message => { try { child.postMessage(message); return true } catch { return false } }
  const finishCaller = (entry, secret) => {
    if (entry.responded || closed || active.get(entry.requestId) !== entry) return
    entry.responded = true
    clearTimeout(entry.timer)
    if (isMcpCredentialSecret(secret) && entry.isCurrent()) {
      post({ type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: entry.requestId, ok: true, secret })
    } else post({ type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: entry.requestId, ok: false, error: 'unavailable' })
  }
  const onMessage = event => {
    const message = messageOf(event)
    if (!message || !Number.isSafeInteger(message.requestId) || message.requestId < 1) return
    if (message.type === MCP_OAUTH_CREDENTIAL_CANCEL) {
      const cancel = ownRecord(message, ['type', 'requestId'])
      const entry = active.get(message.requestId)
      if (!cancel || !entry) return
      entry.controller.abort()
      finishCaller(entry)
      return
    }
    if (message.type !== MCP_OAUTH_CREDENTIAL_RESOLVE) return
    const request = ownRecord(message, ['type', 'requestId', 'reference', 'binding'])
    const binding = request && snapshotBinding(request.binding)
    if (!request || !isMcpCredentialReference(request.reference) || !binding || closed ||
        request.requestId <= greatestAdmittedRequestId || active.size >= limit) {
      post({ type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: message.requestId, ok: false, error: 'unavailable' })
      return
    }
    // This ordered private channel uses host-generated monotonic child IDs.
    // Keep a high-water mark after settlement so replay cannot repeat a vault
    // read/refresh after the active map entry is gone.
    greatestAdmittedRequestId = request.requestId
    const controller = new AbortController()
    const entry = { requestId: request.requestId, controller, timer: undefined, responded: false,
      isCurrent: () => !closed && active.get(request.requestId) === entry && !controller.signal.aborted }
    active.set(request.requestId, entry)
    entry.timer = setTimeout(() => {
      controller.abort()
      finishCaller(entry)
    }, deadline)
    Promise.resolve().then(() => {
      if (!entry.isCurrent()) throw generic('unavailable')
      return resolve(request.reference, binding, { signal: controller.signal, isCurrent: entry.isCurrent })
    }).then(secret => finishCaller(entry, secret)).catch(() => finishCaller(entry)).finally(() => {
      clearTimeout(entry.timer)
      if (active.get(request.requestId) === entry) active.delete(request.requestId)
    })
  }
  const detach = listen(child, onMessage)
  return Object.freeze({
    close() {
      if (closed) return
      closed = true
      detach()
      for (const entry of active.values()) {
        clearTimeout(entry.timer)
        entry.controller.abort()
      }
      active.clear()
    },
  })
}
