/** Native-only, cookie-authenticated source and receipt adapter. Launch details
 * never travel over HTTP. A failed inspection acknowledgment is recovered by
 * reading its receipt, never by issuing another POST. */
import { snapshotMcpStdioGrantBinding } from './mcpStdioGrantVault.mjs'

const unavailable = () => new Error('The local MCP source is unavailable or changed.')
export class McpStdioDefinitiveInspectionRefusal extends Error {
  constructor() {
    super('Local MCP inspection was definitively refused before commit.')
    this.name = 'McpStdioDefinitiveInspectionRefusal'
    this.code = 'definitive-inspection-refusal'
  }
}
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const ascii = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)
const current = check => {
  try {
    const value = check()
    if (value && typeof value.then === 'function') { Promise.resolve(value).catch(() => {}); return false }
    return value === true
  } catch { return false }
}
const sameAudience = (left, right) => left.tenantId === right.tenantId && left.ownerUserId === right.ownerUserId &&
  left.connectionId === right.connectionId

function sessionSnapshot(value) {
  if (!exact(value, ['origin', 'cookie', 'stamp']) || !ascii(value.stamp, 512) ||
      typeof value.cookie !== 'string' || !/^uw_session=[\x21-\x3a\x3c-\x7e]{1,8192}$/.test(value.cookie)) throw unavailable()
  let url
  try { url = new URL(value.origin) } catch { throw unavailable() }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== value.origin ||
      url.username || url.password) throw unavailable()
  return Object.freeze({ origin: value.origin, cookie: value.cookie, stamp: value.stamp })
}

function sourceSnapshot(value, connectionId, stamp) {
  if (!exact(value, ['binding', 'connection']) || !exact(value.binding,
    ['tenantId', 'ownerUserId', 'connectionId', 'connectionRevision'])) throw unavailable()
  const { connectionRevision, ...identity } = value.binding
  const binding = snapshotMcpStdioGrantBinding(identity)
  const connection = value.connection
  if (!binding || binding.connectionId !== connectionId || !Number.isSafeInteger(connectionRevision) || connectionRevision < 0 ||
      !exact(connection, ['revision', 'status', 'inspectionOperationId']) || connection.revision !== connectionRevision ||
      !['unverified', 'connected', 'disconnected'].includes(connection.status) ||
      (connection.inspectionOperationId !== null && !ascii(connection.inspectionOperationId, 128))) throw unavailable()
  return Object.freeze({ stamp, binding: Object.freeze({ ...binding, connectionRevision }),
    connection: Object.freeze({ ...connection }) })
}

