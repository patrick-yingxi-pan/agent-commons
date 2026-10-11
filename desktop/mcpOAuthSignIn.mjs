/** One native sign-in transaction, from an already held/reviewed discovery
 * snapshot through registration, external browser, callback and device custody.
 * This does not install IPC or commit a product connection. The host owns the
 * account/revision fence and retains the provisional reference until exact ack. */
import { openMcpOAuthCallback } from './mcpOAuthCallback.mjs'
import { oauthResourceUrl, oauthScopes, parseOAuthServerMetadata, snapshotOAuthJson } from './mcpOAuthMetadata.mjs'
import { selectMcpOAuthClient, registerMcpOAuthClient, snapshotMcpOAuthClientConfiguration } from './mcpOAuthRegistration.mjs'
import { parseMcpOAuthTokenResponse } from './mcpOAuthTokens.mjs'
import { isMcpBinding } from './mcpCredentialProtocol.mjs'
import { parseOutboundEndpoint } from '../server/outboundAddressCore.mjs'

const CODES = ['request', 'busy', 'stale', 'cancelled', 'timeout', 'client-required', 'denied', 'unavailable']
export class McpOAuthSignInError extends Error {
  constructor(code = 'unavailable') {
    const safe = CODES.includes(code) ? code : 'unavailable'
    super(`MCP sign-in could not be completed (${safe}).`)
    this.name = 'McpOAuthSignInError'
    this.code = safe
  }
}
const fail = code => { throw new McpOAuthSignInError(code) }
const current = isCurrent => {
  const result = typeof isCurrent === 'function' && isCurrent()
  if (result instanceof Promise) result.catch(() => {})
  if (result !== true) fail('stale')
}

export function createMcpOAuthSignIn({ http, vault, openBrowser, configuration = {},
  openCallback = openMcpOAuthCallback, now = Date.now, timeoutMs = 180_000, maxPending = 8 }) {
  if (!http || typeof http.exchange !== 'function' || !vault || typeof vault.provisionOAuth !== 'function' ||
      typeof vault.discard !== 'function' || typeof openBrowser !== 'function' || typeof openCallback !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 64) fail('request')
  const config = snapshotMcpOAuthClientConfiguration(configuration)
  const active = new Map()
  let closed = false
  const timestamp = () => {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) fail('request')
    return value
  }
  return Object.freeze({
    async authorize(raw, { isCurrent, signal } = {}) {
      let input, server, scopes, plan, key
      try {
        if (closed || signal?.aborted) fail('cancelled')
        current(isCurrent)
        input = snapshotOAuthJson(raw)
        if (!input || Object.keys(input).sort().join(',') !== 'binding,issuer,metadata,ownerId,scopes' || !isMcpBinding(input.binding) ||
            typeof input.ownerId !== 'string' || !/^[\x20-\x7e]{1,256}$/.test(input.ownerId)) fail('request')
        parseOutboundEndpoint(input.binding.endpoint, 'public')
        server = parseOAuthServerMetadata(input.metadata, input.issuer)
        // The system browser owns its DNS/TLS and navigation. This is syntax
        // admission only, not a claim that browser sockets can be pinned.
        parseOutboundEndpoint(server.authorizationEndpoint, 'public')
        scopes = oauthScopes(input.scopes)
        plan = selectMcpOAuthClient({ issuer: input.issuer, metadata: input.metadata, configuration: config })
        key = JSON.stringify([input.binding.tenantId, input.binding.connectionId])
        if (active.has(key) || active.size >= maxPending) fail('busy')
      } catch (error) {
        if (error instanceof McpOAuthSignInError) throw error
        throw new McpOAuthSignInError(error?.code === 'client-required' ? 'client-required' : 'request')
      }
      const controller = new AbortController()
      const started = performance.now()
      let stopped, callback, preparationWork, reference, published = false, rejectStopped
      const cancellation = new Promise((_, reject) => { rejectStopped = reject })
      const stop = code => {
        if (stopped) return
        stopped = new McpOAuthSignInError(code)
        controller.abort()
        callback?.cancel()
        rejectStopped(stopped)
      }
      const fence = () => {
        if (!stopped && performance.now() - started >= timeoutMs) stop('timeout')
        if (stopped) throw stopped
        if (closed || signal?.aborted) fail('cancelled')
        current(isCurrent)
        return true
      }
      const entry = { stop }
      active.set(key, entry)
      const abort = () => stop('cancelled')
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => stop('timeout'), timeoutMs)
      const work = Promise.resolve().then(async () => {
        fence()
        let registration
        callback = await openCallback(({ redirectUri, signal: callbackSignal }) => {
          preparationWork = (async () => {
            fence()
            registration = await registerMcpOAuthClient({ http, plan, redirectUri, scopes }, { signal: callbackSignal, isCurrent: fence })
            fence()
            return { issuer: server.issuer, metadata: input.metadata, clientId: registration.clientId,
              resource: oauthResourceUrl(input.binding.endpoint), scopes }
          })()
          void preparationWork.catch(() => {})
          return preparationWork
        }, { signal: controller.signal, timeoutMs: Math.max(1, Math.floor(timeoutMs - (performance.now() - started))) })
        fence()
        await openBrowser(callback.authorizationUrl)
        fence()
        const request = await callback.result
        fence()
        let dispatched = false
        const response = await http.exchange(request, { signal: controller.signal, isCurrent: fence, beforeDispatch() {
          fence()
          if (dispatched) fail('unavailable')
          dispatched = true
        } })
        fence()
        if (!dispatched) fail('unavailable')
        const tokens = parseMcpOAuthTokenResponse(response, { reviewedScopes: scopes, now: timestamp() })
        if (tokens.expiresAt !== null && tokens.expiresAt <= timestamp()) fail('unavailable')
        const grant = { issuer: server.issuer, tokenEndpoint: server.tokenEndpoint, clientId: registration.clientId,
          resource: oauthResourceUrl(input.binding.endpoint), ...tokens }
        reference = await vault.provisionOAuth(input.binding, input.ownerId, grant, fence)
        fence()
        if (tokens.expiresAt !== null && tokens.expiresAt <= timestamp()) fail('unavailable')
        // No token, authorization URL, callback port, code or verifier crosses
        // this result. Product acknowledgement/cleanup remains a host duty.
        published = true
        return Object.freeze({ reference, issuer: server.issuer, scopes: tokens.scopes, expiresAt: tokens.expiresAt })
      }).catch(error => {
        // Callback failure can precede the outer timer. Publish the terminal
        // outcome before cleanup waits for still-running preparation.
        const failure = error instanceof McpOAuthSignInError ? error : new McpOAuthSignInError(
          error?.code === 'denied' ? 'denied' : error?.code === 'expired' ? 'timeout' : 'unavailable')
        stop(failure.code)
        throw stopped
      }).finally(async () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        controller.abort()
        callback?.cancel()
        // The real callback rejects readiness promptly on cancellation, before
        // an abort-ignoring registration factory necessarily settles. Keep its
        // connection/capacity reservation until that separate work drains.
        await preparationWork?.catch(() => {})
        // This reference has never reached product commit. A cleanup failure
        // leaves an encrypted orphan for startup reconciliation, never replay.
        if (reference && !published) await vault.discard(reference, input.binding).catch(() => {})
        if (active.get(key) === entry) active.delete(key)
      })
      return Promise.race([work, cancellation])
    },
    close() { closed = true; for (const entry of active.values()) entry.stop('cancelled') },
  })
}
