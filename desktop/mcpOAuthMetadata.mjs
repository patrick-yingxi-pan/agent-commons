/** Pure, bounded OAuth metadata parsing for the desktop MCP client.
 * This module grants no network or private-address authority. Callers must
 * separately admit each URL and pinned socket before fetching it. */

export class OAuthMetadataError extends Error {
  constructor(code = 'invalid') {
    super(code === 'unsupported' ? 'The OAuth server does not support the required client flow.' : 'The OAuth metadata is invalid.')
    this.name = 'OAuthMetadataError'
    this.code = code === 'unsupported' ? 'unsupported' : 'invalid'
  }
}

const fail = (code) => { throw new OAuthMetadataError(code) }
const MAX_METADATA_BYTES = 64 * 1024
const MAX_METADATA_NODES = 4_096
const MAX_METADATA_DEPTH = 16
const MAX_SCOPES = 64
const MAX_SCOPE_BYTES = 4_096

/** Snapshot plain JSON data without invoking accessors, toJSON or prototypes. */
export function snapshotOAuthJson(value) {
  try {
    let nodes = 0
    let bytes = 0
    const ancestors = new Set()
    const charge = amount => { bytes += amount; if (bytes > MAX_METADATA_BYTES) fail() }
    const chargeString = value => {
      charge(2)
      for (let i = 0; i < value.length; i += 1) {
        const unit = value.charCodeAt(i)
        if (unit === 0x22 || unit === 0x5c || unit <= 0x1f) charge(unit <= 0x1f && ![8, 9, 10, 12, 13].includes(unit) ? 6 : 2)
        else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { charge(4); i += 1 }
        else if (unit >= 0xd800 && unit <= 0xdfff) charge(6)
        else if (unit <= 0x7f) charge(1)
        else if (unit <= 0x7ff) charge(2)
        else charge(3)
      }
    }
    const copy = (item, depth) => {
      nodes += 1
      if (nodes > MAX_METADATA_NODES || depth > MAX_METADATA_DEPTH) fail()
      if (item === null) { charge(4); return null }
      if (typeof item === 'string') { chargeString(item); return item }
      if (typeof item === 'boolean') { charge(item ? 4 : 5); return item }
      if (typeof item === 'number' && Number.isFinite(item)) { charge(JSON.stringify(item).length); return item }
      if (!item || typeof item !== 'object') fail()
      if (ancestors.has(item)) fail()
      ancestors.add(item)
      try {
        if (Array.isArray(item)) {
          const keys = Reflect.ownKeys(item)
          if (keys.length > MAX_METADATA_NODES || keys.some(key => typeof key !== 'string')) fail()
          const lengthDescriptor = Object.getOwnPropertyDescriptor(item, 'length')
          if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || keys.length !== lengthDescriptor.value + 1) fail()
          const length = lengthDescriptor.value
          charge(2)
          const descriptors = Object.getOwnPropertyDescriptors(item)
          const result = []
          for (let i = 0; i < length; i += 1) {
            const descriptor = descriptors[String(i)]
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail()
            if (i) charge(1)
            result.push(copy(descriptor.value, depth + 1))
          }
          return result
        }
        const prototype = Object.getPrototypeOf(item)
        if (prototype !== Object.prototype && prototype !== null) fail()
        const keys = Reflect.ownKeys(item)
        if (keys.length > MAX_METADATA_NODES || keys.some(key => typeof key !== 'string')) fail()
        charge(2)
        const descriptors = Object.getOwnPropertyDescriptors(item)
        const result = {}
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i]
          const descriptor = descriptors[key]
          if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail()
          if (i) charge(1)
          chargeString(key)
          charge(1)
          Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
        }
        return result
      } finally { ancestors.delete(item) }
    }
    return copy(value, 0)
  } catch (error) {
    if (error instanceof OAuthMetadataError) throw error
    fail()
  }
}

function metadataObject(raw) {
  let value = raw
  if (typeof raw === 'string') {
    if (raw.length > MAX_METADATA_BYTES) fail()
    if (Buffer.byteLength(raw, 'utf8') > MAX_METADATA_BYTES) fail()
    try { value = JSON.parse(raw) } catch { fail() }
  }
  const result = snapshotOAuthJson(value)
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail()
  return result
}

function strictHttpsUrl(value, { issuer = false, maxLength = 2_048 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\u0000-\u0020\u007f]/.test(value)) fail()
  let parsed
  try { parsed = new URL(value) } catch { fail() }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || value.includes('#') || value.includes('\\') || (issuer && (parsed.search || value.includes('?')))) fail()
  return parsed
}

/** Validate an OAuth URL without asserting that it is safe to fetch. */
export function oauthHttpsUrl(value, options = {}) {
  strictHttpsUrl(value, options)
  return value
}

function canonicalResource(value) {
  const parsed = strictHttpsUrl(value)
  // MCP's canonical resource form uses lower-case scheme/host and recommends
  // no trailing slash for an origin root. Preserve meaningful path/query.
  parsed.protocol = parsed.protocol.toLowerCase()
  parsed.hostname = parsed.hostname.toLowerCase()
  const path = parsed.pathname === '/' ? '' : parsed.pathname
  return `${parsed.origin}${path}${parsed.search}`
}

/** MCP canonical resource URI: lower-case scheme/host and no origin-root slash. */
export function oauthResourceUrl(value) {
  return canonicalResource(value)
}

