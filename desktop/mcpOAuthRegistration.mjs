/** Native public-client registration. Configuration is operator-owned and
 * issuer-specific; returned metadata never changes the reviewed token grant.
 * No client secret, registration-management token/URL or remote error leaves here. */
import { oauthHttpsUrl, oauthScopes, parseOAuthServerMetadata, snapshotOAuthJson } from './mcpOAuthMetadata.mjs'
import { mcpOAuthRedirectUri } from './mcpOAuthAuthorization.mjs'
import { parseOutboundEndpoint } from '../server/outboundAddressCore.mjs'

const CODES = ['request', 'configuration', 'client-required', 'response', 'stale', 'cancelled', 'unavailable']
export class McpOAuthRegistrationError extends Error {
  constructor(code = 'request', mayHaveRegistered = false) {
    const safe = CODES.includes(code) ? code : 'request'
    super(`OAuth client registration failed (${safe}).`)
    this.name = 'McpOAuthRegistrationError'
    this.code = safe
    this.mayHaveRegistered = mayHaveRegistered === true
  }
}
const fail = code => { throw new McpOAuthRegistrationError(code) }
const clientId = value => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048 || !/^[\x20-\x7e]+$/.test(value)) fail('request')
  return value
}
const record = (value, allowed, required = allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('request')
  return value
}

/** No default URL is invented. Syntax admission here is not a DNS fetch; the
 * authorization server fetches a configured public Client ID Metadata Document. */
export function snapshotMcpOAuthClientConfiguration(raw = {}) {
  try {
    const value = record(snapshotOAuthJson(raw), ['preRegistered', 'clientMetadataUrl'], [])
    const entries = value.preRegistered ?? []
    if (!Array.isArray(entries) || entries.length > 64) fail('configuration')
    const seen = new Set()
    const preRegistered = entries.map(item => {
      record(item, ['issuer', 'clientId'])
      const issuer = oauthHttpsUrl(item.issuer, { issuer: true })
      if (seen.has(issuer)) fail('configuration')
      seen.add(issuer)
      return Object.freeze({ issuer, clientId: clientId(item.clientId) })
    })
    let clientMetadataUrl
    if (Object.hasOwn(value, 'clientMetadataUrl')) {
      clientMetadataUrl = oauthHttpsUrl(value.clientMetadataUrl)
      const url = parseOutboundEndpoint(clientMetadataUrl, 'public')
      if (url.pathname === '/') fail('configuration')
    }
    return Object.freeze({ preRegistered: Object.freeze(preRegistered), ...(clientMetadataUrl ? { clientMetadataUrl } : {}) })
  } catch { fail('configuration') }
}

/** Choose once from validated server capabilities, never downgrade on a failed
 * registration/authorization attempt. A user-supplied ID is scoped by the host
 * to this exact issuer, not a global fallback for arbitrary servers. */
export function selectMcpOAuthClient({ issuer, metadata, configuration = {} }) {
  try {
    const document = snapshotOAuthJson(metadata)
    const server = parseOAuthServerMetadata(document, issuer)
    const config = snapshotMcpOAuthClientConfiguration(configuration)
    const known = config.preRegistered.find(entry => entry.issuer === issuer)
    if (known) return Object.freeze({ method: 'pre-registered', issuer, clientId: known.clientId })
    if (server.supportsClientMetadata && config.clientMetadataUrl) {
      return Object.freeze({ method: 'metadata', issuer, clientId: config.clientMetadataUrl })
    }
    if (server.registrationEndpoint) return Object.freeze({ method: 'dynamic', issuer,
      endpoint: server.registrationEndpoint, refresh: document.grant_types_supported?.includes('refresh_token') === true })
    fail('client-required')
  } catch (error) {
    if (error instanceof McpOAuthRegistrationError) throw error
    fail('request')
  }
}

