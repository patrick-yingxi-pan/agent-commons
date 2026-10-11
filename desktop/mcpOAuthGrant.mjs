/** Pure, detached validation for native-only MCP OAuth credential custody.
 * This module performs no I/O and grants no endpoint/network authority. */
import { oauthHttpsUrl, oauthResourceUrl, oauthScopes, snapshotOAuthJson } from './mcpOAuthMetadata.mjs'

export class McpOAuthGrantError extends Error {
  constructor() { super('The MCP OAuth grant is invalid.'); this.name = 'McpOAuthGrantError'; this.code = 'invalid' }
}

const fail = () => { throw new McpOAuthGrantError() }
const authorityKeys = ['issuer', 'tokenEndpoint', 'clientId', 'resource', 'scopes']
const grantKeys = ['issuer', 'tokenEndpoint', 'clientId', 'resource', 'scopes', 'accessToken', 'expiresAt', 'refreshToken']
const vschar = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)
const bearer = value => typeof value === 'string' && value.length > 0 && value.length <= 8_192 && /^[\x21-\x7e]+$/.test(value)

function exactObject(raw, allowed, required) {
  const value = snapshotOAuthJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const keys = Object.keys(value)
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail()
  return value
}

function validateAuthority(value) {
  if (typeof value.issuer !== 'string' || oauthHttpsUrl(value.issuer, { issuer: true }) !== value.issuer ||
      typeof value.tokenEndpoint !== 'string' || oauthHttpsUrl(value.tokenEndpoint) !== value.tokenEndpoint ||
      !vschar(value.clientId, 2_048) || typeof value.resource !== 'string' ||
      oauthResourceUrl(value.resource) !== value.resource) fail()
  const scopes = oauthScopes(value.scopes)
  return Object.freeze({
    issuer: value.issuer,
    tokenEndpoint: value.tokenEndpoint,
    clientId: value.clientId,
    resource: value.resource,
    scopes,
  })
}

/** Validate and detach an exact grant record suitable for native custody. */
export function snapshotMcpOAuthGrant(raw) {
  try {
    const value = exactObject(raw, grantKeys, grantKeys.filter(key => key !== 'refreshToken'))
    const authority = validateAuthority(value)
    if (!bearer(value.accessToken) || !(value.expiresAt === null || (Number.isSafeInteger(value.expiresAt) && value.expiresAt >= 0)) ||
        (Object.hasOwn(value, 'refreshToken') && !vschar(value.refreshToken, 8_192))) fail()
    return Object.freeze({
      ...authority,
      accessToken: value.accessToken,
      expiresAt: value.expiresAt,
      ...(Object.hasOwn(value, 'refreshToken') ? { refreshToken: value.refreshToken } : {}),
    })
  } catch { fail() }
}

/** Validate and snapshot only the non-secret authority binding. */
export function snapshotMcpOAuthGrantAuthority(raw) {
  try {
    return validateAuthority(exactObject(raw, authorityKeys, authorityKeys))
  } catch { fail() }
}

/** Extract a credential-free binding from a complete validated grant. */
export function mcpOAuthGrantAuthority(grant) {
  try {
    const validated = snapshotMcpOAuthGrant(grant)
    return Object.freeze({
      issuer: validated.issuer,
      tokenEndpoint: validated.tokenEndpoint,
      clientId: validated.clientId,
      resource: validated.resource,
      scopes: validated.scopes,
    })
  } catch { fail() }
}
