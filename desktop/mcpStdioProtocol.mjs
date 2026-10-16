/** Bounded utility-process/native bridge for an already admitted stdio MCP
 * connection. It transports protocol requests only: no launch settings, URL,
 * credentials, or product policy are defined here. */
import { snapshotMcpJson } from '../server/mcpJsonCore.mjs'
import { McpStdioError } from './mcpStdioSupervisor.mjs'

export const MCP_STDIO_PROTOCOL = Object.freeze({
  open: 'agent-commons:mcp-stdio:open', openResult: 'agent-commons:mcp-stdio:open-result',
  rpc: 'agent-commons:mcp-stdio:rpc', rpcResult: 'agent-commons:mcp-stdio:rpc-result',
  cancel: 'agent-commons:mcp-stdio:cancel', close: 'agent-commons:mcp-stdio:close',
  closeResult: 'agent-commons:mcp-stdio:close-result', sync: 'agent-commons:mcp-stdio:sync',
  syncResult: 'agent-commons:mcp-stdio:sync-result',
})
export const MCP_STDIO_PROTOCOL_LIMITS = Object.freeze({ sessions: 4, pendingCalls: 16, syncEntries: 64,
  envelopeBytes: 1_048_576, envelopeDepth: 40, envelopeNodes: 32_768,
  openMs: 60_000, requestMs: 30_000, syncMs: 30_000 })

const CODES = new Set(['invalid', 'unavailable', 'busy', 'cancelled', 'stale', 'timeout', 'closed', 'protocol', 'limit', 'io'])
const METHODS = new Set(['server/discover', 'initialize', 'tools/list', 'tools/call'])
const REFERENCE = /^MCP_STDIO_[A-F0-9]{32}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const CONNECTION = /^mcp-connection-[a-f0-9]{32}$/
const SNAPSHOT_LIMITS = Object.freeze({ maxBytes: MCP_STDIO_PROTOCOL_LIMITS.envelopeBytes,
  maxDepth: MCP_STDIO_PROTOCOL_LIMITS.envelopeDepth, maxNodes: MCP_STDIO_PROTOCOL_LIMITS.envelopeNodes })
