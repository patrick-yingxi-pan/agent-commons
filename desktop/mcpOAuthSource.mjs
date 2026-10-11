/** Native-only authenticated local HTTP adapter. The renderer never supplies
 * a cookie, endpoint, credential owner or inspection request. Not installed by
 * the shipping host until the complete consent workflow is ready. */
import { isMcpBinding, isMcpCredentialReference } from './mcpCredentialProtocol.mjs'
import { parseOutboundEndpoint } from '../server/outboundAddressCore.mjs'

const unavailable = () => new Error('The MCP OAuth source is unavailable or changed.')
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 256) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)
const exact = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key))
const revision = value => Number.isSafeInteger(value) && value >= 0
const current = check => {
  try {
    const result = check()
    if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); return false }
    return result === true
  } catch { return false }
}
const sameSession = (a, b) => a.stamp === b.stamp && a.origin === b.origin && a.cookie === b.cookie

function snapshotSession(raw) {
  if (!exact(raw, ['origin', 'cookie', 'stamp']) || !text(raw.stamp, 512) ||
      typeof raw.cookie !== 'string' || !/^uw_session=[\x21-\x3a\x3c-\x7e]{1,8192}$/.test(raw.cookie)) throw unavailable()
  let url
  try { url = new URL(raw.origin) } catch { throw unavailable() }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== raw.origin ||
      url.username || url.password) throw unavailable()
  return Object.freeze({ origin: raw.origin, cookie: raw.cookie, stamp: raw.stamp })
}

function snapshotSource(raw, connectionId, stamp) {
  if (!exact(raw, ['ownerUserId', 'binding', 'connection']) || !text(raw.ownerUserId, 200) ||
      !isMcpBinding(raw.binding) || raw.binding.connectionId !== connectionId) throw unavailable()
  try { if (parseOutboundEndpoint(raw.binding.endpoint, 'public').href !== raw.binding.endpoint) throw unavailable() }
  catch { throw unavailable() }
  const connection = raw.connection
  if (!exact(connection, ['id', 'authentication', 'revision', 'status'], ['inspectionOperationId']) ||
      connection.id !== connectionId || connection.authentication !== 'device-oauth' || !revision(connection.revision) ||
      !['unverified', 'connected', 'disconnected'].includes(connection.status) ||
      (connection.inspectionOperationId != null && !text(connection.inspectionOperationId, 200))) throw unavailable()
  return Object.freeze({ stamp, ownerUserId: raw.ownerUserId,
    binding: Object.freeze({ ...raw.binding }), connection: Object.freeze({ ...connection }) })
}