async function readJson(response, signal, allowErrorResponse = false) {
  if ((!response.ok && !allowErrorResponse) || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
      Number(response.headers.get('content-length')) > 8192) throw unavailable()
  const reader = response.body?.getReader()
  if (!reader) throw unavailable()
  let size = 0
  const chunks = []
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw unavailable()
    while (true) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw unavailable()
      if (done) break
      size += value.byteLength
      if (size > 8192) throw unavailable()
      chunks.push(value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

export function createMcpStdioSource({ readSession, isSessionCurrent, fetch: fetcher = globalThis.fetch,
  timeoutMs = 60_000, maxPending = 4 }) {
  if (typeof readSession !== 'function' || typeof isSessionCurrent !== 'function' || typeof fetcher !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 4) throw unavailable()
  let closed = false
  const active = new Set()
  const isSourceCurrent = stamp => !closed && current(() => isSessionCurrent(stamp))
  const run = (operation, signal) => {
    if (closed || signal?.aborted || active.size >= maxPending) return Promise.reject(unavailable())
    const controller = new AbortController()
    active.add(controller)
    let rejectAbort
    const aborted = new Promise((_, reject) => { rejectAbort = reject })
    const abort = () => { controller.abort(); rejectAbort(unavailable()) }
    controller.signal.addEventListener('abort', () => rejectAbort(unavailable()), { once: true })
    const timer = setTimeout(abort, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const work = Promise.resolve().then(() => {
      if (closed || controller.signal.aborted) throw unavailable()
      return operation(controller.signal)
    }).catch(error => {
      if (error instanceof McpStdioDefinitiveInspectionRefusal) throw error
      throw unavailable()
    }).finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      active.delete(controller)
    })
    // Ignored cancellation must not free the underlying admission slot.
    return Promise.race([work, aborted])
  }
  const session = async signal => {
    const held = sessionSnapshot(await readSession())
    if (signal.aborted || !isSourceCurrent(held.stamp)) throw unavailable()
    return held
  }
  const read = async (connectionId, held, signal) => {
    if (signal.aborted || !isSourceCurrent(held.stamp)) throw unavailable()
    const response = await fetcher(`${held.origin}/api/v1/mcp-connections/${encodeURIComponent(connectionId)}/stdio-source`, {
      headers: { Accept: 'application/json', Origin: held.origin, Cookie: held.cookie },
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
    })
    try {
      const raw = await readJson(response, signal)
      const latest = await session(signal)
      if (latest.stamp !== held.stamp || latest.cookie !== held.cookie || latest.origin !== held.origin) throw unavailable()
      return sourceSnapshot(raw, connectionId, held.stamp)
    } finally { void response.body?.cancel().catch(() => {}) }
  }
  return Object.freeze({
    isSourceCurrent,
    resolveSource(connectionId, { signal } = {}) {
      if (typeof connectionId !== 'string' || !/^mcp-connection-[a-f0-9]{32}$/.test(connectionId)) return Promise.reject(unavailable())
      return run(async inner => read(connectionId, await session(inner), inner), signal)
    },
    inspect(raw, request, { signal, beforeSubmit } = {}) {
      let source
      try {
        if (!exact(raw, ['stamp', 'binding', 'connection']) || !ascii(raw.stamp, 512)) throw unavailable()
        source = sourceSnapshot({ binding: raw.binding, connection: raw.connection }, raw.binding?.connectionId, raw.stamp)
        if (!exact(request, ['operationId', 'expectedRevision', 'grantReference']) || !ascii(request.operationId, 128) ||
            request.expectedRevision !== source.binding.connectionRevision || typeof request.grantReference !== 'string' ||
            !/^MCP_STDIO_[A-F0-9]{32}$/.test(request.grantReference) || typeof beforeSubmit !== 'function') throw unavailable()
      } catch { return Promise.reject(unavailable()) }
      const body = JSON.stringify(request)
      const operationId = request.operationId
      return run(async inner => {
        const held = await session(inner)
        if (held.stamp !== source.stamp) throw unavailable()
        const latest = await read(source.binding.connectionId, held, inner)
        if (!sameAudience(latest.binding, source.binding) || latest.binding.connectionRevision !== source.binding.connectionRevision ||
            inner.aborted || !isSourceCurrent(held.stamp) || !current(beforeSubmit) || inner.aborted || !isSourceCurrent(held.stamp)) throw unavailable()
        const response = await fetcher(`${held.origin}/api/v1/mcp-connections/${source.binding.connectionId}/inspect`, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json',
            Origin: held.origin, Cookie: held.cookie, 'X-Account-Transition-Source': `session:${source.binding.ownerUserId}` },
          body, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: inner,
        })
        if (!response.ok) {
          // Only this exact local route result is definitive: its timeout and
          // discovery/catalog failures settle before commitMcpInspection.
          // Lost transport, conflicts and post-commit cleanup failures remain
          // uncertain and must retain the provisional grant for receipt recovery.
          if (response.status === 502 && !response.redirected) {
            try {
              const payload = await readJson(response, inner, true)
              const error = payload?.error
              if (!exact(payload, ['error']) || !exact(error, ['code', 'message']) ||
                  error.code !== 'upstream_unavailable' || !ascii(error.message, 512)) throw unavailable()
              const latest = await session(inner)
              if (latest.stamp !== held.stamp || latest.cookie !== held.cookie || latest.origin !== held.origin ||
                  !isSourceCurrent(held.stamp)) throw unavailable()
              throw new McpStdioDefinitiveInspectionRefusal()
            } catch (error) {
              if (error instanceof McpStdioDefinitiveInspectionRefusal) throw error
              throw unavailable()
            } finally {
              // The response-level guard can reject before readJson acquires
              // its reader, so always release this bounded error body here.
              void response.body?.cancel().catch(() => {})
            }
          }
          void response.body?.cancel().catch(() => {})
          throw unavailable()
        }
        if (response.redirected) { void response.body?.cancel().catch(() => {}); throw unavailable() }
        void response.body?.cancel().catch(() => {})
        const receipt = await read(source.binding.connectionId, held, inner)
        if (!sameAudience(receipt.binding, source.binding) || receipt.connection.inspectionOperationId !== operationId ||
            receipt.binding.connectionRevision <= source.binding.connectionRevision) throw unavailable()
        return receipt
      }, signal)
    },
    close() { closed = true; for (const controller of active) controller.abort() },
  })
}