/** Closed native request, revalidated by the HTTP boundary before dispatch. */
export function createMcpOAuthRegistrationRequest(raw) {
  try {
    const value = record(snapshotOAuthJson(raw), ['endpoint', 'redirectUri', 'scopes', 'refresh'])
    const endpoint = oauthHttpsUrl(value.endpoint)
    const redirectUri = mcpOAuthRedirectUri(value.redirectUri)
    const scopes = oauthScopes(value.scopes)
    if (typeof value.refresh !== 'boolean') fail('request')
    const metadata = {
      client_name: 'Agent Commons', application_type: 'native',
      redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', ...(value.refresh ? ['refresh_token'] : [])],
      response_types: ['code'], ...(scopes.length ? { scope: scopes.join(' ') } : {}),
    }
    return Object.freeze({ endpoint, redirectUri, scopes, refresh: value.refresh, body: JSON.stringify(metadata) })
  } catch { fail('request') }
}

/** RFC 7591 echoes the actual registered metadata. Public-native/code and the
 * exact bound redirect must survive that negotiation. Ignore unrelated fields,
 * but refuse a confidential-client upgrade or changed registration semantics. */
export function parseMcpOAuthRegistrationResponse(raw, request) {
  try {
    const document = snapshotOAuthJson(raw)
    if (!document || typeof document !== 'object' || Array.isArray(document)) fail('response')
    const expected = createMcpOAuthRegistrationRequest({ endpoint: request.endpoint, redirectUri: request.redirectUri,
      scopes: request.scopes, refresh: request.refresh })
    if (document.token_endpoint_auth_method !== 'none' || document.application_type !== 'native' ||
        Object.hasOwn(document, 'client_secret') || Object.hasOwn(document, 'client_secret_expires_at') ||
        !Array.isArray(document.redirect_uris) || document.redirect_uris.length !== 1 || document.redirect_uris[0] !== expected.redirectUri ||
        !Array.isArray(document.response_types) || document.response_types.length !== 1 || document.response_types[0] !== 'code' ||
        !Array.isArray(document.grant_types) || document.grant_types.length < 1 || document.grant_types.length > 2 ||
        new Set(document.grant_types).size !== document.grant_types.length || !document.grant_types.includes('authorization_code') ||
        document.grant_types.some(type => type !== 'authorization_code' && type !== 'refresh_token') ||
        document.grant_types.includes('refresh_token') !== expected.refresh) fail('response')
    if (document.scope !== undefined) {
      const scopes = oauthScopes(typeof document.scope === 'string' ? document.scope.split(' ') : null)
      if (expected.scopes.some(scope => !scopes.includes(scope))) fail('response')
    }
    return clientId(document.client_id)
  } catch { fail('response') }
}

/** Perform at most one DCR POST after explicit native flow consent. No cache of
 * global client IDs, fallback after failure, secret retention or automatic retry. */
export async function registerMcpOAuthClient({ http, plan, redirectUri, scopes }, options = {}) {
  let submitted = false
  const fence = () => {
    if (options.signal?.aborted) fail('cancelled')
    const current = options.isCurrent?.()
    if (current instanceof Promise) current.catch(() => {})
    if (current !== true) fail('stale')
  }
  try {
    const selected = snapshotOAuthJson(plan)
    mcpOAuthRedirectUri(redirectUri)
    const reviewed = oauthScopes(scopes)
    oauthHttpsUrl(selected.issuer, { issuer: true })
    fence()
    if (['pre-registered', 'metadata'].includes(selected.method)) {
      record(selected, ['method', 'issuer', 'clientId'])
      return Object.freeze({ clientId: clientId(selected.clientId), method: selected.method })
    }
    record(selected, ['method', 'issuer', 'endpoint', 'refresh'])
    if (selected.method !== 'dynamic' || !http || typeof http.register !== 'function') fail('request')
    const request = createMcpOAuthRegistrationRequest({ endpoint: selected.endpoint, redirectUri, scopes: reviewed, refresh: selected.refresh })
    const document = await http.register(request, { ...options, beforeDispatch() {
      fence()
      if (submitted) fail('request')
      submitted = true
    } })
    fence()
    if (!submitted) fail('response')
    return Object.freeze({ clientId: parseMcpOAuthRegistrationResponse(document, request), method: 'dynamic' })
  } catch (error) {
    // beforeDispatch runs before socket construction, so uncertainty here is
    // intentionally conservative. Registration failure never becomes a retry.
    throw new McpOAuthRegistrationError(error instanceof McpOAuthRegistrationError ? error.code : 'unavailable', submitted)
  }
}
