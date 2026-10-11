/** Native-only OAuth I/O. No renderer bridge, ambient credentials, redirects,
 * retries or private-network scope. Every request retains a pinned public DNS
 * answer and the original TLS hostname. Custody/consent remain caller-owned. */
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPublicAddress, parseOutboundEndpoint } from '../server/outboundAddressCore.mjs'
import { MCP_MODERN_VERSION, mcpRequestMetadata } from '../server/mcpProtocolCore.mjs'
import { oauthHttpsUrl, oauthResourceUrl, oauthScopes, snapshotOAuthJson } from './mcpOAuthMetadata.mjs'
import { parseMcpOAuthChallenge } from './mcpOAuthChallenge.mjs'
import { createMcpOAuthRegistrationRequest } from './mcpOAuthRegistration.mjs'

const MAX_BODY_BYTES = 65_536
const CODES = ['destination', 'request', 'timeout', 'cancelled', 'stale', 'network', 'response', 'redirect', 'http', 'busy']
export class McpOAuthHttpError extends Error {
  constructor(code = 'request', mayHaveSubmitted = false, status) {
    const safe = CODES.includes(code) ? code : 'request'
    super(`The OAuth request failed (${safe}).`)
    this.name = 'McpOAuthHttpError'
    this.code = safe
    this.mayHaveSubmitted = mayHaveSubmitted === true
    if (Number.isInteger(status) && status >= 100 && status <= 599) this.status = status
  }
}
const fail = code => { throw new McpOAuthHttpError(code) }
const synchronous = callback => {
  const result = callback()
  if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') {
    void Promise.resolve(result).catch(() => {})
    fail('request')
  }
  return result
}

/** Re-admit only the exact prepared public-client token form. No arbitrary
 * headers, client secrets, bearer credentials or request methods are accepted. */
function exchangeInput(raw) {
  const value = snapshotOAuthJson(raw)
  const keys = ['endpoint', 'body', 'issuer', 'resource', 'clientId', 'scopes']
  if (!value || typeof value !== 'object' || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) fail('request')
  oauthHttpsUrl(value.issuer, { issuer: true })
  oauthHttpsUrl(value.endpoint)
  if (oauthResourceUrl(value.resource) !== value.resource || typeof value.clientId !== 'string' || !value.clientId.length ||
      value.clientId.length > 2_048 || !/^[\x20-\x7e]+$/.test(value.clientId) || typeof value.body !== 'string' ||
      value.body.length > MAX_BODY_BYTES || !/^[\x21-\x7e]+$/.test(value.body)) fail('request')
  const scopes = oauthScopes(value.scopes)
  const form = new URLSearchParams(value.body)
  const fields = [...form.keys()]
  const code = form.get('grant_type') === 'authorization_code'
  const required = code ? ['grant_type', 'code', 'client_id', 'redirect_uri', 'code_verifier', 'resource'] : ['grant_type', 'refresh_token', 'client_id', 'resource']
  if ((!code && form.get('grant_type') !== 'refresh_token') || new Set(fields).size !== fields.length ||
      fields.some(key => ![...required, 'scope'].includes(key)) || required.some(key => !form.get(key)) ||
      form.toString() !== value.body || form.get('client_id') !== value.clientId || form.get('resource') !== value.resource ||
      (form.get('scope') ?? '') !== scopes.join(' ')) fail('request')
  return value
}

/** Dependency injection is test-only; production uses system DNS and HTTPS.
 * A timed-out resolver or destroyed-but-unclosed socket retains its slot. */