const fail = (code = 'unavailable', mayHaveSubmitted = false) => { throw new McpStdioError(code, mayHaveSubmitted) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isThenable = value => value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function'

function snapshot(value) {
  try { return snapshotMcpJson(value, SNAPSHOT_LIMITS) }
  catch (error) {
    const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined
    fail(code === 'limit' ? 'limit' : 'invalid')
  }
}
function exact(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function snapshotBinding(raw) {
  const value = snapshot(raw)
  if (!exact(value, ['tenantId', 'ownerUserId', 'connectionId', 'connectionRevision']) ||
      typeof value.tenantId !== 'string' || !IDENTIFIER.test(value.tenantId) ||
      typeof value.ownerUserId !== 'string' || !IDENTIFIER.test(value.ownerUserId) ||
      typeof value.connectionId !== 'string' || !CONNECTION.test(value.connectionId) ||
      !Number.isSafeInteger(value.connectionRevision) || value.connectionRevision < 0) fail('invalid')
  return Object.freeze({ tenantId: value.tenantId, ownerUserId: value.ownerUserId,
    connectionId: value.connectionId, connectionRevision: value.connectionRevision })
}
function snapshotOptions(raw, allowed, requireCurrent = false) {
  try {
    if (!object(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Object.getOwnPropertySymbols(raw).length) fail('invalid')
    const value = Object.create(null)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw))) {
      if (!allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid')
      const item = descriptor.value
      if (key === 'signal') {
        if (!(item instanceof AbortSignal)) fail('invalid')
        value[key] = item
      } else if (key === 'purpose' && typeof item === 'string') value[key] = item
      else if (typeof item === 'function' && ['isCurrent', 'beforeDispatch'].includes(key)) value[key] = item
      else if (item !== undefined) fail('invalid')
    }
    if (requireCurrent && typeof value.isCurrent !== 'function') fail('invalid')
    return value
  } catch (error) { if (error instanceof McpStdioError) throw error; fail('invalid') }
}
function current(check) {
  try {
    const result = check()
    if (result === true) return true
    if (isThenable(result)) void Promise.resolve(result).catch(() => {})
  } catch { /* fixed refusal */ }
  return false
}
function sourceCurrent(check, signal) {
  if (signal?.aborted) fail('cancelled')
  if (!current(check)) fail('stale')
  if (signal?.aborted) fail('cancelled')
}
function safeError(error, fallback = 'unavailable', uncertain = false) {
  try {
    const descriptors = error && typeof error === 'object' ? Object.getOwnPropertyDescriptors(error) : {}
    const code = descriptors.code?.value
    const mayHaveSubmitted = descriptors.mayHaveSubmitted?.value === true
    return { code: CODES.has(code) ? code : fallback, mayHaveSubmitted: uncertain || mayHaveSubmitted }
  } catch { return { code: fallback, mayHaveSubmitted: uncertain } }
}
function messageOf(event) {
  return event && typeof event === 'object' && Object.hasOwn(event, 'data') ? event.data : event
}
function listen(port, handler) {
  if (typeof port.on === 'function') {
    port.on('message', handler)
    return () => port.off?.('message', handler)
  }
  if (typeof port.addEventListener === 'function') {
    const wrapped = event => handler(event)
    port.addEventListener('message', wrapped)
    port.start?.()
    return () => port.removeEventListener?.('message', wrapped)
  }
  fail('invalid')
}
function post(port, value) {
  try { port.postMessage(value); return true } catch { return false }
}
function validRequestId(value) { return Number.isSafeInteger(value) && value > 0 }
function errorResult(type, requestId, sessionId, error, uncertain = false) {
  const safe = safeError(error, 'unavailable', uncertain)
  return { type, requestId, sessionId, ok: false, error: safe.code,
    ...(safe.mayHaveSubmitted ? { mayHaveSubmitted: true } : {}) }
}
function connectionShape(value) {
  return value && typeof value.request === 'function' && typeof value.initialized === 'function' &&
    typeof value.close === 'function' && value.closed && typeof value.closed.then === 'function'
}

/** Utility/backend half. `open` is intentionally synchronous and returns a
 * proxy immediately; the first operation waits for native admission. */
export function installMcpStdioRuntime(parentPort = globalThis.process?.parentPort,
  { timeoutMs = MCP_STDIO_PROTOCOL_LIMITS.requestMs, openTimeoutMs = MCP_STDIO_PROTOCOL_LIMITS.openMs,
    maxSessions = MCP_STDIO_PROTOCOL_LIMITS.sessions, maxPendingCalls = MCP_STDIO_PROTOCOL_LIMITS.pendingCalls } = {}) {
  if (!parentPort) return null
  const deadline = Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000 ? timeoutMs : MCP_STDIO_PROTOCOL_LIMITS.requestMs
  const openDeadline = Number.isSafeInteger(openTimeoutMs) && openTimeoutMs >= 1 && openTimeoutMs <= 60_000 ? openTimeoutMs : MCP_STDIO_PROTOCOL_LIMITS.openMs
  const sessionLimit = Number.isSafeInteger(maxSessions) && maxSessions >= 1 && maxSessions <= MCP_STDIO_PROTOCOL_LIMITS.sessions ? maxSessions : MCP_STDIO_PROTOCOL_LIMITS.sessions
  const pendingLimit = Number.isSafeInteger(maxPendingCalls) && maxPendingCalls >= 1 && maxPendingCalls <= MCP_STDIO_PROTOCOL_LIMITS.pendingCalls ? maxPendingCalls : MCP_STDIO_PROTOCOL_LIMITS.pendingCalls
  let closed = false
  let sequence = 0
  let sessionSequence = 0
  let pendingCallCount = 0
  const sessions = new Map()
  const pending = new Map()
  const closeReceipts = new Map()
  let syncQueued = 0
  let syncChain = Promise.resolve()
  let detach = () => {}
  const nextId = () => {
    if (sequence >= Number.MAX_SAFE_INTEGER || sessionSequence >= Number.MAX_SAFE_INTEGER) fail('limit')
    return ++sequence
  }
  const send = message => post(parentPort, message)
  const removeSession = entry => {
    sessions.delete(entry.sessionId)
    for (const [requestId, session] of closeReceipts) if (session === entry) closeReceipts.delete(requestId)
    entry.state = 'closed'
    entry.resolveClosed()
  }
  const settlePending = (requestId, result, error) => {
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.signal?.removeEventListener('abort', entry.abort)
    if (entry.kind === 'rpc') {
      pendingCallCount -= 1
      if (entry.session.pending === entry) entry.session.pending = undefined
    } else if (entry.kind === 'open') entry.session.openPending = undefined
    else if (entry.kind === 'close') entry.session.closePending = undefined
    if (error) entry.reject(error)
    else entry.resolve(result)
  }
  const onMessage = event => {
    if (closed && sessions.size === 0 && pending.size === 0) return
    let message
    try { message = snapshot(messageOf(event)) } catch { return }
    if (!object(message) || !validRequestId(message.requestId)) return
    const entry = pending.get(message.requestId)
    if (!entry || entry.responseType !== message.type) {
      const lateClose = closeReceipts.get(message.requestId)
      if (message.type === MCP_STDIO_PROTOCOL.closeResult && lateClose && message.ok === true &&
          exact(message, ['type', 'requestId', 'sessionId', 'ok']) && message.sessionId === lateClose.sessionId) {
        closeReceipts.delete(message.requestId)
        removeSession(lateClose)
      }
      return
    }
    const allowed = message.type === MCP_STDIO_PROTOCOL.openResult
      ? (message.ok === true && exact(message, ['type', 'requestId', 'sessionId', 'ok']) ||
        message.ok === false && (exact(message, ['type', 'requestId', 'sessionId', 'ok', 'error']) ||
          exact(message, ['type', 'requestId', 'sessionId', 'ok', 'error', 'mayHaveSubmitted']) ||
          exact(message, ['type', 'requestId', 'sessionId', 'ok', 'error', 'draining']) ||
          exact(message, ['type', 'requestId', 'sessionId', 'ok', 'error', 'mayHaveSubmitted', 'draining'])))
      : message.type === MCP_STDIO_PROTOCOL.rpcResult
        ? (message.ok === true && exact(message, ['type', 'requestId', 'sessionId', 'ok', 'value']) ||
          message.ok === false && (exact(message, ['type', 'requestId', 'sessionId', 'ok', 'error']) || exact(message, ['type', 'requestId', 'sessionId', 'ok', 'error', 'mayHaveSubmitted'])))
        : message.type === MCP_STDIO_PROTOCOL.closeResult
          ? message.ok === true && exact(message, ['type', 'requestId', 'sessionId', 'ok'])
          : message.type === MCP_STDIO_PROTOCOL.syncResult
            ? message.ok === true && exact(message, ['type', 'requestId', 'ok', 'available']) && typeof message.available === 'boolean'
            : false
    if (!allowed || (entry.sessionId !== undefined && message.sessionId !== entry.sessionId) ||
        (Object.hasOwn(message, 'draining') && typeof message.draining !== 'boolean') ||
        (Object.hasOwn(message, 'mayHaveSubmitted') && typeof message.mayHaveSubmitted !== 'boolean')) return
    if (!message.ok) {
      const code = CODES.has(message.error) ? message.error : 'unavailable'
      settlePending(message.requestId, undefined, new McpStdioError(code, message.mayHaveSubmitted === true))
      if (entry.kind === 'open') {
        entry.session.rejectOpen(new McpStdioError(code))
        entry.session.state = message.draining === true ? 'closing' : 'closed'
        if (message.draining !== true) removeSession(entry.session)
      }
      return
    }
    if (entry.kind === 'open') {
      entry.session.state = 'open'
      settlePending(message.requestId, undefined)
      entry.session.resolveOpen()
    } else if (entry.kind === 'rpc') {
      settlePending(message.requestId, message.value === null && entry.notification ? undefined : message.value)
    } else if (entry.kind === 'close') {
      closeReceipts.delete(message.requestId)
      settlePending(message.requestId, undefined)
      removeSession(entry.session)
    } else settlePending(message.requestId, { available: message.available })
  }
  detach = listen(parentPort, onMessage)

  function makePending(kind, requestId, session, responseType, signal, duration) {
    return new Promise((resolve, reject) => {
      const entry = { kind, requestId, sessionId: session?.sessionId, session, responseType, resolve, reject, signal, timer: undefined, abort: undefined }
      const cancel = code => {
        if (pending.get(requestId) !== entry) return
        if (kind === 'open' || kind === 'rpc') send({ type: MCP_STDIO_PROTOCOL.cancel, requestId, sessionId: session.sessionId })
        settlePending(requestId, undefined, new McpStdioError(code, kind === 'rpc' && entry.method === 'tools/call' && entry.submitted))
        // Settle an open timeout before aborting the open controller; otherwise
        // its abort listener can race and misclassify the deadline as cancelled.
        if (kind === 'open') void closeSession(session)
      }
      entry.abort = () => cancel('cancelled')
      entry.timer = setTimeout(() => cancel('timeout'), duration)
      pending.set(requestId, entry)
      if (kind === 'rpc') { pendingCallCount += 1; session.pending = entry }
      if (kind === 'open') session.openPending = entry
      if (kind === 'close') session.closePending = entry
      signal?.addEventListener('abort', entry.abort, { once: true })
      if (signal?.aborted) entry.abort()
    })
  }

  function closeSession(session) {
    if (session.closePromise) return session.closePromise
    if (session.state === 'closed') return session.closed
    session.state = 'closing'
    let resolveClose, rejectClose
    session.closePromise = new Promise((resolve, reject) => { resolveClose = resolve; rejectClose = reject })
    session.controller.abort()
    if (session.pending) {
      send({ type: MCP_STDIO_PROTOCOL.cancel, requestId: session.pending.requestId, sessionId: session.sessionId })
    }
    const requestId = nextId()
    closeReceipts.set(requestId, session)
    const work = makePending('close', requestId, session, MCP_STDIO_PROTOCOL.closeResult, undefined, openDeadline)
    work.then(() => session.closed).then(resolveClose, rejectClose)
    if (!send({ type: MCP_STDIO_PROTOCOL.close, requestId, sessionId: session.sessionId })) {
      settlePending(requestId, undefined, new McpStdioError('unavailable'))
    }
    return session.closePromise
  }

  function open(reference, rawBinding, rawOptions) {
    if (closed) fail('cancelled')
    const binding = snapshotBinding(rawBinding)
    const options = snapshotOptions(rawOptions, ['signal', 'isCurrent', 'purpose'], true)
    if (typeof reference !== 'string' || !REFERENCE.test(reference) || !['inspect', 'call'].includes(options.purpose)) fail('invalid')
    sourceCurrent(options.isCurrent, options.signal)
    if (closed) fail('cancelled')
    if (sessions.size >= sessionLimit) fail('busy')
    const sessionId = ++sessionSequence
    const requestId = nextId()
    const controller = new AbortController()
    const sourceSignal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    let resolveOpen, rejectOpen, resolveClosed
    const opened = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject })
    void opened.catch(() => {})
    const closedPromise = new Promise(resolve => { resolveClosed = resolve })
    const session = { sessionId, reference, binding, purpose: options.purpose, isCurrent: options.isCurrent,
      controller, signal: sourceSignal, state: 'opening', pending: undefined, openPending: undefined,
      closePending: undefined, closePromise: undefined, opened, resolveOpen, rejectOpen,
      closed: closedPromise, resolveClosed }
    sessions.set(sessionId, session)
    sourceSignal.addEventListener('abort', () => { void closeSession(session).catch(() => {}) }, { once: true })
    try {
      sourceCurrent(session.isCurrent, sourceSignal)
      if (closed) fail('cancelled')
    } catch (error) {
      session.rejectOpen(error)
      removeSession(session)
      throw error
    }
    const opening = makePending('open', requestId, session, MCP_STDIO_PROTOCOL.openResult, sourceSignal, openDeadline)
    if (pending.has(requestId) && !sourceSignal.aborted && !send({ type: MCP_STDIO_PROTOCOL.open, requestId, sessionId, reference, binding, purpose: session.purpose })) {
      settlePending(requestId, undefined, new McpStdioError('unavailable'))
      removeSession(session)
    }
    void opening.catch(error => { session.rejectOpen(error) })
    const sendRpc = async (method, params, rawCallOptions = {}, notification = false) => {
      if ((notification ? method !== 'initialized' : !METHODS.has(method)) ||
          (session.purpose === 'inspect' && method === 'tools/call')) fail('invalid')
      const callOptions = snapshotOptions(rawCallOptions, ['signal', 'beforeDispatch'])
      if (callOptions.beforeDispatch !== undefined && typeof callOptions.beforeDispatch !== 'function') fail('invalid')
      if (method === 'tools/call' && typeof callOptions.beforeDispatch !== 'function') fail('stale')
      const body = notification ? null : snapshot(params)
      if (!notification && !object(body)) fail('invalid')
      await session.opened
      sourceCurrent(session.isCurrent, AbortSignal.any([session.signal, callOptions.signal].filter(Boolean)))
      if (session.state !== 'open' || session.pending) fail(session.state === 'closing' ? 'cancelled' : 'busy')
      let dispatchApproved = false
      if (method === 'tools/call') {
        if (!current(callOptions.beforeDispatch)) fail('stale')
        dispatchApproved = true
      } else if (callOptions.beforeDispatch !== undefined) fail('invalid')
      const requestSignal = callOptions.signal ? AbortSignal.any([session.signal, callOptions.signal]) : session.signal
      sourceCurrent(session.isCurrent, requestSignal)
      if (session.state !== 'open' || session.pending) fail(session.state === 'closing' ? 'cancelled' : 'busy')
      if (pendingCallCount >= pendingLimit) fail('busy')
      if (requestSignal.aborted) fail('cancelled')
      const requestId = nextId()
      const work = makePending('rpc', requestId, session, MCP_STDIO_PROTOCOL.rpcResult, requestSignal, deadline)
      const pendingEntry = session.pending
      pendingEntry.method = method
      pendingEntry.submitted = true
      pendingEntry.notification = notification
      const wire = { type: MCP_STDIO_PROTOCOL.rpc, requestId, sessionId, method,
        ...(notification ? {} : { params: body }), ...(dispatchApproved ? { dispatchApproved: true } : {}) }
      if (pending.get(requestId) === pendingEntry && session.state === 'open' && !requestSignal.aborted &&
          !send(wire)) settlePending(requestId, undefined, new McpStdioError('unavailable', method === 'tools/call'))
      return work
    }
    return Object.freeze({
      request: (method, params = {}, callOptions = {}) => sendRpc(method, params, callOptions, false),
      initialized: () => sendRpc('initialized', {}, {}, true).then(() => undefined),
      close: () => closeSession(session),
      closed: closedPromise,
    })
  }

  function synchronize(rawEntries) {
    if (closed) return Promise.reject(new McpStdioError('cancelled'))
    let entries
    try {
      entries = snapshot(rawEntries)
      if (!Array.isArray(entries) || entries.length > MCP_STDIO_PROTOCOL_LIMITS.syncEntries) fail('invalid')
      const references = new Set()
      entries = entries.map(row => {
        if (!exact(row, ['reference', 'binding']) || (row.reference !== null && (typeof row.reference !== 'string' || !REFERENCE.test(row.reference))) || (row.reference !== null && references.has(row.reference))) fail('invalid')
        if (row.reference !== null) references.add(row.reference)
        return Object.freeze({ reference: row.reference, binding: snapshotBinding(row.binding) })
      })
    } catch (error) { return Promise.reject(error instanceof McpStdioError ? error : new McpStdioError('invalid')) }
    if (syncQueued >= pendingLimit) return Promise.reject(new McpStdioError('busy'))
    syncQueued += 1
    const operation = syncChain.then(() => {
      if (closed) throw new McpStdioError('cancelled')
      const requestId = nextId()
      const work = makePending('sync', requestId, undefined, MCP_STDIO_PROTOCOL.syncResult, undefined, MCP_STDIO_PROTOCOL_LIMITS.syncMs)
      if (pending.has(requestId) && !send({ type: MCP_STDIO_PROTOCOL.sync, requestId, entries })) settlePending(requestId, undefined, new McpStdioError('unavailable'))
      return work
    })
    syncChain = operation.then(() => undefined, () => undefined)
    return operation.finally(() => { syncQueued -= 1 })
  }

  function close() {
    if (closed) return Promise.all([...sessions.values()].map(session => closeSession(session))).then(() => undefined)
    closed = true
    return Promise.all([...sessions.values()].map(session => closeSession(session)))
      .then(() => syncChain).then(() => { detach(); return undefined })
  }
  return Object.freeze({ open, synchronize, close })
}