function pathInsertedWellKnown(value, suffix, { issuer = false } = {}) {
  const parsed = strictHttpsUrl(value, { issuer })
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
  return `${parsed.origin}/.well-known/${suffix}${path}${parsed.search}`
}

/** RFC 9728 path-specific metadata first, then the host-wide document. */
export function resourceMetadataUrls(endpoint) {
  const parsed = strictHttpsUrl(endpoint)
  const canonical = canonicalResource(endpoint)
  const hasPathOrQuery = parsed.pathname !== '/' || parsed.search !== ''
  const urls = hasPathOrQuery
    ? [pathInsertedWellKnown(canonical, 'oauth-protected-resource'), `${parsed.origin}/.well-known/oauth-protected-resource`]
    : [`${parsed.origin}/.well-known/oauth-protected-resource`]
  return Object.freeze([...new Set(urls)])
}

/** MCP order: RFC8414 insertion, OIDC insertion, then OIDC path append. */
export function authorizationMetadataUrls(issuer) {
  const parsed = strictHttpsUrl(issuer, { issuer: true })
  const inserted = pathInsertedWellKnown(issuer, 'oauth-authorization-server', { issuer: true })
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
  const oidcInserted = pathInsertedWellKnown(issuer, 'openid-configuration', { issuer: true })
  const appended = `${parsed.origin}${path}/.well-known/openid-configuration`
  return Object.freeze([...new Set([inserted, oidcInserted, appended])])
}

function scopeList(value, { optional = true } = {}) {
  if (value === undefined && optional) return undefined
  if (!Array.isArray(value) || value.length > MAX_SCOPES) fail()
  const scopes = []
  const seen = new Set()
  let bytes = 0
  for (const scope of value) {
    if (typeof scope !== 'string' || !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope) || seen.has(scope)) fail()
    bytes += Buffer.byteLength(scope, 'utf8')
    if (bytes > MAX_SCOPE_BYTES) fail()
    seen.add(scope)
    scopes.push(scope)
  }
  return Object.freeze(scopes)
}

/** Validated, detached OAuth scopes suitable for a held review snapshot. */
export function oauthScopes(value) {
  return scopeList(snapshotOAuthJson(value), { optional: false })
}

function stringArray(value, { optional = true, maxItems = 128, maxLength = 256 } = {}) {
  if (value === undefined && optional) return undefined
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || item.length > maxLength)) fail()
  return value
}

function booleanField(value, fallback = false) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail()
  return value
}

export function parseOAuthResourceMetadata(raw, expectedResource) {
  strictHttpsUrl(expectedResource)
  const document = metadataObject(raw)
  strictHttpsUrl(document.resource)
  // RFC 9728 §3.3 compares to the exact identifier used for discovery. Only
  // request preparation may canonicalize; response aliases are not identity.
  if (document.resource !== expectedResource) fail()
  const authorizationServers = stringArray(document.authorization_servers, { optional: false, maxItems: 16, maxLength: 2_048 })
  if (authorizationServers.length === 0) fail()
  const unique = new Set()
  for (const issuer of authorizationServers) {
    strictHttpsUrl(issuer, { issuer: true })
    if (unique.has(issuer)) fail()
    unique.add(issuer)
  }
  const scopesSupported = scopeList(document.scopes_supported)
  return Object.freeze({
    resource: expectedResource,
    authorizationServers: Object.freeze([...authorizationServers]),
    ...(scopesSupported === undefined ? {} : { scopesSupported }),
  })
}

export function parseOAuthServerMetadata(raw, expectedIssuer) {
  strictHttpsUrl(expectedIssuer, { issuer: true })
  const document = metadataObject(raw)
  strictHttpsUrl(document.issuer, { issuer: true })
  // Issuer identity is a security boundary: RFC 8414 requires exact string match.
  if (document.issuer !== expectedIssuer) fail()
  const authorizationEndpoint = oauthHttpsUrl(document.authorization_endpoint)
  const tokenEndpoint = oauthHttpsUrl(document.token_endpoint)
  const registrationEndpoint = document.registration_endpoint === undefined
    ? undefined : oauthHttpsUrl(document.registration_endpoint)
  const responseTypes = stringArray(document.response_types_supported, { optional: false })
  const grantTypes = stringArray(document.grant_types_supported) ?? ['authorization_code', 'implicit']
  const authMethods = stringArray(document.token_endpoint_auth_methods_supported) ?? ['client_secret_basic']
  const challengeMethods = stringArray(document.code_challenge_methods_supported) ?? []
  if (!responseTypes.includes('code') || !grantTypes.includes('authorization_code') || !authMethods.includes('none') || !challengeMethods.includes('S256')) fail('unsupported')
  const scopesSupported = scopeList(document.scopes_supported)
  const supportsClientMetadata = booleanField(document.client_id_metadata_document_supported)
  const issuerParameterSupported = booleanField(document.authorization_response_iss_parameter_supported)
  return Object.freeze({
    issuer: expectedIssuer,
    authorizationEndpoint,
    tokenEndpoint,
    ...(registrationEndpoint === undefined ? {} : { registrationEndpoint }),
    ...(scopesSupported === undefined ? {} : { scopesSupported }),
    supportsClientMetadata,
    issuerParameterSupported,
  })
}