export function createMcpOAuthHttp({ resolve = host => lookup(host, { all: true, verbatim: true }), request = httpsRequest, maxPending = 8 } = {}) {
  if (typeof resolve !== 'function' || typeof request !== 'function' || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 64) fail('request')
  const active = new Set()
  let closed = false

  const perform = (endpoint, body, kind, rawOptions = {}) => {
    let url, options, timeoutMs
    try {
      options = { ...rawOptions }
      if (Object.keys(options).some(key => !['isCurrent', 'beforeDispatch', 'signal', 'timeoutMs'].includes(key)) ||
          typeof options.isCurrent !== 'function' || (['exchange', 'registration'].includes(kind) && typeof options.beforeDispatch !== 'function')) fail('request')
      timeoutMs = options.timeoutMs ?? 10_000
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail('request')
      if (closed || options.signal?.aborted) fail('cancelled')
      if (synchronous(options.isCurrent) !== true) fail('stale')
      try { oauthHttpsUrl(endpoint); url = parseOutboundEndpoint(endpoint, 'public') } catch { fail('destination') }
      if (active.size >= maxPending) fail('busy')
    } catch (error) { return Promise.reject(error instanceof McpOAuthHttpError ? error : new McpOAuthHttpError()) }

    return new Promise((fulfill, reject) => {
      const started = performance.now()
      let settled = false, submitted = false, dnsDone = false, socketClosed = true
      let outgoing, incoming, status
      const entry = { cancel: () => finish('cancelled') }
      active.add(entry)
      const release = () => { if (dnsDone && socketClosed) active.delete(entry) }
      const finish = (code, result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        incoming?.destroy()
        outgoing?.destroy()
        release()
        if (code) reject(new McpOAuthHttpError(code, submitted, status))
        else fulfill(result)
      }
      const fence = () => {
        if (settled) return false
        if (performance.now() - started >= timeoutMs) { finish('timeout'); return false }
        if (closed || options.signal?.aborted) { finish('cancelled'); return false }
        try { if (synchronous(options.isCurrent) !== true) throw new Error() }
        catch { finish('stale'); return false }
        return true
      }
      const abort = () => finish('cancelled')
      const timer = setTimeout(() => finish('timeout'), timeoutMs)
      options.signal?.addEventListener('abort', abort, { once: true })
      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      void Promise.resolve().then(async () => {
        try {
          if (!fence()) return
          const literalFamily = isIP(hostname)
          const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolve(hostname)
          dnsDone = true
          if (!fence()) return
          if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(row =>
            !row || ![4, 6].includes(row.family) || isIP(row.address) !== row.family || !isPublicAddress(row.address))) { finish('destination'); return }
          const { address, family } = addresses[0]
          const headers = { Accept: 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' }
          if (body !== undefined) {
            headers['Content-Type'] = kind === 'exchange' ? 'application/x-www-form-urlencoded' : 'application/json'
            headers['Content-Length'] = String(Buffer.byteLength(body))
          }
          if (kind === 'probe') {
            headers.Accept = 'application/json, text/event-stream'
            headers['MCP-Protocol-Version'] = MCP_MODERN_VERSION
            headers['Mcp-Method'] = 'server/discover'
          }
          if (options.beforeDispatch) {
            try { synchronous(options.beforeDispatch) } catch { finish('stale'); return }
          }
          if (!fence()) return
          outgoing = request(url, {
            method: body === undefined ? 'GET' : 'POST', headers, agent: false,
            autoSelectFamily: false, family, maxHeaderSize: 16_384,
            rejectUnauthorized: true,
            lookup: (_host, _options, callback) => callback(null, address, family),
          }, response => {
            incoming = response
            response.on('error', () => finish('network'))
            response.on('aborted', () => finish('network'))
            response.on('close', () => { if (!response.complete) finish('network') })
            if (!fence()) { response.destroy(); return }
            status = response.statusCode
            if (!Number.isInteger(status) || status < 200 || status > 599) { finish('response'); return }
            if (status >= 300 && status < 400) { finish('redirect'); return }
            if (kind === 'probe') {
              if (![200, 400, 401, 403, 404, 405, 406, 415].includes(status)) { finish('http'); return }
              try { finish(undefined, Object.freeze({ status, challenge: parseMcpOAuthChallenge(status === 401 ? response.headers['www-authenticate'] : undefined) })) }
              catch { finish('response') }
              return
            }
            if (status !== (kind === 'registration' ? 201 : 200)) { finish('http'); return }
            const encoding = response.headers['content-encoding']
            const type = response.headers['content-type']
            const length = response.headers['content-length']
            if ((encoding !== undefined && encoding !== 'identity') || typeof type !== 'string' ||
                !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type) ||
                (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))) { finish('response'); return }
            let bytes = 0
            const chunks = []
            response.on('data', chunk => {
              if (!fence()) return
              bytes += chunk.byteLength
              if (bytes > MAX_BODY_BYTES) { finish('response'); return }
              chunks.push(Buffer.from(chunk))
            })
            response.on('end', () => {
              if (!fence()) return
              try {
                if (!response.complete) throw new Error()
                const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
                const document = snapshotOAuthJson(JSON.parse(text))
                if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error()
                if (fence()) finish(undefined, { document, byteLength: bytes })
              } catch { finish('response') }
            })
          })
          socketClosed = false
          outgoing.on('close', () => { socketClosed = true; release(); if (!settled) finish('network') })
          outgoing.on('error', () => finish('network'))
          outgoing.on('upgrade', (_response, socket) => { socket.destroy(); finish('response') })
          if (!fence()) return
          submitted = body !== undefined
          outgoing.end(body)
        } catch { finish('network') }
        finally { dnsDone = true; release() }
      })
    })
  }

  return Object.freeze({
    getMetadata(endpoint, options) { return perform(endpoint, undefined, 'metadata', options) },
    probe(endpoint, options) {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 'oauth-discovery', method: 'server/discover', params: mcpRequestMetadata(MCP_MODERN_VERSION) })
      return perform(endpoint, body, 'probe', options)
    },
    async exchange(raw, options) {
      let input
      try { input = exchangeInput(raw) } catch { fail('request') }
      return (await perform(input.endpoint, input.body, 'exchange', options)).document
    },
    async register(raw, options) {
      let input
      try {
        const value = snapshotOAuthJson(raw)
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5 ||
            !['endpoint', 'redirectUri', 'scopes', 'refresh', 'body'].every(key => Object.hasOwn(value, key))) fail('request')
        input = createMcpOAuthRegistrationRequest({ endpoint: value.endpoint, redirectUri: value.redirectUri,
          scopes: value.scopes, refresh: value.refresh })
        if (input.body !== value.body) fail('request')
      } catch { fail('request') }
      return (await perform(input.endpoint, input.body, 'registration', options)).document
    },
    close() { closed = true; for (const entry of active) entry.cancel() },
  })
}