async function readJson(response, signal) {
  if (!response.ok || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw unavailable()
  if (Number(response.headers.get('content-length')) > 8192) throw unavailable()
  const reader = response.body?.getReader()
  if (!reader) throw unavailable()
  const chunks = []
  let length = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw unavailable()
    while (true) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw unavailable()
      if (done) break
      length += value.byteLength
      if (length > 8192) throw unavailable()
      chunks.push(value)
    }
    const bytes = Buffer.concat(chunks, length)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

/** readSession is the trusted main-process cookie reader. Its stamp must change
 * on cookie, backend or window lifetime changes; isSessionCurrent is synchronous.
 * Sources carry frozen equality preconditions, never cookie authority. */
export function createMcpOAuthSource({ readSession, isSessionCurrent, fetch: fetcher = globalThis.fetch,
  timeoutMs = 30_000, maxPending = 8 }) {
  if (typeof readSession !== 'function' || typeof isSessionCurrent !== 'function' || typeof fetcher !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 8) throw unavailable()
  const active = new Set()
  let closed = false
  const sessionCurrent = stamp => !closed && current(() => isSessionCurrent(stamp))
  const run = (task, externalSignal) => {
    if (closed || externalSignal?.aborted || active.size >= maxPending) return Promise.reject(unavailable())
    const controller = new AbortController()
    active.add(controller)
    let rejectAbort
    const aborted = new Promise((_, reject) => { rejectAbort = reject })
    const abort = () => { controller.abort(); rejectAbort(unavailable()) }
    const timer = setTimeout(abort, timeoutMs)
    externalSignal?.addEventListener('abort', abort, { once: true })
    if (externalSignal?.aborted) abort()
    const work = Promise.resolve().then(() => {
      if (controller.signal.aborted || closed) throw unavailable()
      return task(controller.signal)
    }).catch(() => { throw unavailable() }).finally(() => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
      active.delete(controller)
    })
    // Close must wake callers as well as abort transport, even if a dependency
    // ignores abort. Work retains its admission slot until actual settlement.
    controller.signal.addEventListener('abort', () => rejectAbort(unavailable()), { once: true })
    return Promise.race([work, aborted])
  }
  const heldSession = async signal => {
    const session = snapshotSession(await readSession())
    if (signal.aborted || !sessionCurrent(session.stamp)) throw unavailable()
    return session
  }
  const sourceRead = async (connectionId, session, signal) => {
    if (signal.aborted || !sessionCurrent(session.stamp)) throw unavailable()
    const response = await fetcher(`${session.origin}/api/v1/mcp-connections/${encodeURIComponent(connectionId)}/oauth-source`, {
      headers: { Accept: 'application/json', Origin: session.origin, Cookie: session.cookie },
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
    })
    try {
      const raw = await readJson(response, signal)
      if (signal.aborted || !sessionCurrent(session.stamp) || !sameSession(session, await heldSession(signal))) throw unavailable()
      const source = snapshotSource(raw, connectionId, session.stamp)
      return source
    } finally { void response.body?.cancel().catch(() => {}) }
  }
  return Object.freeze({
    isSourceCurrent: sessionCurrent,
    resolveSource(connectionId, { signal } = {}) {
      if (!text(connectionId)) return Promise.reject(unavailable())
      return run(async innerSignal => sourceRead(connectionId, await heldSession(innerSignal), innerSignal), signal)
    },
    inspect(rawSource, request, { signal } = {}) {
      let source
      try {
        if (!exact(rawSource, ['stamp', 'ownerUserId', 'binding', 'connection']) || !text(rawSource.stamp, 512)) throw unavailable()
        source = snapshotSource({ ownerUserId: rawSource.ownerUserId, binding: rawSource.binding, connection: rawSource.connection },
          rawSource.binding?.connectionId, rawSource.stamp)
      } catch { return Promise.reject(unavailable()) }
      if (!exact(request, ['operationId', 'expectedRevision', 'credentialReference']) ||
          !text(request.operationId, 200) || !revision(request.expectedRevision) ||
          request.expectedRevision !== source.connection.revision || !isMcpCredentialReference(request.credentialReference)) return Promise.reject(unavailable())
      const operationId = request.operationId
      const body = JSON.stringify({ operationId, expectedRevision: request.expectedRevision,
        credentialReference: request.credentialReference })
      return run(async innerSignal => {
        const session = await heldSession(innerSignal)
        if (session.stamp !== source.stamp) throw unavailable()
        // Read current authority immediately before POST. Backend inspection also
        // pins its own owner/revision and repeats those checks after every wait.
        const latest = await sourceRead(source.binding.connectionId, session, innerSignal)
        if (latest.ownerUserId !== source.ownerUserId || latest.binding.tenantId !== source.binding.tenantId ||
            latest.binding.endpoint !== source.binding.endpoint || latest.connection.revision !== source.connection.revision) throw unavailable()
        if (innerSignal.aborted || !sessionCurrent(session.stamp)) throw unavailable()
        const response = await fetcher(`${session.origin}/api/v1/mcp-connections/${encodeURIComponent(source.binding.connectionId)}/inspect`, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json',
            Origin: session.origin, Cookie: session.cookie, 'X-Account-Transition-Source': `session:${source.ownerUserId}` },
          body, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: innerSignal,
        })
        // Never forward the potentially large tool catalog through native IPC.
        // Exact receipt reconciliation reads fresh minimal authorized truth.
        void response.body?.cancel().catch(() => {})
        if (!response.ok || response.redirected) throw unavailable()
        const receipt = await sourceRead(source.binding.connectionId, session, innerSignal)
        if (receipt.ownerUserId !== source.ownerUserId || receipt.binding.tenantId !== source.binding.tenantId ||
            receipt.binding.endpoint !== source.binding.endpoint || receipt.connection.inspectionOperationId !== operationId ||
            receipt.connection.revision <= source.connection.revision) throw unavailable()
        return Object.freeze({ connection: receipt.connection })
      }, signal)
    },
    close() { closed = true; for (const controller of active) controller.abort() },
  })
}
