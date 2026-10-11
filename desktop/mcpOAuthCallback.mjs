/** One short-lived native loopback receiver. This does not open a browser or
 * exchange a token. No code, state, verifier or remote error is rendered. */
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import {
  createMcpOAuthAuthorization, McpOAuthAuthorizationError,
  MCP_OAUTH_AUTHORIZATION_TIMEOUT_MS, MCP_OAUTH_CALLBACK_PATH,
  MCP_OAUTH_MAX_CALLBACK_BYTES,
} from './mcpOAuthAuthorization.mjs'

export function openMcpOAuthCallback(parameters, { signal, timeoutMs = MCP_OAUTH_AUTHORIZATION_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MCP_OAUTH_AUTHORIZATION_TIMEOUT_MS) {
    return Promise.reject(new McpOAuthAuthorizationError('request'))
  }
  if (signal?.aborted) return Promise.reject(new McpOAuthAuthorizationError('cancelled'))
  const deadlineAt = performance.now() + timeoutMs
  return new Promise((ready, rejectReady) => {
    let attempt, host, finished = false, readyPublished = false
    const preparation = new AbortController()
    let resolveResult, rejectResult
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    // The native caller may not attach its result handler until after opening
    // the browser. A cancellation in between must still be observed safely.
    void result.catch(() => {})
    const server = createServer({ maxHeaderSize: MCP_OAUTH_MAX_CALLBACK_BYTES }, (request, response) => {
      const respond = (status, message, after) => {
        response.writeHead(status, {
          'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Connection: 'close',
        })
        response.end(message, after)
      }
      if (finished || !attempt) return respond(410, 'Authorization is no longer pending.')
      if (request.method !== 'GET' || request.headers.host !== host || request.headers.origin !== undefined ||
          request.headers['transfer-encoding'] !== undefined ||
          (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0') ||
          typeof request.url !== 'string' || !request.url.startsWith(`${MCP_OAUTH_CALLBACK_PATH}?`)) {
        return respond(400, 'This request cannot complete authorization.')
      }
      try {
        const tokenRequest = attempt.receiveCallback(`http://${host}${request.url}`)
        // Reserve completion synchronously before another callback is handled.
        finished = true
        respond(200, 'Authorization response received. Return to Agent Commons.', () => finish(undefined, tokenRequest))
      } catch (error) {
        const code = error instanceof McpOAuthAuthorizationError ? error.code : 'response'
        if (code === 'request' || code === 'state') return respond(400, 'This request cannot complete authorization.')
        finished = true
        respond(400, 'Authorization could not be completed. Return to Agent Commons.', () => finish(new McpOAuthAuthorizationError(code)))
      }
    })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      preparation.abort()
      attempt?.cancel()
      server.close()
      server.closeAllConnections()
      if (error) { rejectResult(error); if (!readyPublished) rejectReady(error) }
      else resolveResult(value)
    }
    const cancel = () => finish(new McpOAuthAuthorizationError('cancelled'))
    const timer = setTimeout(() => finish(new McpOAuthAuthorizationError('expired')), timeoutMs)
    const remainingMs = () => Math.ceil(deadlineAt - performance.now())
    signal?.addEventListener('abort', cancel, { once: true })
    server.maxConnections = 8
    server.maxRequestsPerSocket = 1
    server.requestTimeout = Math.min(timeoutMs, 10_000)
    server.headersTimeout = Math.min(timeoutMs, 5_000)
    server.setTimeout(Math.min(timeoutMs, 5_000), socket => socket.destroy())
    server.on('error', () => finish(new McpOAuthAuthorizationError('unavailable')))
    server.on('clientError', (_error, socket) => socket.destroy())
    server.listen(0, '127.0.0.1', () => {
      if (settled) { server.close(); return }
      const address = server.address()
      if (!address || typeof address === 'string') return finish(new McpOAuthAuthorizationError('unavailable'))
      host = `127.0.0.1:${address.port}`
      const redirectUri = `http://${host}${MCP_OAUTH_CALLBACK_PATH}`
      const publish = prepared => {
        if (settled) return
        const remaining = remainingMs()
        if (remaining <= 0) return finish(new McpOAuthAuthorizationError('expired'))
        try {
          attempt = createMcpOAuthAuthorization({ ...prepared, redirectUri }, { timeoutMs: Math.max(1, remaining) })
        } catch { return finish(new McpOAuthAuthorizationError('request')) }
        if (settled) return
        if (remainingMs() <= 0) return finish(new McpOAuthAuthorizationError('expired'))
        readyPublished = true
        ready(Object.freeze({ authorizationUrl: attempt.authorizationUrl, redirectUri: attempt.redirectUri, result, cancel }))
      }
      if (typeof parameters === 'function') {
        void Promise.resolve().then(async () => {
          if (settled) return
          if (remainingMs() <= 0) return finish(new McpOAuthAuthorizationError('expired'))
          try {
            const prepared = await parameters(Object.freeze({ redirectUri, signal: preparation.signal }))
            if (settled) return
            publish(prepared)
          } catch { finish(new McpOAuthAuthorizationError('request')) }
        })
      } else publish(parameters)
    })
  })
}