/** Main/native half. The caller injects trusted identity and launch authority;
 * IPC supplies only the opaque reference, binding, purpose and JSON-RPC data. */
export function createMcpStdioHost(child, { open, synchronize, isCurrent,
  maxSessions = MCP_STDIO_PROTOCOL_LIMITS.sessions, maxPendingCalls = MCP_STDIO_PROTOCOL_LIMITS.pendingCalls,
  timeoutMs = MCP_STDIO_PROTOCOL_LIMITS.requestMs, openTimeoutMs = MCP_STDIO_PROTOCOL_LIMITS.openMs,
  syncTimeoutMs = MCP_STDIO_PROTOCOL_LIMITS.syncMs } = {}) {
  if (!child || typeof open !== 'function' || typeof synchronize !== 'function' || typeof isCurrent !== 'function') fail('invalid')
  const sessionLimit = Number.isSafeInteger(maxSessions) && maxSessions >= 1 && maxSessions <= MCP_STDIO_PROTOCOL_LIMITS.sessions ? maxSessions : MCP_STDIO_PROTOCOL_LIMITS.sessions
  const pendingLimit = Number.isSafeInteger(maxPendingCalls) && maxPendingCalls >= 1 && maxPendingCalls <= MCP_STDIO_PROTOCOL_LIMITS.pendingCalls ? maxPendingCalls : MCP_STDIO_PROTOCOL_LIMITS.pendingCalls
  const deadline = Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000 ? timeoutMs : MCP_STDIO_PROTOCOL_LIMITS.requestMs
  const openDeadline = Number.isSafeInteger(openTimeoutMs) && openTimeoutMs >= 1 && openTimeoutMs <= 60_000 ? openTimeoutMs : MCP_STDIO_PROTOCOL_LIMITS.openMs
  const syncDeadline = Number.isSafeInteger(syncTimeoutMs) && syncTimeoutMs >= 1 && syncTimeoutMs <= 60_000 ? syncTimeoutMs : MCP_STDIO_PROTOCOL_LIMITS.syncMs
  const sessions = new Map()
  const pendingCalls = new Map()
  let greatestRequestId = 0
  let closed = false
  let detach = () => {}
  let syncChain = Promise.resolve()
  let syncQueued = 0
  const postToChild = message => post(child, message)
  const sourceCurrent = entry => {
    if (closed || entry.closing) return false
    if (!current(() => isCurrent(entry.reference, entry.binding, entry.purpose))) return false
    return !closed && !entry.closing
  }
  const sendError = (type, requestId, sessionId, error, uncertain = false) => postToChild(errorResult(type, requestId, sessionId, error, uncertain))

  function retire(entry) {
    if (entry.state === 'closed') return
    entry.state = 'closed'
    sessions.delete(entry.sessionId)
    for (const call of entry.calls.values()) {
      clearTimeout(call.timer)
      call.controller.abort()
      pendingCalls.delete(call.requestId)
    }
    entry.calls.clear()
    entry.resolveClosed()
    for (const closeId of entry.closeIds) postToChild({ type: MCP_STDIO_PROTOCOL.closeResult, requestId: closeId, sessionId: entry.sessionId, ok: true })
    entry.closeIds.clear()
  }
  function shutdownConnection(entry) {
    if (entry.shutdownPromise) return entry.shutdownPromise
    entry.shutdownPromise = (async () => {
      const connection = entry.connection
      if (!connection) return
      try { void Promise.resolve(connection.close()).catch(() => {}) } catch { /* still require physical close */ }
      let confirmed = false
      await Promise.resolve(connection.closed).then(() => { confirmed = true }, () => {})
      // Only a fulfilled physical-close promise releases the owned slot.
      if (!confirmed) return
      entry.connection = undefined
    })()
    return entry.shutdownPromise
  }
  async function drain(entry) {
    if (entry.drainPromise) return entry.drainPromise
    entry.closing = true
    entry.state = 'closing'
    entry.controller.abort()
    for (const call of entry.calls.values()) {
      call.controller.abort()
      if (!call.responded) {
        call.responded = true
        sendError(MCP_STDIO_PROTOCOL.rpcResult, call.requestId, entry.sessionId,
          new McpStdioError('cancelled', call.method === 'tools/call'))
      }
    }
    entry.drainPromise = (async () => {
      if (entry.openPromise) await entry.openPromise.catch(() => {})
      if (entry.connection) await shutdownConnection(entry)
      if (!entry.connection) retire(entry)
      await entry.closed
    })()
    return entry.drainPromise
  }
  function rememberRequest(message) {
    if (!validRequestId(message.requestId) || message.requestId <= greatestRequestId) return false
    greatestRequestId = message.requestId
    return true
  }
  function openSession(message) {
    const requestId = message.requestId, sessionId = message.sessionId
    if (!exact(message, ['type', 'requestId', 'sessionId', 'reference', 'binding', 'purpose']) ||
        !validRequestId(requestId) || !validRequestId(sessionId) || !rememberRequest(message) ||
        typeof message.reference !== 'string' || !REFERENCE.test(message.reference) ||
        !['inspect', 'call'].includes(message.purpose) || closed || sessions.size >= sessionLimit) {
      sendError(MCP_STDIO_PROTOCOL.openResult, validRequestId(requestId) ? requestId : 1,
        validRequestId(sessionId) ? sessionId : 1, new McpStdioError(closed ? 'cancelled' : 'unavailable'))
      return
    }
    let binding
    try { binding = snapshotBinding(message.binding) } catch {
      sendError(MCP_STDIO_PROTOCOL.openResult, requestId, sessionId, new McpStdioError('unavailable'))
      return
    }
    if (sessions.has(sessionId)) { sendError(MCP_STDIO_PROTOCOL.openResult, requestId, sessionId, new McpStdioError('unavailable')); return }
    const controller = new AbortController()
    let resolveClosed
    const closedPromise = new Promise(resolve => { resolveClosed = resolve })
    const entry = { sessionId, openRequestId: requestId, reference: message.reference, binding,
      purpose: message.purpose, controller, state: 'opening', closing: false, connection: undefined,
      calls: new Map(), closeIds: new Set(), openResponseSent: false, shutdownPromise: undefined,
      drainPromise: undefined, closed: closedPromise, resolveClosed }
    sessions.set(sessionId, entry)
    const sendOpenError = (error, draining = false) => {
      if (entry.openResponseSent) return
      entry.openResponseSent = true
      const safe = safeError(error)
      postToChild({ type: MCP_STDIO_PROTOCOL.openResult, requestId, sessionId, ok: false,
        error: safe.code, ...(safe.mayHaveSubmitted ? { mayHaveSubmitted: true } : {}), ...(draining ? { draining: true } : {}) })
    }
    entry.openTimer = setTimeout(() => {
      entry.closing = true
      controller.abort()
      sendOpenError(new McpStdioError('timeout'), true)
      void drain(entry)
    }, openDeadline)
    entry.openPromise = Promise.resolve().then(() => {
      if (!sourceCurrent(entry)) fail('stale')
      return open(entry.reference, entry.binding, { signal: controller.signal,
        isCurrent: () => sourceCurrent(entry), purpose: entry.purpose })
    }).then(connection => {
      clearTimeout(entry.openTimer)
      if (!connectionShape(connection)) fail('unavailable')
      entry.connection = connection
      if (entry.closing || !sourceCurrent(entry)) {
        sendOpenError(new McpStdioError(entry.closing ? 'cancelled' : 'stale'), true)
        void drain(entry)
        return
      }
      entry.state = 'open'
      entry.openResponseSent = true
      postToChild({ type: MCP_STDIO_PROTOCOL.openResult, requestId, sessionId, ok: true })
    }).catch(error => {
      clearTimeout(entry.openTimer)
      sendOpenError(error, Boolean(entry.connection))
      if (entry.connection) void drain(entry)
      else retire(entry)
    })
  }
  function cancel(message) {
    if (!exact(message, ['type', 'requestId', 'sessionId']) || !validRequestId(message.requestId) || !validRequestId(message.sessionId)) return
    const entry = sessions.get(message.sessionId)
    if (!entry) return
    if (entry.openRequestId === message.requestId && entry.state === 'opening') {
      entry.closing = true
      entry.controller.abort()
      if (!entry.openResponseSent) {
        entry.openResponseSent = true
        postToChild({ type: MCP_STDIO_PROTOCOL.openResult, requestId: message.requestId, sessionId: entry.sessionId,
          ok: false, error: 'cancelled', draining: true })
      }
      void drain(entry)
      return
    }
    const call = entry.calls.get(message.requestId)
    if (call) {
      call.controller.abort()
      if (!call.responded) {
        call.responded = true
        sendError(MCP_STDIO_PROTOCOL.rpcResult, call.requestId, entry.sessionId,
          new McpStdioError('cancelled', call.method === 'tools/call'))
      }
    }
  }
  function runRpc(message) {
    const id = message.requestId, sessionId = message.sessionId
    if (!validRequestId(id) || !validRequestId(sessionId) || !rememberRequest(message)) {
      sendError(MCP_STDIO_PROTOCOL.rpcResult, validRequestId(id) ? id : 1, validRequestId(sessionId) ? sessionId : 1, new McpStdioError('unavailable'))
      return
    }
    const entry = sessions.get(sessionId)
    const baseKeys = ['type', 'requestId', 'sessionId', 'method']
    const notification = message.method === 'initialized'
    const expected = notification ? baseKeys : [...baseKeys, 'params', ...(message.dispatchApproved === true ? ['dispatchApproved'] : [])]
    if (!exact(message, expected) || !entry || entry.state !== 'open' || entry.closing ||
        !METHODS.has(message.method) && !notification ||
        (notification && !exact(message, baseKeys)) ||
        (entry.purpose === 'inspect' && message.method === 'tools/call') ||
        (message.method === 'tools/call' && message.dispatchApproved !== true) ||
        (message.method !== 'tools/call' && Object.hasOwn(message, 'dispatchApproved')) ||
        (!notification && !object(message.params))) {
      sendError(MCP_STDIO_PROTOCOL.rpcResult, id, sessionId, new McpStdioError('invalid'))
      return
    }
    if (entry.calls.size > 0 || pendingCalls.size >= pendingLimit) {
      sendError(MCP_STDIO_PROTOCOL.rpcResult, id, sessionId, new McpStdioError('busy'))
      return
    }
    if (!sourceCurrent(entry)) { sendError(MCP_STDIO_PROTOCOL.rpcResult, id, sessionId, new McpStdioError('stale')); return }
    const controller = new AbortController()
    const call = { requestId: id, method: message.method, controller, responded: false }
    entry.calls.set(id, call)
    pendingCalls.set(id, call)
    const sendResponse = (value, error) => {
      if (call.responded) return
      call.responded = true
      if (error) sendError(MCP_STDIO_PROTOCOL.rpcResult, id, sessionId, error)
      else {
        try { postToChild({ type: MCP_STDIO_PROTOCOL.rpcResult, requestId: id, sessionId, ok: true, value: value === undefined ? null : snapshot(value) }) }
        catch (error) { sendError(MCP_STDIO_PROTOCOL.rpcResult, id, sessionId, error, message.method === 'tools/call') }
      }
    }
    call.timer = setTimeout(() => {
      controller.abort()
      sendResponse(undefined, new McpStdioError('timeout', message.method === 'tools/call'))
    }, deadline)
    const signal = AbortSignal.any([entry.controller.signal, controller.signal])
    const work = notification ? Promise.resolve().then(() => entry.connection.initialized())
      : Promise.resolve().then(() => entry.connection.request(message.method, message.params, {
        signal,
        ...(message.method === 'tools/call' ? { beforeDispatch: () => sourceCurrent(entry) && message.dispatchApproved === true } : {}),
      }))
    call.work = work
    void work.then(value => sendResponse(value), error => sendResponse(undefined, error)).finally(() => {
      clearTimeout(call.timer)
      entry.calls.delete(id)
      pendingCalls.delete(id)
    })
  }
  function runSync(message) {
    const id = message.requestId
    if (!validRequestId(id) || !rememberRequest(message) || !exact(message, ['type', 'requestId', 'entries']) ||
        !Array.isArray(message.entries) || message.entries.length > MCP_STDIO_PROTOCOL_LIMITS.syncEntries || closed) {
      if (validRequestId(id)) postToChild({ type: MCP_STDIO_PROTOCOL.syncResult, requestId: id, ok: true, available: false })
      return
    }
    let entries
    try {
      const refs = new Set()
      entries = message.entries.map(row => {
        if (!exact(row, ['reference', 'binding']) || (row.reference !== null && (typeof row.reference !== 'string' || !REFERENCE.test(row.reference))) || (row.reference !== null && refs.has(row.reference))) fail('invalid')
        if (row.reference !== null) refs.add(row.reference)
        return Object.freeze({ reference: row.reference, binding: snapshotBinding(row.binding) })
      })
    } catch { postToChild({ type: MCP_STDIO_PROTOCOL.syncResult, requestId: id, ok: true, available: false }); return }
    if (syncQueued >= pendingLimit) { postToChild({ type: MCP_STDIO_PROTOCOL.syncResult, requestId: id, ok: true, available: false }); return }
    syncQueued += 1
    const operation = syncChain.then(async () => {
      if (closed) return false
      let timer
      let responded = false
      timer = setTimeout(() => {
        responded = true
        postToChild({ type: MCP_STDIO_PROTOCOL.syncResult, requestId: id, ok: true, available: false })
      }, syncDeadline)
      try {
        const result = await Promise.resolve().then(() => synchronize(entries))
        const available = object(result) && exact(result, ['available']) && typeof result.available === 'boolean' && result.available
        if (!responded) postToChild({ type: MCP_STDIO_PROTOCOL.syncResult, requestId: id, ok: true, available })
      } catch {
        if (!responded) postToChild({ type: MCP_STDIO_PROTOCOL.syncResult, requestId: id, ok: true, available: false })
      } finally { clearTimeout(timer) }
    })
      .finally(() => { syncQueued -= 1 })
    syncChain = operation.then(() => undefined, () => undefined)
  }
  function closeSession(message) {
    const id = message.requestId, sessionId = message.sessionId
    if (!validRequestId(id) || !validRequestId(sessionId) || !rememberRequest(message) ||
        !exact(message, ['type', 'requestId', 'sessionId'])) {
      if (validRequestId(id) && validRequestId(sessionId)) sendError(MCP_STDIO_PROTOCOL.closeResult, id, sessionId, new McpStdioError('unavailable'))
      return
    }
    const entry = sessions.get(sessionId)
    if (!entry) { sendError(MCP_STDIO_PROTOCOL.closeResult, id, sessionId, new McpStdioError('unavailable')); return }
    entry.closeIds.add(id)
    void drain(entry)
  }
  const onMessage = event => {
    if (closed && sessions.size === 0) return
    let message
    try { message = snapshot(messageOf(event)) } catch { return }
    if (!object(message) || typeof message.type !== 'string') return
    if (message.type === MCP_STDIO_PROTOCOL.open) openSession(message)
    else if (message.type === MCP_STDIO_PROTOCOL.rpc) runRpc(message)
    else if (message.type === MCP_STDIO_PROTOCOL.cancel) cancel(message)
    else if (message.type === MCP_STDIO_PROTOCOL.close) closeSession(message)
    else if (message.type === MCP_STDIO_PROTOCOL.sync) runSync(message)
  }
  detach = listen(child, onMessage)
  return Object.freeze({
    close() {
      if (closed) return Promise.all([...sessions.values()].map(drain)).then(() => syncChain).then(() => { detach() })
      closed = true
      const work = [...sessions.values()].map(drain)
      return Promise.all(work).then(() => syncChain).then(() => { detach() })
    },
    get activeSessions() { return sessions.size },
    get pendingCalls() { return pendingCalls.size },
  })
}
