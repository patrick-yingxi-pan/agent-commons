/** Native-only token response validation. Tokens stay opaque: this does not
 * interpret ID tokens/JWTs, persist a grant, refresh it, or authorize a tool. */
import { oauthHttpsUrl, oauthResourceUrl, oauthScopes, snapshotOAuthJson } from './mcpOAuthMetadata.mjs'

export class McpOAuthTokenError extends Error {
  constructor() { super('The OAuth token response or grant is invalid.'); this.name = 'McpOAuthTokenError' }
}
const fail = () => { throw new McpOAuthTokenError() }
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 8_192 && /^[\x21-\x7e]+$/.test(value)

/** A missing expiry remains unknown, never an invented lifetime. A missing
 * refreshed token retains the current one; a rotated token replaces it only
 * after the caller durably publishes the complete returned bundle. */
export function parseMcpOAuthTokenResponse(raw, { reviewedScopes, previousRefreshToken, now = Date.now() }) {
  try {
    const document = snapshotOAuthJson(raw)
    const reviewed = oauthScopes(reviewedScopes)
    if (!document || typeof document !== 'object' || Array.isArray(document) || Object.hasOwn(document, 'error') ||
        !secret(document.access_token) || typeof document.token_type !== 'string' || document.token_type.toLowerCase() !== 'bearer' ||
        !Number.isSafeInteger(now) || now < 0) fail()
    const scopes = document.scope === undefined ? reviewed : oauthScopes(typeof document.scope === 'string' ? document.scope.split(' ') : null)
    if (scopes.some(scope => !reviewed.includes(scope))) fail()
    if (previousRefreshToken !== undefined && !secret(previousRefreshToken)) fail()
    if (document.refresh_token !== undefined && !secret(document.refresh_token)) fail()
    const refreshToken = document.refresh_token ?? previousRefreshToken
    let expiresAt = null
    if (document.expires_in !== undefined) {
      if (!Number.isSafeInteger(document.expires_in) || document.expires_in < 0) fail()
      expiresAt = now + document.expires_in * 1_000
      if (!Number.isSafeInteger(expiresAt)) fail()
    }
    return Object.freeze({
      accessToken: document.access_token, scopes, expiresAt,
      ...(refreshToken === undefined ? {} : { refreshToken }),
    })
  } catch { fail() }
}

/** This creates a single exact form, not permission or retry logic. The native
 * vault owner must serialize refresh, durably reserve before dispatch, refuse
 * uncertain replay, and compare the original binding before publication. */
export function createMcpOAuthRefreshRequest(raw) {
  try {
    const grant = snapshotOAuthJson(raw)
    const issuer = oauthHttpsUrl(grant.issuer, { issuer: true })
    const endpoint = oauthHttpsUrl(grant.tokenEndpoint)
    const resource = oauthResourceUrl(grant.resource)
    const scopes = oauthScopes(grant.scopes)
    if (!secret(grant.refreshToken) || typeof grant.clientId !== 'string' || grant.clientId.length === 0 ||
        grant.clientId.length > 2_048 || !/^[\x21-\x7e]+$/.test(grant.clientId)) fail()
    const body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: grant.refreshToken, client_id: grant.clientId, resource,
    })
    if (scopes.length) body.set('scope', scopes.join(' '))
    return Object.freeze({ endpoint, body: body.toString(), issuer, resource, clientId: grant.clientId, scopes })
  } catch { fail() }
}
