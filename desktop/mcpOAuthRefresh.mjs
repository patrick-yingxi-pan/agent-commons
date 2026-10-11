/** Native credential lifecycle; no HTTP implementation or UI authority. The
 * host supplies a revision/account fence and a pinned single-request exchange.
 * A response (including 401) from a tool is never an invitation to replay it. */
import { isMcpBinding, isMcpCredentialReference } from './mcpCredentialProtocol.mjs'
import { createMcpOAuthRefreshRequest, parseMcpOAuthTokenResponse } from './mcpOAuthTokens.mjs'

const codes = ['stale', 'busy', 'timeout', 'cancelled', 'reauthorization']
export class McpOAuthRefreshError extends Error {
  constructor(code = 'reauthorization') {
    const safe = codes.includes(code) ? code : 'reauthorization'
    super(`The native OAuth credential is unavailable (${safe}).`)
    this.name = 'McpOAuthRefreshError'
    this.code = safe
  }
}
const fail = code => { throw new McpOAuthRefreshError(code) }
const checkCurrent = check => {
  let result
  try { result = typeof check === 'function' && check() } catch { fail('stale') }
  // A rejected async fence must not escape as an unhandled rejection. It never
  // grants authority: publication/dispatch requires synchronous current truth.
  if (result instanceof Promise) result.catch(() => {})
  if (result !== true) fail('stale')
}
const normalize = error => error instanceof McpOAuthRefreshError ? error : new McpOAuthRefreshError()

export function createMcpOAuthRefreshManager({ vault, exchange, now = Date.now, timeoutMs = 30_000, maxPending = 8 }) {
  if (!vault || typeof exchange !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 64) fail('reauthorization')
  const active = new Map()
  let closed = false
  let waiters = 0
  const timestamp = () => {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) fail('reauthorization')
    return value
  }
  const begin = (reference, binding, ownerId, identity, isCurrent) => {
    const controller = new AbortController()
    const entry = { identity, stop: undefined, promise: undefined }
    let stopped
    let ticket
    let rejectCancellation
    const started = performance.now()
    const cancelled = new Promise((_, reject) => { rejectCancellation = reject })
    const fence = () => {
      if (!stopped && performance.now() - started >= timeoutMs) entry.stop('timeout')
      if (stopped) throw stopped
      if (closed) fail('cancelled')
      checkCurrent(isCurrent)
      return true
    }
    entry.stop = code => {
      if (stopped) return
      stopped = new McpOAuthRefreshError(code)
      controller.abort()
      if (ticket) vault.abandonOAuthRefresh(reference, ticket)
      rejectCancellation(stopped)
    }
    const timer = setTimeout(() => entry.stop('timeout'), timeoutMs)
    active.set(reference, entry)
    const work = Promise.resolve().then(async () => {
      fence()
      const record = await vault.readOAuth(reference, binding, ownerId)
      fence()
      if (record.state !== 'ready') fail('reauthorization')
      const grant = record.grant
      if (grant.expiresAt === null || grant.expiresAt > timestamp()) return grant.accessToken
      if (!grant.refreshToken) fail('reauthorization')
      const reserved = await vault.reserveOAuthRefresh(reference, binding, ownerId, record.generation, fence)
      ticket = reserved.ticket
      fence()
      const request = createMcpOAuthRefreshRequest(reserved.grant)
      let dispatches = 0
      const response = await exchange(request, {
        signal: controller.signal,
        isCurrent: fence,
        beforeDispatch() {
          fence()
          if (dispatches++ !== 0) fail('reauthorization')
        },
      })
      fence()
      if (dispatches !== 1) fail('reauthorization')
      const tokens = parseMcpOAuthTokenResponse(response, {
        reviewedScopes: reserved.grant.scopes, previousRefreshToken: reserved.grant.refreshToken, now: timestamp(),
      })
      if (tokens.expiresAt !== null && tokens.expiresAt <= timestamp()) fail('reauthorization')
      const refreshed = { ...reserved.grant, ...tokens }
      await vault.completeOAuthRefresh(reference, binding, ownerId, ticket, refreshed, fence)
      fence()
      // Disk work can outlast a valid but very short lifetime. Never hand out a
      // now-expired token or perform a second exchange in this operation.
      if (tokens.expiresAt !== null && tokens.expiresAt <= timestamp()) fail('reauthorization')
      return tokens.accessToken
    }).catch(error => { throw normalize(error) }).finally(() => {
      clearTimeout(timer)
      if (ticket) vault.abandonOAuthRefresh(reference, ticket)
      if (active.get(reference) === entry) active.delete(reference)
    })
    // Cancellation settles waiting callers promptly but retains capacity until
    // the actual disk/network operation settles. Late work cannot publish.
    entry.promise = Promise.race([work, cancelled])
    return entry
  }

  return {
    async resolve(reference, rawBinding, ownerId, { isCurrent, signal, connectionRevision } = {}) {
      try {
        if (closed || signal?.aborted) fail('cancelled')
        checkCurrent(isCurrent)
        if (!isMcpCredentialReference(reference) || !isMcpBinding(rawBinding) || typeof ownerId !== 'string' ||
            ownerId.length === 0 || ownerId.length > 256 || !/^[\x20-\x7e]+$/.test(ownerId)) fail('reauthorization')
        if (connectionRevision !== undefined && (!Number.isSafeInteger(connectionRevision) || connectionRevision < 0)) fail('reauthorization')
        const binding = Object.freeze({ tenantId: rawBinding.tenantId, connectionId: rawBinding.connectionId, endpoint: rawBinding.endpoint })
        const identity = JSON.stringify([binding.tenantId, binding.connectionId, binding.endpoint, ownerId, connectionRevision ?? null])
        if (waiters >= 64) fail('busy')
        let entry = active.get(reference)
        if (entry && entry.identity !== identity) fail('reauthorization')
        if (!entry) {
          if (active.size >= maxPending) fail('busy')
          entry = begin(reference, binding, ownerId, identity, isCurrent)
        }
        waiters++
        // Promise reactions cannot be detached when an individual waiter
        // aborts. Keep its slot until the shared promise settles, otherwise a
        // cancel/rejoin loop can accumulate unbounded retained subscriptions.
        entry.promise.then(() => { waiters-- }, () => { waiters-- })
        let abort
        try {
          const cancelled = new Promise((_, reject) => {
            abort = () => reject(new McpOAuthRefreshError('cancelled'))
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) abort()
          })
          const accessToken = await Promise.race([entry.promise, cancelled])
          if (closed || signal?.aborted) fail('cancelled')
          checkCurrent(isCurrent)
          return accessToken
        } finally {
          signal?.removeEventListener('abort', abort)
        }
      } catch (error) { throw normalize(error) }
    },
    cancel(reference) { active.get(reference)?.stop('cancelled') },
    close() {
      closed = true
      for (const entry of active.values()) entry.stop('cancelled')
    },
  }
}
