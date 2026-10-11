/** Native-only OAuth code/PKCE preparation. No network, browser, persistence or
 * tool authority is granted by this module. The host must bind the reviewed
 * facts to its current owner/connection revision before exchange and commit. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { oauthResourceUrl, oauthScopes, parseOAuthServerMetadata } from './mcpOAuthMetadata.mjs'

export const MCP_OAUTH_CALLBACK_PATH = '/oauth/callback'
export const MCP_OAUTH_AUTHORIZATION_TIMEOUT_MS = 180_000
export const MCP_OAUTH_MAX_CALLBACK_BYTES = 16_384
export class McpOAuthAuthorizationError extends Error {
  constructor(code) {
    super(`MCP authorization failed (${code}).`)
    this.name = 'McpOAuthAuthorizationError'
    this.code = code
  }
}
const fail = code => { throw new McpOAuthAuthorizationError(code) }
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value)
const opaque = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)
const RESERVED = new Set(['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'resource', 'code_challenge', 'code_challenge_method', 'response_mode'])

function redirect(value) {
  if (!text(value, 256)) fail('request')
  let url
  try { url = new URL(value) } catch { fail('request') }
  // Native callback permission is not permission to contact a loopback MCP
  // server. Use a separate ephemeral listener, never the product HTTP port.
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || value.includes('?') || value.includes('#') ||
      url.pathname !== MCP_OAUTH_CALLBACK_PATH || url.href !== value) fail('request')
  return value
}

function nonce(random) {
  const bytes = random(32)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) fail('request')
  return Buffer.from(bytes).toString('base64url')
}

export function createMcpOAuthAuthorization(parameters, {
  now = () => performance.now(), random = randomBytes,
  timeoutMs = MCP_OAUTH_AUTHORIZATION_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MCP_OAUTH_AUTHORIZATION_TIMEOUT_MS) fail('request')
  let server, resource, scopes, redirectUri, clientId, authorization
  try {
    server = parseOAuthServerMetadata(parameters.metadata, parameters.issuer)
    resource = oauthResourceUrl(parameters.resource)
    scopes = oauthScopes(parameters.scopes)
    redirectUri = redirect(parameters.redirectUri)
    clientId = parameters.clientId
    if (!opaque(clientId, 2_048)) fail('request')
    if (scopes.includes('offline_access') && !server.scopesSupported?.includes('offline_access')) fail('request')
    authorization = new URL(server.authorizationEndpoint)
    for (const key of authorization.searchParams.keys()) if (RESERVED.has(key)) fail('request')
  } catch { fail('request') }
  let verifier, state
  try { verifier = nonce(random); state = nonce(random) } catch { fail('request') }
  const started = now()
  if (!Number.isFinite(started)) fail('request')
  const query = authorization.searchParams
  query.set('response_type', 'code')
  query.set('client_id', clientId)
  query.set('redirect_uri', redirectUri)
  query.set('resource', resource)
  query.set('state', state)
  query.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  query.set('code_challenge_method', 'S256')
  if (scopes.length) query.set('scope', scopes.join(' '))
  const authorizationUrl = authorization.href
  let terminal = false
  const retire = () => { terminal = true; verifier = ''; state = '' }
  return Object.freeze({
    authorizationUrl,
    redirectUri,
    cancel: retire,
    /** Only native code may receive the code/verifier-bearing result. */
    receiveCallback(callbackUrl) {
      if (terminal) fail('used')
      const elapsed = now() - started
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= timeoutMs) { retire(); fail('expired') }
      if (!text(callbackUrl, MCP_OAUTH_MAX_CALLBACK_BYTES) || !callbackUrl.startsWith(`${redirectUri}?`) || callbackUrl.includes('#')) fail('request')
      let fields
      try {
        const rawQuery = callbackUrl.slice(redirectUri.length + 1)
        // URLSearchParams otherwise repairs invalid percent escapes/UTF-8.
        decodeURIComponent(rawQuery.replace(/\+/g, ' '))
        fields = new URLSearchParams(rawQuery)
      } catch { fail('request') }
      for (const key of ['state', 'iss', 'code', 'error', 'error_description', 'error_uri']) {
        if (fields.getAll(key).length > 1) fail('request')
      }
      const receivedState = fields.get('state') ?? ''
      const receivedBytes = Buffer.from(receivedState)
      const expectedBytes = Buffer.from(state)
      if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) fail('state')
      // An authenticated response consumes this transaction even when refused.
      // Never normalize the decoded issuer or expose upstream error prose.
      const codeVerifier = verifier
      retire()
      const issuer = fields.get('iss')
      if ((server.issuerParameterSupported && issuer === null) || (issuer !== null && issuer !== server.issuer)) fail('issuer')
      if (fields.has('error')) {
        if (fields.has('code')) fail('response')
        fail('denied')
      }
      const code = fields.get('code')
      if (!opaque(code, 8_192)) fail('response')
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code, client_id: clientId,
        redirect_uri: redirectUri, code_verifier: codeVerifier, resource,
      })
      // Required for offline_access when it was explicitly included in review.
      if (scopes.length) body.set('scope', scopes.join(' '))
      return Object.freeze({
        endpoint: server.tokenEndpoint, body: body.toString(),
        issuer: server.issuer, resource, clientId, scopes,
      })
    },
  })
}
